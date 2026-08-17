import {CRDTDocument, CRDTEvent, gidKey, GlobalId, PlainUpdate} from "./document.js";


function testInsertion() {
    let document = new CRDTDocument();
    document.insert("a", new GlobalId(1, 1), null);
    document.insert("c", new GlobalId(2, 1), new GlobalId(1, 1));
    document.insert("b", new GlobalId(3, 1), new GlobalId(1, 1));

    console.assert(document.getText() === "abc");
}

function testConcurrentInsertion() {
    let document = new CRDTDocument();
    document.insert("a", new GlobalId(1, 1), null);
    document.insert("c", new GlobalId(2, 3), new GlobalId(1, 1));
    document.insert("b", new GlobalId(2, 2), new GlobalId(1, 1));

    console.assert(document.getText() === "acb");
}

function testDelete() {
    let document = new CRDTDocument();
    document.insert("a", new GlobalId(1, 1), null);
    document.insert("b", new GlobalId(2, 1), new GlobalId(1, 1,));
    console.assert(document.getText() === "ab");

    document.delete(new GlobalId(1, 1));
    console.assert(document.getText() === "b");
    document.delete(new GlobalId(1, 1));
    console.assert(document.getText() === "b");

    document.delete(new GlobalId(2, 1));
    console.assert(document.getText() === "");
}

function testDeleteSelection() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "abracadabra", 0);
    console.assert(document.getText() === "abracadabra", 0);

    document.applyPlainUpdate(1, 11, "", 0);
    console.assert(document.getText() === "a");
}

function testAbsolutePositions() {
    let document = new CRDTDocument();
    let ins1 = document.insert("a", new GlobalId(1, 1), null)[0];
    console.assert(ins1.from === 0);
    console.assert(ins1.to === 0);
    console.assert(ins1.value === "a");

    let ins2 = document.insert("b", new GlobalId(2, 1), new GlobalId(1, 1,))[0];
    console.assert(ins2.from === 1);
    console.assert(ins2.to === 1);
    console.assert(ins2.value === "b");

    let del2 = document.delete(new GlobalId(2, 1))[0];
    console.assert(del2.from === 1);
    console.assert(del2.to === 2);
    console.assert(del2.value === "");

    let del1 = document.delete(new GlobalId(1, 1))[0];
    console.assert(del1.from === 0);
    console.assert(del1.to === 1);
    console.assert(del1.value === "");
}

function testPlainInsert() {
    let document = new CRDTDocument();
    let document2 = new CRDTDocument();

    document2.applyEvents(document.applyPlainUpdate(0, 0, "abra", 0))
    console.assert(document.getText() === "abra");
    console.assert(document2.getText() === "abra");

    document2.applyEvents(document.applyPlainUpdate(4, 4, "cadabra", 0))
    console.assert(document.getText() === "abracadabra");
    console.assert(document2.getText() === "abracadabra");

    document2.applyEvents(document.applyPlainUpdate(4, 4, "babra", 0))
    console.assert(document.getText() === "abrababracadabra");
    console.assert(document2.getText() === "abrababracadabra");
}

function testPlainDelete() {
    let document = new CRDTDocument();
    let document2 = new CRDTDocument()

    document2.applyEvents(document.applyPlainUpdate(0, 0, "aba", 0))
    console.assert(document.getText() === "aba");
    console.assert(document2.getText() === "aba");

    document2.applyEvents(document.applyPlainUpdate(0, 3, "", 0))
    console.assert(document.getText() === "");
    console.assert(document2.getText() === "");

    document2.applyEvents(document.applyPlainUpdate(0, 0, "eba", 0));
    console.assert(document.getText() === "eba");
    console.assert(document2.getText() === "eba");

    document2.applyEvents(document.applyPlainUpdate(0, 3, "", 0));
    console.assert(document.getText() === "");
    console.assert(document2.getText() === "");
}

function testPlainReplace() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "aba", 0);
    console.assert(document.getText() === "aba");

    document.applyPlainUpdate(0, 3, "eba", 0);
    console.assert(document.getText() === "eba");

    document.applyPlainUpdate(0, 3, "caba", 0);
    console.assert(document.getText() === "caba");

    document.applyPlainUpdate(0, 1, "k", 0);
    console.assert(document.getText() === "kaba");
}

