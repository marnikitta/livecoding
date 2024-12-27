import enum
import logging
from typing import Optional

from pydantic import BaseModel, Field
from typing_extensions import Annotated

logger = logging.getLogger(__name__)


class EventType(str, enum.Enum):
    insert = "insert"
    delete = "delete"


class GlobalIdModel(BaseModel):
    counter: int
    siteId: int

    def __lt__(self, other: "GlobalIdModel") -> bool:
        return self.to_tuple() < other.to_tuple()

    def to_tuple(self) -> tuple[int, int]:
        return self.counter, self.siteId


class CrdtEventModel(BaseModel):
    type: EventType
    gid: GlobalIdModel
    char: Optional[Annotated[str, Field(min_length=1, max_length=1)]] = None
    afterGid: Optional[GlobalIdModel] = None


class SiteHello(BaseModel):
    siteId: int
    name: str = Field(min_length=1, max_length=30)


class SiteDisconnected(BaseModel):
    siteId: int


class SetSiteId(BaseModel):
    siteId: int


class WsMessage(BaseModel):
    setSiteId: Optional[SetSiteId] = None
    siteHello: Optional[SiteHello] = None
    siteDisconnected: Optional[SiteDisconnected] = None
    crdtEvents: Optional[list[CrdtEventModel]] = None
    heartbit: Optional[bool] = None
    compactionRequired: Optional[bool] = None


def test_memory_usage():
    import tracemalloc
    tracemalloc.start()

    events = []
    for i in range(500_000):
        events.append(CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=i, siteId=0), char="a"))

    current, peak = tracemalloc.get_traced_memory()
    print(current >> 20, peak >> 20)


if __name__ == '__main__':
    test_memory_usage()
