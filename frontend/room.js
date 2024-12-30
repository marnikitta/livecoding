import {Compartment, EditorState, Transaction} from "@codemirror/state";

import {EditorView} from "@codemirror/view";
import {CRDTDocument, CRDTEvent} from "./lib/document.js";
import {allColors, defaultExtensions, getLanguageByExtension} from "./lib/theme.js";
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
              ['online-sites__site--color-' + site.colorIdx]: true}"
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
    },

    async mounted() {
        console.log("Room mounted", {roomId: this.roomId, extension: this.extension})

        let roomResponse = await fetch(`/resource/room/${this.roomId}`, {
            method: "GET",
        })
        if (!roomResponse.ok) {
            console.error(`Room ${this.roomId} not found`)
            this.$router.push({path: "/", query: {errorCode: "roomNotFound"}})
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

            this.view.dispatch({
                effects:
                    [this.readonlyCompartment.reconfigure([EditorView.editable.of(!readonly),
                        EditorState.readOnly.of(readonly)])]
            })
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
        },
        terminateEverything(compactionRequired = false) {
            if (this.roomState === RoomState.terminated) {
                console.info("Already terminated")
                return
            }
            console.error("Terminating everything");
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
            } else if ("sitePresence" in msg) {
                console.info("New site", msg.sitePresence)
                let presence = msg.sitePresence
                this.sites.set(presence.siteId, {
                    "name": presence.name,
                    "visible": presence.visible,
                    "colorIdx": presence.siteId % allColors.length
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