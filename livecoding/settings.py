from pydantic import BaseModel


class Settings(BaseModel):
    heartbit_interval: int = 5
    """
    Server heartbit interval in seconds.
    Client checks if connection is alive by asserting
    that it receives a message every `heartbit_interval` seconds.
    """
    events_hard_limit: int = 200_000
    """
    If client sends crdt event that would exceed this limit,
    it will be disconnected from the room
    """
    events_compaction_limit: int = 75_000
    """
    If room events count exceeds this limit,
    server will disconnect all clients and flush the room.
    After reconnection, all tombstones and change history will be lost.
    """
    document_size_limit: int = 25_000
    """
    Maximum document size in characters.
    Client-side limit to play nice with server limits.
    On connection server sends this setting to clients.
    """
    max_sites: int = 20
    """
    Maximum number of sites in a room.
    """
    rooms_flush_interval: int = 10
    """
    Interval in seconds to flush rooms data to disk.
    """
    # rooms_ttl: int = 60 * 60 * 24 * 7
    rooms_ttl_days: int = 30
    """
    Room time-to-live in seconds.
    Rooms are deleted after this time of inactivity.
    """
    repository: str = "marnikitta/livecoding"
    """
    GitHub repository to fetch stars count.
    """


# todo read from env
settings = Settings()
