import asyncio
import datetime
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Annotated

import typer
import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException, APIRouter
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.responses import FileResponse, PlainTextResponse
from starlette.websockets import WebSocketDisconnect

from livecoding.domain.message import CrdtEventModel, WsMessage, SetSiteId
from livecoding.domain.room import Room, Site, RoomRepository, FullLogException
from livecoding.utils import try_notify_systemd, format_uptime, get_stars, configure_logging

logger = logging.getLogger(__name__)


class RoomSettings(BaseModel):
    documentLimit: int
    heartbitInterval: int


class RoomModel(BaseModel):
    roomId: str
    events: list[CrdtEventModel]
    settings: RoomSettings


class LivecodingApp:
    def __init__(
        self,
        *,
        data_root: Path = Path("./data"),
        serve_static: bool = True,
        heartbit_interval: int = 5,
        room_compaction_threshold: int = 75_000,
        room_events_limit: int = 200_000,
        room_sites_limit: int = 20,
        document_length_limit: int = 25_000,
        room_ttl_days: Optional[int] = 30,
        flush_interval: int = 10,
    ):
        self.started_at = datetime.datetime.now()
        self.heartbit_interval = heartbit_interval
        self.flush_interval = flush_interval

        self.room_repository = RoomRepository(
            root=data_root,
            compaction_threshold=room_compaction_threshold,
            ttl_days=room_ttl_days,
            room_events_limit=room_events_limit,
            room_sites_limit=room_sites_limit,
            document_length_limit=document_length_limit,
        )

        self.app: FastAPI = FastAPI(lifespan=self.lifespan)
        self.app.mount("/", self.init_router(serve_static))

    def init_router(self, serve_static: bool) -> APIRouter:
        result = APIRouter()

        resource_router = APIRouter()
        resource_router.add_api_route("/health", self.health)
        resource_router.add_api_route("/room", self.create_room, methods=["POST"])
        resource_router.add_api_route("/room/{room_id}", self.get_room_model)
        resource_router.add_api_websocket_route("/room/{room_id}/ws", self.websocket_endpoint)
        resource_router.add_api_route("/intro.js", self.get_intro, response_class=PlainTextResponse)

        result.mount("/resource", resource_router)

        if serve_static:
            static_router = APIRouter()
            static_router.add_api_route("/", self.index)
            static_router.add_api_route("/room/{room_id}", self.room_index)
            static_router.mount("/public", app=StaticFiles(directory="./frontend/public"))
            result.mount("/", static_router)

        return result

    @asynccontextmanager
    async def lifespan(self, _: FastAPI):
        fl = asyncio.create_task(self.flush_task(self.flush_interval))
        pr = asyncio.create_task(self.rooms_purge_task())
        try_notify_systemd()
        yield
        logger.info("Terminating application. Flushing all rooms")
        self.room_repository.flush_rooms()
        fl.cancel()
        pr.cancel()

    @staticmethod
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    async def create_room(self) -> RoomModel:
        room: Room = self.room_repository.create()
        return RoomModel(
            roomId=room.room_id,
            events=room.get_model_events(),
            settings=RoomSettings(documentLimit=room.document_length_limit, heartbitInterval=self.heartbit_interval),
        )

    def get_room_or_throw(self, room_id: str) -> Room:
        if not self.room_repository.exists(room_id):
            raise HTTPException(status_code=404, detail=f"Room {room_id} not found")

        return self.room_repository.get(room_id)

    async def get_room_model(self, room_id: str) -> RoomModel:
        room = self.get_room_or_throw(room_id)
        return RoomModel(
            roomId=room.room_id,
            events=room.get_model_events(),
            settings=RoomSettings(documentLimit=room.document_length_limit, heartbitInterval=self.heartbit_interval),
        )

    async def websocket_endpoint(self, websocket: WebSocket, room_id: str, offset: int = 0):
        room = self.get_room_or_throw(room_id)

        await websocket.accept()
        self.room_repository.claim(room.room_id)

        site_id = room.get_next_site_id()
        site = Site(site_id, websocket)

        heartbit_task: Optional[asyncio.Task] = None

        try:
            await room.connect(site, offset)
            assert await websocket.receive_text() == "Hello", "First message must be Hello"

            await site.send_message(WsMessage(setSiteId=SetSiteId(siteId=site_id)))
            heartbit_task = asyncio.create_task(site.heartbit_task(self.heartbit_interval))

            while True:
                msg = await site.receive_message()

                if msg.crdtEvents is not None:
                    await room.apply_events(msg.crdtEvents, sender=site_id)
                    await self.room_repository.try_compact(room.room_id)
                elif msg.sitePresence is not None:
                    await room.apply_presence(msg.sitePresence, sender=site_id)
                else:
                    raise ValueError(f"Invalid message: {msg}")
        except FullLogException:
            logger.error(f"Room {room.room_id} is full")
        except WebSocketDisconnect:
            pass
        finally:
            await room.disconnect(site_id)
            if heartbit_task is not None:
                heartbit_task.cancel()

    async def flush_task(self, interval: int):
        logger.info(f"Starting flush task. Interval: {interval}")
        while True:
            await asyncio.sleep(interval)
            self.room_repository.flush_rooms()
            await self.room_repository.gc()

    async def rooms_purge_task(self):
        logger.info("Starting rooms purge task. Interval: hourly")
        while True:
            self.room_repository.purge_stale_rooms()
            # on start-up and then hourly
            await asyncio.sleep(60 * 60)

    @staticmethod
    async def index():
        return FileResponse("frontend/index.html")

    # noinspection PyUnusedLocal
    @staticmethod
    async def room_index(room_id: str):
        return FileResponse("frontend/index.html")

    async def get_intro(self) -> str:
        active_rooms = len(self.room_repository.rooms)
        active_users = sum(len(room.sites) for room in self.room_repository.rooms.values())
        # smart way to cache for 5 seconds
        total_rooms = self.room_repository.total_rooms(round(time.time() / 30))
        uptime = format_uptime(self.started_at, datetime.datetime.now())
        stars = get_stars("marnikitta/livecoding", round(time.time() / 60))

        return f"""// Hi there! Welcome to Live coding editor!
//
// 1. Create a new room
// 2. Share the link with friends
// 3. Start coding together!

// Sources are available at https://github.com/marnikitta/livecoding

const liveStats = {{
    activeRooms: {active_rooms},
    activeUsers: {active_users},
    totalRooms: {total_rooms},
    uptime: "{uptime}",
    githubStars: {stars or "undefined"},
}};

const serverConfig = {{
    documentLengthLimit: {self.room_repository.document_length_limit},
    roomCompactionThreshold: {self.room_repository.compaction_threshold},
    roomEventsLimit: {self.room_repository.room_events_limit},
    roomTtlDays: {self.room_repository.ttl_days}
}};

// NB: The server will remove rooms after {self.room_repository.ttl_days} days of inactivity

// Pro tip: To change code highlighting, change file extension in the URL,
//   e.g. /room/emutilusejaxok.css for CSS
"""


