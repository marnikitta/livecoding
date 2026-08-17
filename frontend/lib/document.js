const INSERT_OPERATION = "insert";
const DELETE_OPERATION = "delete";

export class GlobalId {
    constructor(counter, siteId) {
        this.counter = counter;
        this.siteId = siteId;
    }

    static compare(a, b) {
        if (a.counter < b.counter) return -1;
        if (a.counter > b.counter) return 1;
        if (a.siteId < b.siteId) return -1;
        if (a.siteId > b.siteId) return 1;
        return 0;
    }

    toString() {
        return `${this.counter}@${this.siteId}`;
    }
}

/**
 * Stable string key for a global id, for comparison and deduplication.
 *
 * Do not string-coerce a gid instead. Ids that arrive over the wire are plain JSON objects rather than
 * GlobalId instances, so GlobalId.prototype.toString does not apply to them: coercion quietly yields
 * "[object Object]" and makes every id compare equal.
 *
 * @param {GlobalId|{counter: number, siteId: number}|null} gid
 * @return {string}
 */
export function gidKey(gid) {
    return gid ? `${gid.counter}@${gid.siteId}` : "-";
}

export class CharEntry {
    /**
     * @param {string} c
     * @param {GlobalId} gid
     * @param {boolean} visible
     */
    constructor(c, gid, visible = true) {
        this.c = c
        this.gid = gid
        this.visible = visible
    }
}

export class PlainUpdate {
    /**
     * @param {number} from
     * @param {number} to
     * @param {string} value
     */
    constructor(from, to, value) {
        this.from = from
        this.to = to
        this.value = value

        if (this.from > this.to) {
            throw new Error("Invalid range");
        }
    }

    /**
     * @return {number}
     */
    newFrom() {
        return this.from;
    }

    /**
     * @return {number}
     */
    newTo() {
        return this.from + this.value.length;
    }
}

export class CRDTEvent {
    /**
     * @param {string} type
     * @param {GlobalId} gid
     * @param {string|null} char
     * @param {GlobalId|null} afterGid
     */
    constructor(type, gid, char, afterGid) {
        this.type = type;
        this.gid = gid;
        this.char = char;
        this.afterGid = afterGid
    }
}

/**
 * Number of Unicode code points in a string. Differs from `.length` (UTF-16 code units) for
 * astral characters such as emoji, which occupy two code units.
 *
 * @param {string} s
 * @return {number}
 */
function codePointLength(s) {
    let count = 0;
    for (const _ of s) count++;
    return count;
}

/**
 * @param {PlainUpdate[]} updates
 * @return {PlainUpdate[]}
 */
function compactPlainUpdates(updates) {
    /**
     * @type {PlainUpdate[]}
     */
    let result = [];
    for (let update of updates) {
        if (result.length === 0) {
            result.push(update);
            continue;
        }

        let lastItem = result[result.length - 1];
        if (lastItem.newTo() === update.from) {
            result[result.length - 1] = new PlainUpdate(
                lastItem.from,
                lastItem.from + lastItem.to - lastItem.from + update.to - update.from,
                lastItem.value + update.value);
        } else {
            result.push(update);
        }
    }
    return result;
}

export class CRDTDocument {
    // https://www.bartoszsypytkowski.com/operation-based-crdts-arrays-1/

    constructor() {
        /**
         * @type {CharEntry[]}
         */

        this.entries = [];
        this.appliedOps = new Set();

        this.maxCounter = 0;
        this.lastEditedPosition = -1;

        this.cachedPosition = 0;
        this.cachedLength = 0;
    }

    /**
     * @return {string}
     */
    getText() {
        return this.entries.filter(e => e.visible).map(e => e.c).join("");
    }

