import asyncio
import gzip
import logging
import time
import tracemalloc
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi.websockets import WebSocket
from starlette.websockets import WebSocketState, WebSocketDisconnect

from livecoding.document import CrdtDocument, CrdtEventInternal, GlobalIdInternal
from livecoding.model import WsMessage, SiteDisconnected, CrdtEventModel, SiteHello, EventType, GlobalIdModel
from livecoding.settings import settings
from livecoding.utils import generate_phonetic_name

logger = logging.getLogger(__name__)


class Site:
    def __init__(self, site_id: int, websocket: WebSocket):
        self.site_id = site_id
        self.name: Optional[str] = None
        self._websocket = websocket

    async def send_message(self, message: WsMessage):
        try:
            await self._websocket.send_text(message.model_dump_json(exclude_none=True))
        except Exception:
            raise WebSocketDisconnect()

    async def receive_message(self) -> WsMessage:
        try:
            text = await self._websocket.receive_text()
        except Exception:
            raise WebSocketDisconnect()

        return WsMessage.model_validate_json(text)

    async def close(self):
        try:
            await self._websocket.close()
        except Exception:
            pass

    async def heartbit_task(self, seconds: int):
        while True:
            try:
                await self.send_message(WsMessage(heartbit=True))
                await asyncio.sleep(seconds)
            except WebSocketDisconnect:
                break
            except Exception:
                logger.exception(f"Heartbit task for {self.site_id} failed")
                break

    @property
    def socket_connected(self) -> bool:
        return (self._websocket.application_state == WebSocketState.CONNECTED) and (
            self._websocket.client_state == WebSocketState.CONNECTED
        )


class FullLogException(Exception):
    pass


class Room:
    def __init__(
        self,
        room_id: str,
        *,
        initial_events: Optional[list[CrdtEventInternal]] = None,
        events_limit: int = settings.hard_max_events_log,
    ):
        self.room_id = room_id
        self.sites: dict[int, Site] = {}

        self._events: list[CrdtEventInternal] = []
        self._document = CrdtDocument()
        self.events_limit = events_limit

        if initial_events is not None:
            for e in initial_events:
                self._document.apply(e)
            self._events += initial_events

    def get_next_site_id(self) -> int:
        max_event_id = max([e.gid.siteId for e in self._events], default=0)
        return max(max(self.sites.keys(), default=0), max_event_id) + 1

    async def connect(self, site: Site, offset: int = 0):
        if site.site_id in self.sites:
            raise ValueError(f"Site with id {site.site_id} already connected to room {self.room_id}")

        if len(self.sites) >= settings.max_sites:
            raise ValueError(f"Room {self.room_id} is full")

        self.sites[site.site_id] = site
        logger.info(f"Site {site.site_id} connected to the room {self.room_id}")

        await site.send_message(WsMessage(crdtEvents=self.get_model_events(offset)))

        for other_site_id in list(self.sites.keys()):
            if other_site_id not in self.sites:
                # other site might be already disconnected because await down below might have given control to other
                # coroutine
                continue
            other_site = self.sites[other_site_id]
            if other_site.name is not None:
                await site.send_message(WsMessage(siteHello=SiteHello(siteId=other_site.site_id, name=other_site.name)))

    def get_model_events(self, offset: int = 0) -> list[CrdtEventModel]:
        return [CrdtEventModel.from_internal(e) for e in self._events[offset:]]

    async def apply_events(self, crdt_events: list[CrdtEventModel], sender: Optional[int] = None):
        if sender is not None:
            for event in crdt_events:
                if event.type == EventType.insert:
                    assert event.gid.siteId == sender, "Insertions must be sent by the site"

        self._append_events(crdt_events)
        await self.broadcast(WsMessage(crdtEvents=crdt_events), sender)

    def _append_events(self, crdt_events: list[CrdtEventModel]):
        if len(self._events) + len(crdt_events) > self.events_limit:
            raise FullLogException(
                f"Reached hard limit. Current size: {len(self._events)}, new events: {len(crdt_events)}"
            )

        internal_events = [e.to_internal() for e in crdt_events]

        self._events += internal_events
        for event in internal_events:
            self._document.apply(event)

    @property
    def events_len(self) -> int:
        return len(self._events)

    async def apply_hello(self, site_hello: SiteHello):
        self.sites[site_hello.siteId].name = site_hello.name
        await self.broadcast(WsMessage(siteHello=site_hello))

    async def broadcast(self, message: WsMessage, sender: Optional[int] = None):
        for site in list(self.sites.values()):
            if site.site_id == sender:
                continue

            try:
                await site.send_message(message)
            except WebSocketDisconnect:
                logger.warning(f"Site {site.site_id} is not connected to room {self.room_id}")
                await self.disconnect(site.site_id)

    async def disconnect(self, site_id: int):
        if site_id not in self.sites:
            return

        await self.sites[site_id].close()

        del self.sites[site_id]
        logger.info(f"Site {site_id} disconnected from the room {self.room_id}")

        await self.broadcast(WsMessage(siteDisconnected=SiteDisconnected(siteId=site_id)))

    async def gc_sites(self):
        for site in list(self.sites.values()):
            if not site.socket_connected:
                await self.disconnect(site.site_id)

    def has_active_sites(self):
        return len(self.sites) > 0

    def materialize(self) -> str:
        return self._document.materialize()


