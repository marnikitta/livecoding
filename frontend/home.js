import {javascriptLanguage} from "@codemirror/lang-javascript";
import {EditorState} from "@codemirror/state";
import {defaultExtensions} from "./lib/theme.js";
import {EditorView} from "@codemirror/view";

export default {
    template: `
      <header class="header">
        <h1>Live coding editor</h1>
      </header>
      <div class="announcement">
        <form class="name-form" @submit.prevent="createRoom">
          <label class="name-form__label" for="name">To start coding</label>
          <button id="create">Create room</button>
        </form>
      </div>
      <section id="editor-view">
      </section>
    `,
    mounted() {
        let state = EditorState.create({
            doc: "",
            extensions: [
                ...defaultExtensions,
                javascriptLanguage,
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
            ]
        });
        this.view = new EditorView({
            state: state,
            parent: document.getElementById("editor-view"),
        });

        fetch("/resource/intro.js").then(response => {
            if (response.ok) {
                response.text().then(text => {
                    this.view.dispatch({
                        changes: {from: 0, to: 0, insert: text}
                    });
                });
            }
        });
    },
    methods: {
        createRoom() {
            fetch("/resource/room", {
                method: "POST",
            }).then(response => {
                if (response.ok) {
                    response.json().then(data => {
                        this.$router.push(`/room/${data.roomId}.py`);
                    });
                }
            });
        },
    }

}