/**
 * @param {string} value
 * @param {number} maxLen
 * @return {PlainUpdate}
 */
function generateRandomEdit(value, maxLen = 20) {
    let pos = Math.floor(Math.random() * (value.length + 1));
    let len = Math.floor(Math.random() * maxLen);
    let text = "";
    for (let j = 0; j < len; ++j) {
        text += String.fromCharCode(97 + Math.floor(Math.random() * 26));
    }

    let operation = Math.floor(Math.random() * 3);
    if (operation === 0 && value.length > 0) {
        // Delete
        let delLen = Math.min(len, value.length - pos);
        return new PlainUpdate(pos, pos + delLen, "");
    } else if (operation === 2 && value.length > 0) {
        // Replace
        let repLen = Math.min(len, value.length - pos);
        return new PlainUpdate(pos, pos + repLen, text);
    } else {
        // Insert
        return new PlainUpdate(pos, pos, text);
    }
}

/**
 * @param {string} value
 * @param {PlainUpdate} plainUpdate
 * @return {string}
 */
function applyEdit(value, plainUpdate) {
    return value.slice(0, plainUpdate.from) + plainUpdate.value + value.slice(plainUpdate.to);
}

function testRandomOneWay() {
    let gt = ""

    let document = new CRDTDocument();
    let events = [];

    for (let i = 0; i < 1000; ++i) {
        let update = generateRandomEdit(gt);
        gt = applyEdit(gt, update);
        events.push(...document.applyPlainUpdate(update.from, update.to, update.value, 0))
    }

    let otherDocument = new CRDTDocument();
    events.forEach(event => otherDocument.applyEvents([event]));

    let otherDocumentBatch = new CRDTDocument();
    otherDocumentBatch.applyEvents(events)

    console.assert(document.getText() === gt);
    console.assert(otherDocument.getText() === gt);
    console.assert(otherDocumentBatch.getText() === gt);
}

function testRandomEdits() {
    let aliceDocument = new CRDTDocument();
    let bobDocument = new CRDTDocument()

    let aliceQueue = [];
    let bobQueue = [];

    for (let i = 0; i < 1000; ++i) {
        let event = Math.floor(Math.random() * 4);

        if (event === 0) {
            let update = generateRandomEdit(aliceDocument.getText());
            bobQueue.push(...aliceDocument.applyPlainUpdate(update.from, update.to, update.value, 0));
        } else if (event === 1) {
            let update = generateRandomEdit(bobDocument.getText());
            aliceQueue.push(...bobDocument.applyPlainUpdate(update.from, update.to, update.value, 1));
        } else if (event === 2) {
            aliceDocument.applyEvents(aliceQueue);
            aliceQueue = [];
        } else if (event === 3) {
            bobDocument.applyEvents(bobQueue);
            bobQueue = [];
        }
    }

    aliceDocument.applyEvents(aliceQueue);
    bobDocument.applyEvents(bobQueue);

    console.assert(aliceDocument.getText() === bobDocument.getText());
}

function testLongInsert() {
    let document = new CRDTDocument();
    let text = "a".repeat(1000);
    let events = document.applyPlainUpdate(0, 0, text, 0);

    let otherDocument = new CRDTDocument();
    let otherUpdate = otherDocument.applyEvents(events);
    console.assert(otherUpdate.length === 1);
    console.assert(otherUpdate[0].from === 0);
    console.assert(otherUpdate[0].to === 0);
    console.assert(otherUpdate[0].value === text);
}

function testLongDelete() {
    let document = new CRDTDocument();
    let otherDocument = new CRDTDocument();

    let text = "a".repeat(1000);
    let events = document.applyPlainUpdate(0, 0, text, 0);
    otherDocument.applyEvents(events);

    let deleteEvents = document.applyPlainUpdate(0, text.length, "", 0);

    let otherUpdate = otherDocument.applyEvents(deleteEvents);
    console.assert(otherUpdate.length === 1);
    console.assert(otherUpdate[0].from === 0);
    console.assert(otherUpdate[0].to === text.length);
    console.assert(otherUpdate[0].value === "");
}