    /**
     * @param {GlobalId} gid
     * @return {number}
     */
    findGid(gid) {
        let start = Math.max(this.lastEditedPosition - 1, 0)

        for (let i = start; i < this.entries.length; i++) {
            if (this.entries[i].gid.counter === gid.counter
                && this.entries[i].gid.siteId === gid.siteId) {
                this.lastEditedPosition = i;
                return i;
            }
        }

        for (let i = 0; i < start; i++) {
            if (this.entries[i].gid.counter === gid.counter
                && this.entries[i].gid.siteId === gid.siteId) {
                this.lastEditedPosition = i;
                return i;
            }
        }

        return -1
    }

    /**
     * @param {CRDTEvent[]} events
     * @return {array<PlainUpdate>}
     */
    applyEvents(events) {
        let updates = []
        for (const event of events) {
            if (event.type === INSERT_OPERATION) {
                let out = this.insert(event.char, event.gid, event.afterGid);
                updates.push(...out);
            } else if (event.type === DELETE_OPERATION) {
                updates.push(...this.delete(event.gid));
            } else {
                throw new Error("Unknown event type: " + event.type);
            }
        }

        return compactPlainUpdates(updates);
    }

    /**
     * @param {string} char
     * @param {GlobalId} gid
     * @param {GlobalId} afterGid
     * @return {array<PlainUpdate>}
     */
    insert(char, gid, afterGid) {
        this.maxCounter = Math.max(this.maxCounter, gid.counter);

        const opStr = `${INSERT_OPERATION}-${gid.siteId}-${gid.counter}`;
        if (this.appliedOps.has(opStr)) {
            console.warn(`Operation ${opStr} already applied`);
            return [];
        }

        // The CRDT unit is a single Unicode code point, not a UTF-16 code unit. Python (the server) iterates
        // strings by code point, so splitting on code units here would produce lone surrogates that are not
        // representable in JSON/UTF-8 and get rejected on the wire.
        if (codePointLength(char) !== 1) {
            throw new Error(`Char must have a single code point. Got: ${char}`);
        }

        let position
        if (!afterGid) {
            position = -1;
        } else {
            position = this.findGid(afterGid);
            if (position === -1) {
                throw new Error(`GID ${afterGid} not found`);
            }
        }

        while (position < this.entries.length - 1 && GlobalId.compare(this.entries[position + 1].gid, gid) > 0) {
            position++;
        }

        let newItemsPosition = position + 1;
        this.entries.splice(newItemsPosition, 0, new CharEntry(char, gid));
        this.appliedOps.add(opStr);

        if (this.cachedPosition > newItemsPosition) {
            this.cachedLength = 0;
            this.cachedPosition = 0;
        }

        let length = this.getPrefixLength(newItemsPosition)
        return [new PlainUpdate(length, length, char)];
    }

    /**
     * @param {number} position
     * @return {number}
     */
    getPrefixLength(position) {
        let prefixLength = 0;
        let i = 0;

        if (this.cachedPosition <= position) {
            prefixLength = this.cachedLength;
            i = this.cachedPosition;
        }

        for (; i < position; i++) {
            if (this.entries[i].visible) {
                prefixLength += this.entries[i].c.length;
            }
        }

        this.cachedPosition = position;
        this.cachedLength = prefixLength;

        return prefixLength;
    }

    /**
     * @param {GlobalId} gid
     * @return {array<PlainUpdate>}
     */
    delete(gid) {
        this.maxCounter = Math.max(this.maxCounter, gid.counter);
        const opStr = `${DELETE_OPERATION}-${gid.siteId}-${gid.counter}`;

        if (this.appliedOps.has(opStr)) {
            // console.warn(`Operation ${opStr} already applied`);
            return [];
        }

        let pos = this.findGid(gid)
        if (pos === -1) {
            throw new Error(`GID ${gid} not found`);
        }

        this.entries[pos].visible = false;
        this.appliedOps.add(opStr);
        // Entries are addressed in UTF-16 code units, matching CodeMirror positions. An entry holding an
        // astral code point spans two of them.
        const charLength = this.entries[pos].c.length;
        if (this.cachedPosition > pos) {
            this.cachedLength -= charLength;
        }

        let length = this.getPrefixLength(pos);
        return [new PlainUpdate(length, length + charLength, "")];
    }

