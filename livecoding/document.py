import dataclasses
from typing import Optional

from livecoding.model import GlobalIdModel, CrdtEventModel, EventType


@dataclasses.dataclass(slots=True)
class CharEntry:
    gid: GlobalIdModel
    char: str
    visible: bool = True
    next_entry: Optional["CharEntry"] = None


class CrdtDocument:
    def __init__(self):
        self.head: Optional[CharEntry] = None
        self.gid_to_entry: dict[tuple[int, int], CharEntry] = {}

    def apply(self, event: CrdtEventModel):
        if event.type == EventType.delete:
            self.gid_to_entry[event.gid.to_tuple()].visible = False
            return

        assert event.type == EventType.insert
        if event.gid.to_tuple() in self.gid_to_entry:
            return

        prev_entry = None
        if event.afterGid is not None:
            prev_entry = self.gid_to_entry[event.afterGid.to_tuple()]

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

        self.gid_to_entry[event.gid.to_tuple()] = new_entry

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
    document.apply(CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=0, siteId=1), char="a"))
    assert document.materialize() == "a"

    document.apply(CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=1, siteId=1), char="b",
                                  afterGid=GlobalIdModel(counter=0, siteId=1)))
    assert document.materialize() == "ab"

    document.apply(CrdtEventModel(type=EventType.insert, gid=GlobalIdModel(counter=2, siteId=1), char="c",
                                  afterGid=None))
    assert document.materialize() == "cab"

    document.apply(CrdtEventModel(type=EventType.delete, gid=GlobalIdModel(counter=0, siteId=1)))
    assert document.materialize() == "cb"


if __name__ == '__main__':
    test_document()