// Astral characters (emoji, rare CJK, math symbols) take two UTF-16 code units in JS but one code point
// in Python. The CRDT unit is a code point; CodeMirror offsets stay in UTF-16 code units.
function testAstralInsert() {
    let document = new CRDTDocument();
    let other = new CRDTDocument();

    let events = document.applyPlainUpdate(0, 0, "a😀b", 0);
    // One event per code point, never a lone surrogate.
    console.assert(events.length === 3, `expected 3 events, got ${events.length}`);
    console.assert(events[1].char === "😀", `expected whole emoji, got ${JSON.stringify(events[1].char)}`);
    console.assert(events.every(e => JSON.parse(JSON.stringify(e.char ?? "")) === (e.char ?? "")),
        "chars must survive a JSON round trip");

    console.assert(document.getText() === "a😀b");
    other.applyEvents(events);
    console.assert(other.getText() === "a😀b", `replica got ${JSON.stringify(other.getText())}`);
}

function testAstralPositions() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "😀x", 0);

    // "😀" occupies offsets 0..2, so "x" starts at 2 in CodeMirror coordinates.
    console.assert(document.getPosition(0) === 0);
    console.assert(document.getPosition(2) === 1, `getPosition(2) === ${document.getPosition(2)}`);
    console.assert(document.getPosition(3) === 2, `getPosition(3) === ${document.getPosition(3)}`);
}

function testAstralDelete() {
    let document = new CRDTDocument();
    let other = new CRDTDocument();
    other.applyEvents(document.applyPlainUpdate(0, 0, "a😀b", 0));

    // Delete the emoji: CodeMirror reports a 2-unit range.
    let events = document.applyPlainUpdate(1, 3, "", 0);
    console.assert(document.getText() === "ab", `got ${JSON.stringify(document.getText())}`);

    let updates = other.applyEvents(events);
    console.assert(other.getText() === "ab", `replica got ${JSON.stringify(other.getText())}`);
    console.assert(updates.length === 1);
    console.assert(updates[0].from === 1, `from === ${updates[0].from}`);
    console.assert(updates[0].to === 3, `to === ${updates[0].to}`);
}

// A room reloaded from disk is rebuilt by Python, which emits one event per code point.
function testServerReplayOfAstralChar() {
    let document = new CRDTDocument();
    document.applyEvents([
        new CRDTEvent("insert", new GlobalId(1, 0), "😀", null),
        new CRDTEvent("insert", new GlobalId(2, 0), "b", new GlobalId(1, 0)),
    ]);
    console.assert(document.getText() === "😀b", `got ${JSON.stringify(document.getText())}`);

    // Local editing on top of server-provided entries must stay aligned.
    document.applyPlainUpdate(3, 3, "c", 0);
    console.assert(document.getText() === "😀bc", `got ${JSON.stringify(document.getText())}`);
}

function testRtlAndCombiningMarks() {
    let document = new CRDTDocument();
    let other = new CRDTDocument();
    // Hebrew, Arabic, a combining acute accent, and a bidi override control character.
    let text = "שלום ا́e‮abc";
    other.applyEvents(document.applyPlainUpdate(0, 0, text, 0));
    console.assert(document.getText() === text);
    console.assert(other.getText() === text, "RTL/combining text must replicate verbatim");
}

// Cursor anchors: a caret is put on the wire as the gid of the character to its left, so that it needs
// no transformation against concurrent edits.
function testCursorAnchorRoundTrip() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "abracadabra", 0);

    for (let offset = 0; offset <= "abracadabra".length; offset++) {
        let gid = document.offsetToGid(offset);
        console.assert(document.gidToOffset(gid) === offset,
            `offset ${offset} round-tripped to ${document.gidToOffset(gid)}`);
    }

    // Nothing to the left of offset 0, which is what a null gid means on the wire.
    console.assert(document.offsetToGid(0) === null);
    console.assert(document.gidToOffset(null) === 0);
}