def main(
    host: Annotated[
        str,
        typer.Option(
            envvar="HOST", help="The hostname or IP address where the server will run (e.g., 'localhost' or '0.0.0.0')"
        ),
    ] = "localhost",
    port: Annotated[int, typer.Option(envvar="PORT", help="The port number the server will listen on ")] = 5000,
    data_root: Annotated[
        Path,
        typer.Option(
            envvar="DATA_ROOT",
            help="The directory to store documents. If it doesn't exist, it will be created on first run",
        ),
    ] = Path("./data"),
    document_length_limit: Annotated[
        int, typer.Option(envvar="DOCUMENT_LENGTH_LIMIT", help="The maximum allowed size of a document, in characters")
    ] = 25_000,
    room_ttl_days: Annotated[
        int,
        typer.Option(envvar="ROOM_TTL_DAYS", help="The number of days a room can remain inactive before being deleted"),
    ] = 30,
):
    """
    Live coding app server
    """
    configure_logging()

    # Compaction is launched after pasting max document length, then deleting it and pasting again
    room_compaction_threshold = document_length_limit * 3
    # Hard limit is set to allow pasting the whole document after compaction launches,
    # and only then disconnect
    room_events_limit = room_compaction_threshold + document_length_limit
    app = LivecodingApp(
        data_root=data_root,
        document_length_limit=document_length_limit,
        room_compaction_threshold=room_compaction_threshold,
        room_events_limit=room_events_limit,
        room_ttl_days=room_ttl_days,
    )

    uvicorn.run(
        app.app,
        host=host,
        port=port,
        access_log=True,
        log_config=None,
        # Workers must be set to 1, because we use in-memory repository
        # It has to be shared between workers
        workers=1,
        ws_ping_timeout=app.heartbit_interval,
        ws_ping_interval=app.heartbit_interval,
    )


if __name__ == "__main__":
    typer.run(main)
