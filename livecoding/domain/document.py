import dataclasses
import enum
from typing import Optional


class EventType(str, enum.Enum):
    insert = "insert"
    delete = "delete"


@dataclasses.dataclass(slots=True, frozen=True, order=True, eq=True)
class GlobalIdInternal:
    counter: int
    siteId: int


@dataclasses.dataclass(slots=True, frozen=True)
class CrdtEventInternal:
    type: EventType
    gid: GlobalIdInternal
    char: Optional[str] = None
    after_gid: Optional[GlobalIdInternal] = None


@dataclasses.dataclass(slots=True)
class CharEntry:
    gid: GlobalIdInternal
    char: str
    visible: bool = True
    next_entry: Optional["CharEntry"] = None


class CrdtDocument:
    def __init__(self):
        self.head: Optional[CharEntry] = None
        self.gid_to_entry: dict[GlobalIdInternal, CharEntry] = {}

    def apply(self, event: CrdtEventInternal):
        if event.type == EventType.delete:
            self.gid_to_entry[event.gid].visible = False
            return

        assert event.type == EventType.insert
        if event.gid in self.gid_to_entry:
            return

        prev_entry = None
        if event.after_gid is not None:
            prev_entry = self.gid_to_entry[event.after_gid]

        next_entry = prev_entry.next_entry if prev_entry is not None else self.head

        while next_entry is not None and next_entry.gid > event.gid:
            prev_entry = next_entry
            next_entry = prev_entry.next_entry

        assert event.char is not None and len(event.char) == 1
        new_entry = CharEntry(gid=event.gid, char=event.char)
        if prev_entry is None:
            old_head = self.head
            self.head = new_entry
            new_entry.next_entry = old_head
        else:
            prev_entry.next_entry = new_entry
            new_entry.next_entry = next_entry

        self.gid_to_entry[event.gid] = new_entry

    def materialize(self) -> str:
        if self.head is None:
            return ""

        result = []
        current: Optional[CharEntry] = self.head
        while current is not None:
            if current.visible:
                result.append(current.char)
            current = current.next_entry

        return "".join(result)


def test_document():
    document = CrdtDocument()
    document.apply(CrdtEventInternal(type=EventType.insert, gid=GlobalIdInternal(counter=0, siteId=1), char="a"))
    assert document.materialize() == "a"

    document.apply(
        CrdtEventInternal(
            type=EventType.insert,
            gid=GlobalIdInternal(counter=1, siteId=1),
            char="b",
            after_gid=GlobalIdInternal(counter=0, siteId=1),
        )
    )
    assert document.materialize() == "ab"

    document.apply(
        CrdtEventInternal(type=EventType.insert, gid=GlobalIdInternal(counter=2, siteId=1), char="c", after_gid=None)
    )
    assert document.materialize() == "cab"

    document.apply(CrdtEventInternal(type=EventType.delete, gid=GlobalIdInternal(counter=0, siteId=1)))
    assert document.materialize() == "cb"

    assert GlobalIdInternal(counter=1, siteId=1) < GlobalIdInternal(counter=1, siteId=2)
    assert GlobalIdInternal(counter=2, siteId=1) > GlobalIdInternal(counter=1, siteId=2)


if __name__ == "__main__":
    test_document()
