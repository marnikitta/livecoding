"""
There are two implementations of GlobalId and CrdtEvent classes. One is using dataclasses and the other is using pydantic.
The main reason is that pydantic classes are enormous. They are 10 times bigger than dataclasses.
However, they can be used for serde and validation. After receiving, they are converted to internal dataclasses.
"""

import logging
from typing import Optional
import tracemalloc

from pydantic import BaseModel, Field
from typing_extensions import Annotated

from livecoding.document import GlobalIdInternal, EventType, CrdtEventInternal
from livecoding.settings import settings

logger = logging.getLogger(__name__)


class GlobalIdModel(BaseModel):
    counter: int
    siteId: int

    def to_internal(self) -> GlobalIdInternal:
        return GlobalIdInternal(counter=self.counter, siteId=self.siteId)

    @staticmethod
    def from_internal(internal: GlobalIdInternal) -> "GlobalIdModel":
        return GlobalIdModel(counter=internal.counter, siteId=internal.siteId)


class CrdtEventModel(BaseModel):
    type: EventType
    gid: GlobalIdModel
    char: Optional[Annotated[str, Field(min_length=1, max_length=1)]] = None
    afterGid: Optional[GlobalIdModel] = None

    def to_internal(self) -> CrdtEventInternal:
        return CrdtEventInternal(
            type=self.type,
            gid=self.gid.to_internal(),
            char=self.char,
            afterGid=self.afterGid.to_internal() if self.afterGid else None,
        )

    @staticmethod
    def from_internal(internal: CrdtEventInternal) -> "CrdtEventModel":
        return CrdtEventModel(
            type=internal.type,
            gid=GlobalIdModel.from_internal(internal.gid),
            char=internal.char,
            afterGid=GlobalIdModel.from_internal(internal.afterGid) if internal.afterGid else None,
        )


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


class RoomSettings(BaseModel):
    documentLimit: int = settings.document_size_limit
    heartbitInterval: int = settings.heartbit_interval


class RoomModel(BaseModel):
    roomId: str
    events: list[CrdtEventModel]
    settings: RoomSettings = RoomSettings()


def test_memory_usage():
    tracemalloc.start()

    events = []
    for i in range(500_000):
        # events.append(CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=i, siteId=0), char="a"))
        events.append(CrdtEventInternal(type=EventType.insert, gid=GlobalIdInternal(counter=i, siteId=0), char="a"))

    current, peak = tracemalloc.get_traced_memory()
    print(current >> 20, peak >> 20)


if __name__ == "__main__":
    test_memory_usage()
