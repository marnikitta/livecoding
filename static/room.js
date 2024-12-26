import {Compartment, EditorState, Transaction} from "@codemirror/state";

import {EditorView, showTooltip} from "@codemirror/view";
import {StateField} from "@codemirror/state"
import {CRDTDocument, CRDTEvent} from "./lib/document.js";
import {allColors, defaultExtensions, getLanguageByExtension} from "./lib/theme.js";
import {shallowRef} from "vue";

const RoomState = {
    connecting: 'connecting',
    waitingForName: 'waitingForName',
    editing: 'editing',
    terminated: 'terminated'
};

const MAX_DOCUMENT_LENGTH = 100_000;
const HEARTBIT_INTERVAL = 5000;

export default {
    template: `
      <div class="announcement announcement--error"
           :class="{'announcement--error': !compactionRequired, 'announcement--warn': compactionRequired}"
           v-if="roomState === RoomState.terminated">
        <template v-if="compactionRequired">
          Disconnected due to a large event log. All clients were disconnected for compaction. Refresh to reconnect.
        </template>
        <template v-else>
          Connection lost. <a class="announcement__copy-link" @click="copyText">Copy your work</a> to prevent losing it.
          Refresh the page to reconnect.
        </template>
      </div>
      <header class="header">
        <div class="title">
          <h1>Live coding editor</h1>
        </div>

        <div class="online-sites">
          <div class="online-sites__site" :style="{background: site.color}"
               v-for="[s, site] in sites" :key="s">
            {{ site.name }}<span v-if="siteId === s"> (you)</span>
          </div>
        </div>
      </header>

      <div class="announcement"
           v-if="roomState === RoomState.waitingForName 
           || roomState === RoomState.connecting">
        <form @submit.prevent="enterRoom(nameInput)">
          <label class="name-label" for="name">To edit the document, introduce yourself</label>
          <input type="text" id="name"
                 maxlength="30"
                 minlength="1"
                 size="15"
                 v-model="nameInput" placeholder="Your name"
                 required
                 :disabled="roomState === RoomState.connecting"
                 class="name-input"/>
          <button class="name-form--button" :disabled="roomState=== RoomState.connecting">
            Join the room<span v-if="roomState === RoomState.connecting"> (connecting...)</span>
          </button>
        </form>
      </div>
      <section id="editor-view">
      </section>
    `,
    props: {
        roomId: String,
        extension: String,
    },
    data() {
        return {
            roomState: RoomState.connecting,
            RoomState,
            siteId: null,
            /**
             * @type {CRDTDocument}
             */
            document: shallowRef(new CRDTDocument()),
            overflowed: false,
            nameInput: null,
            sites: new Map(),
            lastHeartbitTs: null,
            compactionRequired: false,
        }
    },
    async mounted() {
        console.log("Room mounted", {roomId: this.roomId, extension: this.extension})

        const cursorTooltipField = StateField.define({
            create: getCursorTooltips,

            update(tooltips, tr) {
                if (!tr.docChanged && !tr.selection) return tooltips
                return getCursorTooltips(tr.state)
            },

            provide: f => showTooltip.computeN([f], state => state.field(f))
        })

        function getCursorTooltips(state) {
            return state.selection.ranges
                .filter(range => range.empty)
                .map(range => {
                    let line = state.doc.lineAt(range.head)
                    let text = line.number + ":" + (range.head - line.from)
                    return {
                        pos: range.head,
                        above: true,
                        strictSide: true,
                        arrow: true,
                        create: () => {
                            let dom = document.createElement("div")
                            dom.className = "cm-tooltip-cursor"
                            dom.textContent = text
                            return {dom}
                        }
                    }
                })
        }

        const cursorTooltipBaseTheme = EditorView.baseTheme({
            ".cm-tooltip.cm-tooltip-cursor": {
                backgroundColor: "#66b",
                color: "white",
                border: "none",
                padding: "2px 7px",
                borderRadius: "4px",
                "& .cm-tooltip-arrow:before": {
                    borderTopColor: "#66b"
                },
                "& .cm-tooltip-arrow:after": {
                    borderTopColor: "transparent"
                }
            }
        })

        function cursorTooltip() {
            return [cursorTooltipField, cursorTooltipBaseTheme]
        }

        this.readonlyCompartment = new Compartment()
        let state = EditorState.create({
            doc: this.document.getText(),
            extensions: [
                ...defaultExtensions,
                ...cursorTooltip(),
                getLanguageByExtension(this.extension),
                this.readonlyCompartment.of(EditorView.editable.of(false)),
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

        let roomResponse = await fetch(`/resource/room/${this.roomId}`, {
            method: "GET",
        })
        if (!roomResponse.ok) {
            console.error(`Room ${this.roomId} not found`)
            this.$router.push("/")
            return
        }
        let roomModel = await roomResponse.json()
        console.info(`Fetched a room with ${roomModel.events.length} events`)

        // initial setup
        this.dispatchCrdtEvent(roomModel.events);

        let socket = new WebSocket(`ws://localhost:5000/resource/room/${this.roomId}/ws?offset=${roomModel.events.length}`);
        socket.onopen = () => {
            socket.send("Hello")
            console.info("Established WebSocket connection");

            this.lastHeartbitTs = Date.now()
            let pingChecker = setInterval(() => {
                if (Date.now() - this.lastHeartbitTs > HEARTBIT_INTERVAL * 2) {
                    console.error(`No ping received in ${HEARTBIT_INTERVAL * 2} seconds, terminating connection`)
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
    methods: {
        enterRoom(name) {
            console.info("Entering the room as", name)
            // this.$router.replace({query: {name: name}});

            this.socket.send(JSON.stringify({siteHello: {"name": name, "siteId": this.siteId}}))
            this.setReadonly(false)
            this.roomState = RoomState.editing
        },
        terminateEverything(compactionRequired = false) {
            if (this.roomState === RoomState.terminated) {
                console.info("Already terminated")
                return
            }
            console.error("Terminating everything");
            this.setReadonly(true);
            this.sites.clear();
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
            } else if ("crdtEvents" in msg) {
                this.dispatchCrdtEvent(msg.crdtEvents);
            } else if ("siteHello" in msg) {
                console.info("New site", msg.siteHello)
                this.sites.set(msg.siteHello.siteId, {
                    "name": msg.siteHello.name,
                    "color": allColors[this.sites.size % allColors.length]
                })
            } else if ("siteDisconnected" in msg) {
                console.info("Site disconnected", msg.siteDisconnected)
                this.sites.delete(msg.siteDisconnected.siteId)
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
            this.view.dispatch({
                effects: this.readonlyCompartment.reconfigure(EditorView.editable.of(!readonly))
            })
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
        },
        /**
         * @param {CRDTEvent[]} events
         */
        broadcastCrdtEvents(events) {
            this.socket.send(JSON.stringify({crdtEvents: events}))
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
                && newLength > MAX_DOCUMENT_LENGTH) {
                // console.log("Document is way too long")
                alert(`Your document has reached the ${MAX_DOCUMENT_LENGTH}-character limit. Please remove some text to continue`)

                this.overflowed = true;
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
        },
        async copyText() {
            try {
                let text = this.view.state.doc.toString()
                await navigator.clipboard.writeText(text);
                alert("Copied");
            } catch (e) {
                alert("Cannot copy");
                console.error(e)
            }
        },
    }
}