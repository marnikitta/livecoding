import asyncio
import datetime
import logging
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, PlainTextResponse

from starlette.websockets import WebSocketDisconnect

from livecoding.settings import settings
from livecoding.model import WsMessage, SetSiteId, RoomModel
from livecoding.room import Room, Site, RoomRepository, FullLogException
from livecoding.utils import try_notify_systemd, format_uptime, get_stars


def configure_logging():
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root_logger.addHandler(handler)


configure_logging()
logger = logging.getLogger(__name__)
started_at = datetime.datetime.now()

room_repository: RoomRepository = RoomRepository(root=Path("./data"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    fl = asyncio.create_task(flush_task())
    pr = asyncio.create_task(rooms_purge_task())
    try_notify_systemd()
    yield
    logger.info("Terminating application. Flushing all rooms")
    room_repository.flush_rooms()
    fl.cancel()
    pr.cancel()


app = FastAPI(lifespan=lifespan)


@app.post("/resource/room")
async def create_room() -> RoomModel:
    room: Room = room_repository.create()
    return RoomModel(roomId=room.room_id, events=room.get_model_events())


def room_provider(room_id: str) -> Room:
    if not room_repository.exists(room_id):
        raise HTTPException(status_code=404, detail=f"Room {room_id} not found")

    return room_repository.get(room_id)


@app.get("/resource/room/{room_id}")
async def get_room(room: Annotated[Room, Depends(room_provider)]) -> RoomModel:
    return RoomModel(roomId=room.room_id, events=room.get_model_events())


@app.websocket("/resource/room/{room_id}/ws")
async def websocket_endpoint(room: Annotated[Room, Depends(room_provider)], websocket: WebSocket, offset: int = 0):
    await websocket.accept()
    room_repository.claim(room.room_id)

    site_id = room.get_next_site_id()
    site = Site(site_id, websocket)

    heartbit_task: Optional[asyncio.Task] = None

    try:
        await room.connect(site, offset)
        assert await websocket.receive_text() == "Hello", "First message must be Hello"

        await site.send_message(WsMessage(setSiteId=SetSiteId(siteId=site_id)))
        heartbit_task = asyncio.create_task(site.heartbit_task(settings.heartbit_interval))

        while True:
            msg = await site.receive_message()

            if msg.crdtEvents is not None:
                await room.apply_events(msg.crdtEvents, sender=site_id)
                if room.events_len > settings.events_compaction_limit:
                    await room_repository.compact_room(room.room_id)
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


async def flush_task():
    while True:
        await asyncio.sleep(settings.rooms_flush_interval)
        room_repository.flush_rooms()
        await room_repository.gc()


async def rooms_purge_task():
    while True:
        room_repository.purge_stale_rooms(settings.rooms_ttl_days)
        # on start-up and then hourly
        await asyncio.sleep(60 * 60)


@app.get("/resource/intro.js", response_class=PlainTextResponse)
async def get_intro() -> str:
    active_rooms = len(room_repository.rooms)
    active_users = sum(len(room.sites) for room in room_repository.rooms.values())
    # smart way to cache for 5 seconds
    total_rooms = room_repository.total_rooms(round(time.time() / 30))
    uptime = format_uptime(started_at, datetime.datetime.now())
    stars = get_stars(settings.repository, round(time.time() / 60))

    return f"""// Welcome!
//
// 1. Create a new room
// 2. Share the link with friends
// 3. Start coding together!

// Sources are available at https://github.com/{settings.repository}

const liveStats = {{
    activeRooms: {active_rooms},
    activeUsers: {active_users},
    totalRooms: {total_rooms},
    uptime: "{uptime}",
    githubStars: {stars or "undefined"},
}};

const serverConfig = {{
    heartbitInterval: {settings.heartbit_interval},
    documentSizeLimit: {settings.document_size_limit},
    eventsCompactionLimit: {settings.events_compaction_limit},
    eventsHardLimit: {settings.events_hard_limit},
    roomsFlushInterval: {settings.rooms_flush_interval},
    roomsTtlDays: {settings.rooms_ttl_days},
}};

// NB: The server will remove rooms after {settings.rooms_ttl_days} days of inactivity

// Pro tip: To change code highlighting, change file extension in the URL,
//   e.g. /room/emutilusejaxok.css for CSS
"""


@app.get("/")
async def index():
    return FileResponse("frontend/index.html")


@app.get("/room/{room_id}")
async def room_index(room_id: str):
    print(room_id)
    return FileResponse("frontend/index.html")


app.mount("/public", app=StaticFiles(directory="./frontend/public"))

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="localhost",
        access_log=True,
        log_config=None,
        port=5000,
        workers=1,
        ws_ping_timeout=settings.heartbit_interval,
        ws_ping_interval=settings.heartbit_interval,
    )
