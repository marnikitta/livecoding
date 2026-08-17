import {Compartment, EditorState, Transaction} from "@codemirror/state";

import {EditorView} from "@codemirror/view";
import {CRDTDocument, CRDTEvent, gidKey, GlobalId} from "./lib/document.js";
import {allColors, defaultExtensions, getLanguageByExtension} from "./lib/theme.js";
import {clearAllRemoteCursors, clearRemoteCursor, remoteCursors, setRemoteCursor} from "./lib/presence.js";
import {shallowRef} from "vue";

/**
 * @typedef {object} RoomSettings
 * @property {number} heartbitInterval
 * @property {number} documentLimit
 */

const RoomState = {
    connecting: 'connecting',
    waitingForName: 'waitingForName',
    editing: 'editing',
    terminated: 'terminated'
};

// Cursor broadcasts are capped at one per this many milliseconds. Continuous movement costs at most
// ~16 messages a second, each a few dozen bytes, and none of them ever reaches the room's event log.
const CURSOR_THROTTLE_MS = 60;


export default {
    template: `
      <div class="announcement announcement--error"
           :class="{'announcement--error': !compactionRequired, 'announcement--warn': compactionRequired}"
           v-if="roomState === RoomState.terminated">
        <template v-if="compactionRequired">
          Disconnected due to a large event log. All clients were disconnected for compaction.
        </template>
        <template v-else>
          Connection lost. Document is read-only.
        </template>
        <a @click="reload()">Refresh</a> the page to reconnect.
      </div>
      <header class="header">
        <h1>Live coding editor</h1>

        <ul class="online-sites" v-if="sites.size > 0">
          <!--          <template v-for="index in 3" :key="index">-->
          <li
              class="online-sites__site"
              :class="{'online-sites__site--hidden': !site.visible,
              ['online-sites__site--color-' + (site.colorIdx + 1)]: true}"
              v-for="[s, site] in sites"
              :key="s">
            {{ site.name }}<span v-if="siteId === s">&nbsp;(you)</span>
          </li>
          <!--          </template>-->
        </ul>
      </header>

      <div class="announcement" v-if="roomState === RoomState.connecting">
        Connecting...
      </div>

      <div class="announcement"
           v-if="roomState === RoomState.waitingForName">
        <form class="name-form" @submit.prevent="enterRoom(name)">
          <label class="name-form__label" for="name">To edit the document, introduce yourself</label>
          <input type="text" id="name"
                 maxlength="30"
                 minlength="1"
                 size="10"
                 v-model="name" placeholder="Your name"
                 required
                 :disabled="roomState === RoomState.connecting"
                 class="name-input"/>
          <button :disabled="roomState=== RoomState.connecting">
            Join the room<span v-if="roomState === RoomState.connecting"> (connecting...)</span>
          </button>
        </form>
      </div>
      <section id="editor-view">
      </section>
    `,
    props: {
        roomId: {
            type: String,
            required: true
        },
        extension: {
            type: String,
            required: false
        }
    },
    data() {
        return {
            roomState: RoomState.connecting,
            RoomState,
            siteId: null,
            /**
             * @type {RoomSettings|null}
             */
            settings: null,
            /**
             * @type {CRDTDocument}
             */
            document: shallowRef(new CRDTDocument()),
            /**
             * @type {EditorView|null}
             */
            view: shallowRef(null),
            name: null,
            sites: new Map(),
            lastHeartbitTs: null,
            compactionRequired: false,
            readonlyCompartment: shallowRef(new Compartment())
        }
    },

    created() {
        document.addEventListener('visibilitychange', this.visibilityChange, false);

        // Deliberately outside data(): these are the source of truth for remote carets and Vue's proxy
        // has no business walking CRDT identifiers on every keystroke, the same reason this.socket is
        // kept off the reactive object.
        /**
         * @type {Map<number, {anchor: ?GlobalId, head: ?GlobalId}>}
         */
        this.remoteCursorGids = new Map();
        /**
         * Sites whose anchors we could not resolve yet, retried once new events land.
         * @type {Set<number>}
         */
        this.pendingCursorSites = new Set();
        this.cursorSendTimer = null;
        this.lastSentCursor = null;
        this.lastCursorSentTs = 0;
    },

    async mounted() {
        console.log("Room mounted", {roomId: this.roomId, extension: this.extension})

        let roomResponse = await fetch(`/resource/room/${this.roomId}`, {
            method: "GET",
        })
        if (roomResponse.status === 404) {
            console.error(`Room ${this.roomId} not found`)
            this.$router.push({path: "/", query: {errorCode: "roomNotFound"}})
            return
        } else if (!roomResponse.ok) {
            console.error(`Got an error while fetching room ${this.roomId}`, roomResponse)
            this.$router.push({path: "/", query: {errorCode: "unknownError"}})
            return
        }
        let roomModel = await roomResponse.json()
        console.info(`Fetched a room with ${roomModel.events.length} events. Settings:`, roomModel.settings)
        this.settings = roomModel.settings

        let state = EditorState.create({
            doc: this.document.getText(),
            extensions: [
                this.readonlyCompartment.of([
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true)
                ]),
                getLanguageByExtension(this.extension),
                ...defaultExtensions,
                // Room-only. defaultExtensions is shared with the read-only demo editor on the home page
                remoteCursors(),
                EditorView.updateListener.of(update => {
                    try {
                        this.onViewUpdate(update)
                    } catch (e) {
                        console.error("Failed to apply view update. Terminating.")
                        this.terminateEverything()
                    }
                }),
                EditorState.changeFilter.of(transaction => {
                    return this.checkLength(transaction)
                }),
            ]
        });

        this.view = new EditorView({
            state: state,
            parent: document.getElementById("editor-view"),
        });

        // initial setup
        this.dispatchCrdtEvent(roomModel.events);

        let socket = new WebSocket(this.getWebsocketPath(this.roomId, roomModel.events.length));
        socket.onopen = () => {
            socket.send("Hello")
            console.info("Established WebSocket connection");

            this.lastHeartbitTs = Date.now()
            let pingChecker = setInterval(() => {
                let intervalMs = this.settings.heartbitInterval * 1000
                if (Date.now() - this.lastHeartbitTs > intervalMs * 2) {
                    console.error(`No ping received in ${this.settings.heartbitInterval} seconds, terminating connection`)
                    this.terminateEverything()
                    clearInterval(pingChecker)
                }
            }, 1000)
        };
        socket.onmessage = (event) => {
            try {
                this.onSocketMessage(event)
            } catch (e) {
                console.error("Failed to process incoming message. Terminating")
                this.terminateEverything()
            }
        };
        socket.onclose = (event) => {
            console.info("WebSocket connection closed", event)
            this.terminateEverything()
        }
        socket.onerror = (event) => {
            console.info("WebSocket connection error", event)
            this.terminateEverything()
        }

        this.socket = socket
    },
    watch: {
        roomState(newValue) {
            let readonly = newValue !== RoomState.editing

            let effects = [this.readonlyCompartment.reconfigure([EditorView.editable.of(!readonly),
                EditorState.readOnly.of(readonly)])]

            if (newValue === RoomState.terminated) {
                // Riding the watcher rather than dispatching straight from terminateEverything, which
                // can be reached from inside an editor update, where dispatching is not allowed
                effects.push(clearAllRemoteCursors.of(null))
            }

            this.view.dispatch({effects})
        }
    },
    methods: {
        enterRoom(name) {
            console.info("Entering the room as", name)
            // this.$router.replace({query: {name: name}});

            this.socket.send(JSON.stringify({sitePresence: {"name": name, "siteId": this.siteId, "visible": true}}))
            this.name = name
            sessionStorage.setItem(this.roomId, JSON.stringify({name}));

            this.roomState = RoomState.editing
            // Publish a cursor straight away, so others see the joiner without waiting for a keystroke
            this.broadcastCursor()
        },
        terminateEverything(compactionRequired = false) {
            if (this.roomState === RoomState.terminated) {
                console.info("Already terminated")
                return
            }
            console.error("Terminating everything");
            this.sites.clear();
            this.remoteCursorGids.clear();
            this.pendingCursorSites.clear();
            this.lastSentCursor = null;
            this.lastCursorSentTs = 0;
            if (this.cursorSendTimer !== null) {
                clearTimeout(this.cursorSendTimer);
                this.cursorSendTimer = null;
            }
            this.compactionRequired = compactionRequired
            this.siteId = null;
            this.roomState = RoomState.terminated;
            try {
                this.socket.close()
            } catch (e) {
                console.error(e)
            }
            window.scrollTo(0, 0);
        },
        onSocketMessage(event) {
            let msg = JSON.parse(event.data);
            if ("setSiteId" in msg) {
                if (this.siteId !== null) {
                    console.error("Site ID already set", this.siteId, msg.setSiteId.siteId)
                    this.terminateEverything()
                    return
                }
                this.siteId = msg.setSiteId.siteId;
                console.info("Site ID set to", this.siteId)
                this.roomState = RoomState.waitingForName

                if (sessionStorage.hasOwnProperty(this.roomId)) {
                    let {name} = JSON.parse(sessionStorage.getItem(this.roomId))
                    this.enterRoom(name)
                } else {
                    this.roomState = RoomState.waitingForName
                }
            } else if ("crdtEvents" in msg) {
                this.dispatchCrdtEvent(msg.crdtEvents);
            } else if ("sitePresence" in msg) {
                console.info("New site", msg.sitePresence)
                let presence = msg.sitePresence
                this.sites.set(presence.siteId, {
                    "name": presence.name,
                    "visible": presence.visible,
                    "colorIdx": presence.siteId % allColors.length
                })
                if (this.remoteCursorGids.has(presence.siteId)) {
                    // Redraw so a backgrounded tab dims its caret too
                    this.resolveRemoteCursors([presence.siteId])
                }
            } else if ("siteCursor" in msg) {
                this.applyRemoteCursor(msg.siteCursor)
            } else if ("siteDisconnected" in msg) {
                console.info("Site disconnected", msg.siteDisconnected)
                let siteId = msg.siteDisconnected.siteId
                this.sites.delete(siteId)
                this.remoteCursorGids.delete(siteId)
                this.pendingCursorSites.delete(siteId)
                this.view.dispatch({effects: clearRemoteCursor.of(siteId)})
            } else if ("heartbit" in msg) {
                this.lastHeartbitTs = Date.now()
            } else if ("compactionRequired" in msg) {
                console.info("Received compaction request");
                this.terminateEverything(true);
            } else {
                console.error("Unknown message", msg)
                this.terminateEverything()
            }
        },
        setReadonly(readonly) {
        },
        /**
         * @param {CRDTEvent[]} events
         */
        dispatchCrdtEvent(events) {
            let allUpdates = []
            for (const update of this.document.applyEvents(events)) {
                allUpdates.push(update)
            }
            for (const update of allUpdates) {
                let t = this.view.state.update({
                    changes: {
                        from: update.from,
                        to: update.to,
                        insert: update.value
                    }
                });
                this.view.dispatch(t);
            }

            // New characters may be exactly the ones an unresolved anchor was waiting for. Cursors that
            // already resolved need no attention: the editor maps their offsets through the changes above.
            if (this.pendingCursorSites.size > 0) {
                this.resolveRemoteCursors([...this.pendingCursorSites])
            }
        },
        /**
         * @param {CRDTEvent[]} events
         */
        broadcastCrdtEvents(events) {
            this.socket.send(JSON.stringify({crdtEvents: events}))
        },
        /**
         * Remember where another site is, and try to put it on screen.
         *
         * @param {{siteId: number, anchor: ?GlobalId, head: ?GlobalId}} cursor
         */
        applyRemoteCursor(cursor) {
            if (cursor.siteId === this.siteId) {
                return
            }

            this.remoteCursorGids.set(cursor.siteId, {
                anchor: cursor.anchor ?? null,
                head: cursor.head ?? null
            })
            this.resolveRemoteCursors([cursor.siteId])
        },
        /**
         * Turn stored global ids into editor offsets and push them into the view.
         *
         * An id can be unknown for a moment: every site has its own broadcast loop on the server, so a
         * cursor anchored on another site's character can arrive before that character does. Such a site
         * keeps whatever position it had and is retried once the missing events land.
         *
         * @param {number[]} siteIds
         */
        resolveRemoteCursors(siteIds) {
            let effects = []

            for (const siteId of siteIds) {
                let gids = this.remoteCursorGids.get(siteId)
                if (gids === undefined) {
                    continue
                }

                let anchor = this.document.gidToOffset(gids.anchor)
                let head = this.document.gidToOffset(gids.head)
                if (anchor === null || head === null) {
                    this.pendingCursorSites.add(siteId)
                    continue
                }
                this.pendingCursorSites.delete(siteId)

                let site = this.sites.get(siteId)
                effects.push(setRemoteCursor.of({
                    siteId: siteId,
                    anchor: anchor,
                    head: head,
                    colorIdx: siteId % allColors.length,
                    visible: site === undefined ? true : site.visible
                }))
            }

            if (effects.length > 0) {
                this.view.dispatch({effects})
            }
        },
        scheduleCursorBroadcast() {
            if (this.roomState !== RoomState.editing || this.cursorSendTimer !== null) {
                return
            }

            // Leading edge: a move that follows a pause goes out immediately, which is the common case
            // and the one where latency is actually felt. Only continuous movement is deferred, and
            // then only by what is left of the window, so the cap holds without ever adding a fixed
            // delay to a single click or keystroke.
            let sinceLastSend = Date.now() - this.lastCursorSentTs
            if (sinceLastSend >= CURSOR_THROTTLE_MS) {
                this.broadcastCursor()
                return
            }

            this.cursorSendTimer = setTimeout(() => {
                this.cursorSendTimer = null
                this.broadcastCursor()
            }, CURSOR_THROTTLE_MS - sinceLastSend)
        },
        /**
         * Anchor the local selection to the characters it sits next to and send it.
         *
         * Global ids rather than offsets, so the receiver never has to transform anything against
         * concurrent edits: an id stays valid forever and survives deletion as a tombstone.
         */
        broadcastCursor() {
            if (this.roomState !== RoomState.editing || this.siteId === null) {
                return
            }

            try {
                let range = this.view.state.selection.main
                let anchor = this.document.offsetToGid(range.anchor)
                let head = this.document.offsetToGid(range.head)

                // gidKey, not string interpolation: gids received over the wire are plain objects and
                // would all coerce to "[object Object]", making every position look unchanged
                let signature = `${gidKey(anchor)}/${gidKey(head)}`
                if (signature === this.lastSentCursor) {
                    return
                }
                this.lastSentCursor = signature
                this.lastCursorSentTs = Date.now()

                this.socket.send(JSON.stringify({
                    siteCursor: {siteId: this.siteId, anchor: anchor, head: head}
                }))
            } catch (e) {
                // Presence is decoration. It must never be able to take down an editing session.
                console.warn("Failed to broadcast cursor", e)
            }
        },
        /**
         * @param {Transaction} transaction
         * @return {boolean}
         */
        checkLength(transaction) {
            if (!transaction.annotation(Transaction.userEvent)) {
                return true;
            }

            const newLength = transaction.newDoc.length
            if (transaction.docChanged
                && transaction.startState.doc.length < newLength
                && newLength > this.settings.documentLimit) {
                // console.log("Document is way too long")
                alert(`Your document has reached the ${this.settings.documentLimit}-character limit. Please remove some text to continue`)
                return false;
            }

            return true;
        },
        onViewUpdate(update) {
            const userEvent = update.transactions.some(t => t.annotation(Transaction.userEvent));

            if (update.docChanged && userEvent) {
                let events = []

                update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                    let crdtEvents = this.document.applyPlainUpdate(fromA, toA, inserted.toString(), this.siteId)
                    events = events.concat(crdtEvents)
                });

                if (events.length > 0) {
                    this.broadcastCrdtEvents(events)
                }
            }

            if (update.selectionSet || update.docChanged) {
                this.scheduleCursorBroadcast()
            }
        },
        /**
         * @param {string} roomId
         * @param {number} offset
         * @return {string}
         */
        getWebsocketPath(roomId, offset) {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            return `${protocol}${window.location.host}/resource/room/${this.roomId}/ws?offset=${offset}`
        },
        reload() {
            window.location.reload()
        },
        visibilityChange() {
            if (this.roomState === RoomState.editing) {
                let visible = Boolean(!document.hidden)

                if (visible) {
                    console.info("Document visible")
                } else {
                    console.info("Document document hidden")
                }

                this.socket.send(JSON.stringify({
                    sitePresence: {
                        siteId: this.siteId,
                        name: this.name,
                        visible: visible
                    }
                }))
            }
        }
    }
}