    /**
     * @param {number} prefixLength
     * @return {number}
     */
    getPosition(prefixLength) {
        let position = 0;
        let length = 0;

        if (this.cachedLength <= prefixLength) {
            position = this.cachedPosition;
            length = this.cachedLength;
        }

        for (; length < prefixLength && position < this.entries.length; position++) {
            if (this.entries[position].visible) {
                length += this.entries[position].c.length;
            }
        }

        if (length !== prefixLength) {
            // Also catches a position landing inside a surrogate pair, which must never happen.
            throw new Error("Invalid prefix length");
        }

        this.cachedPosition = position;
        this.cachedLength = length;

        return position
    }


    /**
     * The gid of the character immediately left of `offset`, or null if the offset is before every
     * visible character. This is how a caret is put on the wire: a gid needs no transformation
     * against concurrent edits, because it stays valid forever and survives deletion as a tombstone.
     *
     * Returns null instead of throwing on a bad offset. Presence is decoration; it must never be able
     * to take down an editing session.
     *
     * @param {number} offset
     * @return {GlobalId|null}
     */
    offsetToGid(offset) {
        let position;
        try {
            position = this.getPosition(offset);
        } catch (e) {
            console.warn(`Cannot anchor offset ${offset}`, e);
            return null;
        }

        for (let i = position - 1; i >= 0; i--) {
            if (this.entries[i].visible) {
                return this.entries[i].gid;
            }
        }

        return null;
    }

    /**
     * Inverse of {@link offsetToGid}: the offset just right of the anchor character. A null gid means
     * the start of the document. Returns null when the gid is unknown, which happens legitimately when
     * a cursor referencing another site's character overtakes that character's own broadcast.
     *
     * @param {GlobalId|null} gid
     * @return {number|null}
     */
    gidToOffset(gid) {
        if (!gid) {
            return 0;
        }

        const position = this.findGid(gid);
        if (position === -1) {
            return null;
        }

        const entry = this.entries[position];
        // A tombstoned anchor still pins the caret to where that character used to be
        return this.getPrefixLength(position) + (entry.visible ? entry.c.length : 0);
    }

    /**
     * @param {number} from
     * @param {number} to
     * @param {string} value
     * @param {number} siteId
     * @return {CRDTEvent[]}
     */
    applyPlainUpdate(from, to, value, siteId) {
        /**
         * @type {CRDTEvent[]}
         */
        let result = []

        let position = this.getPosition(from);
        let entriesFrom = position - 1;
        let removedChars = to - from;

        for (let i = entriesFrom + 1; i < this.entries.length && removedChars > 0; i++) {
            if (this.entries[i].visible) {
                this.delete(this.entries[i].gid);
                result.push(new CRDTEvent(DELETE_OPERATION, this.entries[i].gid, null, null));
                removedChars -= this.entries[i].c.length;
            }
        }

        if (removedChars > 0) {
            throw new Error("Invalid to position. Not enough characters to delete");
        }

        // Iterate by code point so astral characters stay intact. Indexing with value[i] would split
        // them into lone surrogates, which cannot be serialized to JSON and desync the server.
        const chars = Array.from(value);
        let offset = 0;
        for (let i = 0; i < chars.length; i++) {
            let afterGid
            if (entriesFrom + i === -1) {
                afterGid = null;
            } else {
                afterGid = this.entries[entriesFrom + i].gid;
            }
            let gid = new GlobalId(this.maxCounter + 1, siteId);
            let char = chars[i];
            let insertEvent = this.insert(char, gid, afterGid)[0];
            console.assert(insertEvent.from === from + offset)
            offset += char.length;

            result.push(new CRDTEvent(INSERT_OPERATION, gid, char, afterGid));
        }

        return result;
    }
}