def create_from_text(room_id: str, text: str) -> Room:
    prev_gid = None

    events = []
    for i, t in enumerate(text):
        gid = GlobalIdInternal(counter=i, siteId=RoomRepository.UTIL_SITE_ID)
        events.append(CrdtEventInternal(type=EventType.insert, gid=gid, afterGid=prev_gid, char=t))
        prev_gid = gid

    room = Room(room_id, initial_events=events)

    materialized_text = room.materialize()
    assert materialized_text == text
    return room


class RoomRepository:
    UTIL_SITE_ID = 0

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(exist_ok=True)

        self.rooms: dict[str, Room] = {}
        self.events_at_last_flush: dict[str, int] = {}

    def create(self) -> Room:
        # Room might be GCed before it's claimed if no one connects to it
        room_id = generate_phonetic_name(length=14)
        room = Room(room_id)
        self.rooms[room_id] = room
        return room

    def claim(self, room_id: str):
        if not self.room_path(room_id).exists():
            # Optimization not to save file on every room creation
            logger.info(f"Claiming room {room_id}. It was not flushed before")
            self.flush(self.rooms[room_id])

    def exists(self, room_id: str) -> bool:
        return room_id in self.rooms or self.room_path(room_id).exists()

    def get(self, room_id: str) -> Room:
        if room_id in self.rooms:
            return self.rooms[room_id]

        if not self.exists(room_id):
            raise ValueError(f"Room {room_id} does not exist")

        with gzip.open(self.room_path(room_id), "rt") as f:
            text: str = f.read()

        room = create_from_text(room_id, text)
        logger.info(f"Initialized room {room_id} with {room.events_len} events from disc")
        self.events_at_last_flush[room_id] = room.events_len

        self.rooms[room_id] = room
        return room

    def flush(self, room: Room) -> None:
        if (room.room_id in self.events_at_last_flush) and (room.events_len == self.events_at_last_flush[room.room_id]):
            logger.debug(f"Skipping flush for {room.room_id}")
            return

        start_time = time.time()
        text = room.materialize()
        with gzip.open(self.room_path(room.room_id), "wt") as f:
            f.write(text)
        logger.info(f"Persisted {room.room_id} to disc. Text length: {len(text)}. Took {time.time() - start_time:.2f}s")
        self.events_at_last_flush[room.room_id] = room.events_len

    def flush_rooms(self) -> None:
        for room_id, room in self.rooms.items():
            try:
                self.flush(room)
            except Exception:
                logger.exception(f"Failed to flush room {room_id}. Ignoring it")

    async def gc(self) -> None:
        for room in list(self.rooms.values()):
            try:
                await room.gc_sites()
                if not room.has_active_sites():
                    logger.info(f"Room {room.room_id} is empty, removing it from memory")
                    self.offload(room.room_id)
            except Exception:
                logger.exception(f"Failed to cleanup room {room.room_id}. Removing it from memory")
                self.offload(room.room_id)

    def offload(self, room_id: str):
        if room_id not in self.rooms:
            return
        room = self.rooms[room_id]

        try:
            self.flush(room)
        except Exception:
            logger.exception(f"Failed to flush room {room_id}. Continuing with offload")

        del self.rooms[room_id]
        if room_id in self.events_at_last_flush:
            del self.events_at_last_flush[room_id]
        logger.info(f"Removed room {room_id} from memory")

    def room_path(self, room_id: str) -> Path:
        return self.root / f"{room_id}.txt.gz"

    async def compact_room(self, room_id: str):
        if room_id not in self.rooms:
            return

        logger.warning(f"Compacting room {room_id}")
        room = self.rooms[room_id]
        await room.broadcast(WsMessage(compactionRequired=True))
        for site in list(room.sites.values()):
            await room.disconnect(site.site_id)

        self.offload(room_id)

    @lru_cache
    def total_rooms(self, _: int) -> int:
        saved_rooms = set(p.name.replace(".txt.gz", "") for p in self.root.iterdir())
        saved_rooms |= set(self.rooms.keys())
        return len(saved_rooms)


def test_from_text():
    text = "Hello, World!"
    room = create_from_text(generate_phonetic_name(), text)
    materialized_text = room.materialize()
    assert materialized_text == text


def test_memory_usage():
    tracemalloc.start()
    room = Room("test", events_limit=1_000_000)

    for i in range(250_000):
        room._append_events([CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=i, siteId=0), char="a")])

    current, peak = tracemalloc.get_traced_memory()
    print(current >> 20, peak >> 20)


if __name__ == "__main__":
    test_memory_usage()
    # test_from_text()
