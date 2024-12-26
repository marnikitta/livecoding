import gzip
import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi.websockets import WebSocket
from starlette.websockets import WebSocketState

from livecoding.document import CrdtDocument
from livecoding.model import WsMessage, SiteDisconnected, CrdtEvent, SiteHello, GlobalId, EventType
from livecoding.settings import settings
from livecoding.utils import generate_phonetic_name

logger = logging.getLogger(__name__)


class Site:
    def __init__(self, site_id: int, websocket: WebSocket):
        self.site_id = site_id
        self.websocket = websocket
        self.name: Optional[str] = None


class FullLogException(Exception):
    pass


class Room:
    EVENTS_BATCH_SIZE = 100

    def __init__(self, room_id: str):
        self.room_id = room_id
        self.sites: dict[int, Site] = {}
        self.events: list[CrdtEvent] = []
        self.document = CrdtDocument()

    @staticmethod
    def create_from_text(room_id: str, text: str):
        room = Room(room_id)
        prev_gid = None
        for i, t in enumerate(text):
            gid = GlobalId(counter=i, siteId=RoomRepository.UTIL_SITE_ID)
            room._append_events([CrdtEvent(type=EventType.insert, gid=gid, afterGid=prev_gid, char=t)])
            prev_gid = gid
        materialized_text = room.materialize()
        assert materialized_text == text
        return room

    @property
    def max_site_id(self) -> int:
        max_gid = max([e.gid.siteId for e in self.events], default=0)
        return max(max(self.sites.keys(), default=0), max_gid) + 1

    async def connect(self, site: Site, offset: int = 0):
        if site.site_id in self.sites:
            raise ValueError(f"Site with id {site.site_id} already connected to room {self.room_id}")

        if len(self.sites) >= settings.max_sites:
            raise FullLogException(f"Room {self.room_id} is full")

        self.sites[site.site_id] = site
        logger.info(f"Site {site.site_id} connected to room {self.room_id}")

        for i in range(offset, len(self.events), Room.EVENTS_BATCH_SIZE):
            msg = WsMessage(crdtEvents=self.events[i:i + Room.EVENTS_BATCH_SIZE])
            await site.websocket.send_text(msg.model_dump_json(exclude_none=True))

        for s in self.sites.values():
            if s.name is None:
                continue
            await site.websocket.send_text(WsMessage(siteHello=SiteHello(siteId=s.site_id, name=s.name))
                                           .model_dump_json(exclude_none=True))

    async def apply_events(self, crdt_events: list[CrdtEvent], sender: Optional[int] = None):
        if sender is not None:
            for event in crdt_events:
                if event.type == EventType.insert:
                    assert event.gid.siteId == sender, "Insertions must be sent by the site"

        self._append_events(crdt_events)
        await self.broadcast(WsMessage(crdtEvents=crdt_events), sender)

    def _append_events(self, crdt_events: list[CrdtEvent]):
        if len(self.events) + len(crdt_events) > settings.hard_max_events_log:
            raise FullLogException(
                f"Reached hard limit. Current size: {len(self.events)}, new events: {len(crdt_events)}")

        self.events += crdt_events
        for event in crdt_events:
            self.document.apply(event)

    async def broadcast_hello(self, site_hello: SiteHello):
        self.sites[site_hello.siteId].name = site_hello.name
        await self.broadcast(WsMessage(siteHello=site_hello))

    async def broadcast(self, message: WsMessage, sender: Optional[int] = None):
        sites = list(self.sites.values())
        for site in sites:
            if site.site_id == sender:
                continue

            try:
                value = message.model_dump_json(exclude_none=True)
                await site.websocket.send_text(value)
            except Exception:
                logger.warning(f"Site {site.site_id} is not connected to room {self.room_id}")
                await self.disconnect(site.site_id)

    async def disconnect(self, site_id: int):
        if site_id not in self.sites:
            return

        try:
            await self.sites[site_id].websocket.close()
        except:
            pass

        del self.sites[site_id]
        logger.info(f"Site {site_id} disconnected from the room {self.room_id}")

        await self.broadcast(WsMessage(siteDisconnected=SiteDisconnected(siteId=site_id)))

    async def clean_connections(self):
        for site in list(self.sites.values()):
            if site.websocket.client_state == WebSocketState.DISCONNECTED:
                await self.disconnect(site.site_id)

    def has_active_sites(self):
        return len(self.sites) > 0

    def materialize(self) -> str:
        return self.document.materialize()


initial_message = "// To edit the document, first introduce yourself."


class RoomRepository:
    UTIL_SITE_ID = 0

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(exist_ok=True)

        self.rooms: dict[str, Room] = {}
        self.events_at_last_flush: dict[str, int] = {}

    def create(self) -> Room:
        # It might be removed if nobody connects to it
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
            raise ValueError(f"Room {room_id} not found")

        with gzip.open(self.room_path(room_id), "rt") as f:
            text: str = f.read()
        logger.info(f"Loaded {room_id} from disc. Text length: {len(text)}")

        room = Room.create_from_text(room_id, text)
        logger.info(f"Initialized room {room_id} with {len(room.events)} events from disc")
        self.events_at_last_flush[room_id] = len(room.events)

        self.rooms[room_id] = room
        return room

    def flush(self, room: Room) -> None:
        if ((room.room_id in self.events_at_last_flush)
                and (len(room.events) == self.events_at_last_flush[room.room_id])):
            logger.debug(f"Skipping flush for {room.room_id}")
            return

        start_time = time.time()
        text = room.materialize()
        with gzip.open(self.room_path(room.room_id), "wt") as f:
            f.write(text)
        logger.info(f"Persisted {room.room_id} to disc. Text length: {len(text)}. Took {time.time() - start_time:.2f}s")
        self.events_at_last_flush[room.room_id] = len(room.events)

    def flush_everything(self) -> None:
        for room_id in list(self.rooms.keys()):
            try:
                self.flush(self.rooms[room_id])
            except Exception:
                logger.exception(f"Failed to flush room {room_id}. Ignoring it")

    async def gc(self) -> None:
        for room in list(self.rooms.values()):
            try:
                await room.clean_connections()
                if not room.has_active_sites():
                    logger.info(f"Room {room.room_id} is empty, removing it from memory")
                    self.offload(room.room_id)
            except Exception:
                logger.exception(f"Failed to cleanup room {room.room_id}. Removing it from memory")
                del self.rooms[room.room_id]

    def offload(self, room_id: str):
        if room_id not in self.rooms:
            return

        room = self.rooms[room_id]
        self.flush(room)
        del self.rooms[room_id]
        if room_id in self.events_at_last_flush:
            del self.events_at_last_flush[room_id]

    def room_path(self, room_id: str) -> Path:
        return self.root / f"{room_id}.txt.gz"

    async def compact(self, room_id: str):
        if room_id not in self.rooms:
            return

        logger.info(f"Compacting room {room_id}")
        room = self.rooms[room_id]
        await room.broadcast(WsMessage(compactionRequired=True))
        for site in list(room.sites.values()):
            await room.disconnect(site.site_id)

        self.offload(room_id)

    @lru_cache
    def total_rooms(self, unused: int) -> int:
        saved_rooms = set(p.name.replace(".txt.gz", "") for p in self.root.iterdir())
        saved_rooms |= set(self.rooms.keys())
        return len(saved_rooms)


def test_from_text():
    text = "Hello, World!"
    room = Room.create_from_text(generate_phonetic_name(), text)
    materialized_text = room.materialize()
    assert materialized_text == text


if __name__ == '__main__':
    test_from_text()
