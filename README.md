# Colab-edit

## Todo:

Frontend:

- [x] Room from url
- [x] Room creation interface
- [x] DeSigN
- [x] Speed up PlainUpdates by pre-combining popular changes
    - [x] Add more tests
- [x] Add (you) suffix
- [x] Add esbuild step
- [x] Support different languages via path extension
- [x] Send site hellos after connection
- [x] Limit canvas size
    - Allow proper deletion
- [x] Fix navigation history
- [x] Websocket disconnect handling
- [x] Corrupt state handling
- [x] Frontend stats
- [ ] Persist name in cookies or browser
- [ ] Presence tooltips
- [ ] call intro.js during create and handle update afterwords
- [ ] Pretty "room not found" error
- [ ] Focus in name field. Focus in code after room creation
- [ ] Revising 37signals paddings and margins. Probably need to change everything to ems instead of rems
- [ ] Stretch code editor
- [ ] Add new document placeholder

Backend:

- [x] Prefetch the state, not the history (otherwise it replays it including deletions).
    - [x] Download, apply, then show
- [x] Periodically clean rooms
- [x] Compaction and materialization (reimplement algorithm). Gzip
- [x] Offloading plain documents
- [x] Add greeting message
- [ ] Remove rooms older than one week (include this message into greeting)
