import {CRDTDocument, GlobalId, PlainUpdate} from "./document.js";


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

export function runAllTests() {
    console.log("Running document tests")
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
