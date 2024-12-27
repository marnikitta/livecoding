import {Compartment, EditorState, Transaction} from "@codemirror/state";

import {EditorView} from "@codemirror/view";
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
          Disconnected due to a large event log. All clients were disconnected for compaction.
        </template>
        <template v-else>
          Connection lost.
        </template>
        <a class="announcement__copy-link" @click="reload()">Refresh</a> the page to reconnect.
      </div>
      <header class="header">
        <div class="title">
          <h1>Live coding editor</h1>
        </div>

        <div class="online-sites" v-if="sites.size > 0">
          <div class="online-sites__site" :style="{background: site.color}"
               v-for="[s, site] in sites" :key="s">
            {{ site.name }}<span v-if="siteId === s">&nbsp;(you)</span>
          </div>
        </div>
      </header>

      <div class="announcement" v-if="roomState === RoomState.connecting">
        Connecting...
      </div>

      <div class="announcement"
           v-if="roomState === RoomState.waitingForName">
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
            nameInput: null,
            sites: new Map(),
            lastHeartbitTs: null,
            compactionRequired: false,
        }
    },
    async mounted() {
        console.log("Room mounted", {roomId: this.roomId, extension: this.extension})

        this.readonlyCompartment = new Compartment()
        this.editableCompartment = new Compartment()

        let state = EditorState.create({
            doc: this.document.getText(),
            extensions: [
                this.editableCompartment.of(EditorView.editable.of(false)),
                this.readonlyCompartment.of(EditorState.readOnly.of(true)),
                ...defaultExtensions,
                getLanguageByExtension(this.extension),
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

        let socket = new WebSocket(this.getWebsocketPath(this.roomId, roomModel.events.length));
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
            sessionStorage.setItem(this.roomId, JSON.stringify({name}));
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

                if (sessionStorage.hasOwnProperty(this.roomId)) {
                    let {name} = JSON.parse(sessionStorage.getItem(this.roomId))
                    this.enterRoom(name)
                } else {
                    this.roomState = RoomState.waitingForName
                }
            } else if ("crdtEvents" in msg) {
                this.dispatchCrdtEvent(msg.crdtEvents);
            } else if ("siteHello" in msg) {
                console.info("New site", msg.siteHello)
                this.sites.set(msg.siteHello.siteId, {
                    "name": msg.siteHello.name,
                    "color": allColors[msg.siteHello.siteId % allColors.length]
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
                effects:
                    [this.editableCompartment.reconfigure(EditorView.editable.of(!readonly)),
                        this.readonlyCompartment.reconfigure(EditorState.readOnly.of(readonly))
                    ]
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
        }
    }
}