function testCursorAnchorSurvivesConcurrentInsert() {
    let document = new CRDTDocument();
    let other = new CRDTDocument();
    other.applyEvents(document.applyPlainUpdate(0, 0, "abracadabra", 0));

    // A caret sitting after "abra" on the remote replica.
    let gid = other.offsetToGid(4);
    console.assert(document.gidToOffset(gid) === 4);

    // Someone types ahead of it. The caret must stay glued to its character, not slide.
    other.applyEvents(document.applyPlainUpdate(0, 0, "XYZ", 0));
    console.assert(document.gidToOffset(gid) === 7, `got ${document.gidToOffset(gid)}`);
    console.assert(other.gidToOffset(gid) === 7, `replica got ${other.gidToOffset(gid)}`);
}

function testCursorAnchorSurvivesDeletedAnchor() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "abracadabra", 0);

    let gid = document.offsetToGid(4);
    // Delete the anchor character itself. The tombstone pins the caret where it used to be.
    document.applyPlainUpdate(3, 4, "", 0);
    console.assert(document.getText() === "abrcadabra");
    console.assert(document.gidToOffset(gid) === 3, `got ${document.gidToOffset(gid)}`);
}

function testCursorAnchorUnknownGid() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "abra", 0);

    // A cursor can overtake the events it references, and a hostile client can invent one outright.
    // Neither may throw.
    console.assert(document.gidToOffset(new GlobalId(999999, 99)) === null);
}

function testCursorAnchorAstral() {
    let document = new CRDTDocument();
    document.applyPlainUpdate(0, 0, "a😀b", 0);

    // Offsets stay in UTF-16 code units, so the caret after the emoji is at 3.
    let gid = document.offsetToGid(3);
    console.assert(document.gidToOffset(gid) === 3, `got ${document.gidToOffset(gid)}`);
    console.assert(document.offsetToGid(1) !== null);
}

// Entries built from incoming events hold plain JSON gids, not GlobalId instances. Anything that keys
// on a gid has to survive that, or cursors anchored in text the other side typed all look identical and
// stop being broadcast, which shows up as presence working in one direction only.
function testGidKeyOnWireObjects() {
    let document = new CRDTDocument();
    // Exactly what arrives from the socket: JSON.parse output, no prototype.
    let wireEvents = JSON.parse(JSON.stringify([
        new CRDTEvent("insert", new GlobalId(1, 7), "a", null),
        new CRDTEvent("insert", new GlobalId(2, 7), "b", new GlobalId(1, 7)),
        new CRDTEvent("insert", new GlobalId(3, 7), "c", new GlobalId(2, 7)),
    ]));
    document.applyEvents(wireEvents);
    console.assert(document.getText() === "abc");

    let keys = [0, 1, 2, 3].map(offset => gidKey(document.offsetToGid(offset)));
    console.assert(new Set(keys).size === 4, `every offset must key differently, got ${JSON.stringify(keys)}`);
    console.assert(keys[0] === "-", `offset 0 has no anchor, got ${keys[0]}`);
    console.assert(keys[1] === "1@7", `got ${keys[1]}`);

    // A locally created id and the wire form of the same id must agree.
    console.assert(gidKey(new GlobalId(1, 7)) === gidKey({counter: 1, siteId: 7}));
}

export function runAllTests() {
    console.log("Running document tests")
    testGidKeyOnWireObjects();
    testCursorAnchorRoundTrip();
    testCursorAnchorSurvivesConcurrentInsert();
    testCursorAnchorSurvivesDeletedAnchor();
    testCursorAnchorUnknownGid();
    testCursorAnchorAstral();
    testAstralInsert();
    testAstralPositions();
    testAstralDelete();
    testServerReplayOfAstralChar();
    testRtlAndCombiningMarks();
    testDeleteSelection();
    testInsertion();
    testConcurrentInsertion();
    testDelete();
    testAbsolutePositions();
    testPlainInsert();
    testPlainDelete();
    testPlainReplace();
    testLongInsert();
    testRandomOneWay();
    testRandomEdits();
    testLongDelete();
    console.log("Tests passed")
}
