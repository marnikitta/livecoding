import enum
import logging
from typing import Optional

from pydantic import BaseModel, Field
from typing_extensions import Annotated

logger = logging.getLogger(__name__)


class EventType(str, enum.Enum):
    insert = "insert"
    delete = "delete"


class GlobalId(BaseModel):
    counter: int
    siteId: int

    def __lt__(self, other: "GlobalId") -> bool:
        return self.to_tuple() < other.to_tuple()

    def to_tuple(self) -> tuple[int, int]:
        return self.counter, self.siteId


class CrdtEvent(BaseModel):
    type: EventType
    gid: GlobalId
    char: Optional[Annotated[str, Field(min_length=1, max_length=1)]] = None
    afterGid: Optional[GlobalId] = None


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
    crdtEvents: Optional[list[CrdtEvent]] = None
    heartbit: Optional[bool] = None
    compactionRequired: Optional[bool] = None
