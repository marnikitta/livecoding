import {Decoration, EditorView, WidgetType} from "@codemirror/view";
import {StateEffect, StateField} from "@codemirror/state";
import {allColors} from "./theme.js";

/**
 * Remote carets and selections, drawn as decorations over the local document.
 *
 * Positions arrive here as plain offsets, already resolved from CRDT global ids by the caller. Between
 * two cursor messages they are mapped through the editor's own change set, which is exact, so a remote
 * caret stays glued to its character while you type around it.
 *
 * @typedef {object} RemoteCursor
 * @property {number} siteId
 * @property {number} anchor - selection start
 * @property {number} head - the caret itself; may be before `anchor` for a backwards selection
 * @property {number} colorIdx - index into {@link allColors}, shared with the header chips
 * @property {boolean} visible - false when the site's tab is backgrounded
 */

/**
 * Adds or replaces one site's cursor. Payload is a {@link RemoteCursor}.
 */
export const setRemoteCursor = StateEffect.define();

/**
 * Removes one site's cursor. Payload is a siteId.
 */
export const clearRemoteCursor = StateEffect.define();

/**
 * Removes every cursor, for when the session ends.
 */
export const clearAllRemoteCursors = StateEffect.define();

class CaretWidget extends WidgetType {
    /**
     * @param {string} color
     * @param {boolean} dimmed
     */
    constructor(color, dimmed) {
        super();
        this.color = color;
        this.dimmed = dimmed;
    }

    /**
     * @param {CaretWidget} other
     * @return {boolean}
     */
    eq(other) {
        return other.color === this.color && other.dimmed === this.dimmed;
    }

    toDOM() {
        // Zero width, so it never shifts the text it sits in
        let span = window.document.createElement("span");
        span.className = "cm-remote-cursor" + (this.dimmed ? " cm-remote--dimmed" : "");
        span.style.borderLeftColor = this.color;
        return span;
    }

    ignoreEvent() {
        return true;
    }
}

/**
 * @type {StateField<Map<number, RemoteCursor>>}
 */
const remoteCursorField = StateField.define({
    create() {
        return new Map();
    },

    update(cursors, tr) {
        let result = cursors;

        if (tr.docChanged && cursors.size > 0) {
            result = new Map();
            for (const [siteId, cursor] of cursors) {
                // Associate with the character to the left, which is exactly what the global id the
                // position came from would resolve to. Mapping and re-resolution therefore agree, and
                // the next cursor message lands without a visible jump.
                result.set(siteId, {
                    ...cursor,
                    anchor: tr.changes.mapPos(cursor.anchor, -1),
                    head: tr.changes.mapPos(cursor.head, -1),
                });
            }
        }

        for (const effect of tr.effects) {
            if (effect.is(setRemoteCursor)) {
                if (result === cursors) {
                    result = new Map(cursors);
                }
                result.set(effect.value.siteId, effect.value);
            } else if (effect.is(clearRemoteCursor)) {
                if (result === cursors) {
                    result = new Map(cursors);
                }
                result.delete(effect.value);
            } else if (effect.is(clearAllRemoteCursors)) {
                result = new Map();
            }
        }

        return result;
    }
});

const remoteCursorDecorations = EditorView.decorations.compute([remoteCursorField], state => {
    const cursors = state.field(remoteCursorField);
    if (cursors.size === 0) {
        return Decoration.none;
    }

    const docLength = state.doc.length;
    const clamp = (pos) => Math.min(Math.max(pos, 0), docLength);

    let ranges = [];
    for (const cursor of cursors.values()) {
        const color = allColors[cursor.colorIdx % allColors.length];
        const dimmed = !cursor.visible;

        const anchor = clamp(cursor.anchor);
        const head = clamp(cursor.head);
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);

        if (from !== to) {
            ranges.push(Decoration.mark({
                class: "cm-remote-selection" + (dimmed ? " cm-remote--dimmed" : ""),
                // The palette lives in JS, so the per-site color cannot come from a class
                attributes: {style: `background-color: ${color}33`}
            }).range(from, to));
        }

        ranges.push(Decoration.widget({
            widget: new CaretWidget(color, dimmed),
            side: 1
        }).range(head));
    }

    // Sorting is left to RangeSet, which knows how widgets and marks order at a shared position
    return Decoration.set(ranges, true);
});

/**
 * @return {import("@codemirror/state").Extension}
 */
export function remoteCursors() {
    return [remoteCursorField, remoteCursorDecorations];
}
