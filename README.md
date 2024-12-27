# Live coding app

## Prerequisites

- Poetry
- Python
- npm

## Local development

Build and run

```bash
make run
```

Build only

```bash 
make build
```

Watch frontend
```bash
make watch-frontend
```

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
- [x] Persist name in cookies or browser
- [x] Mobile responsive design
- [x] Revising 37signals paddings and margins. Probably need to change everything to ems instead of rems
- [x] Focus in name field. Focus in code after room creation
- [ ] Add favicon and the rest of the staff
- [ ] Pretty "room not found" error
- [ ] Stretch code editor
- [ ] Presence tooltips
- [ ] Add new document placeholder
- [ ] call intro.js during create and handle update afterwords
- [ ] Automatic reconnect

Backend:

- [x] Prefetch the state, not the history (otherwise it replays it including deletions).
    - [x] Download, apply, then show
- [x] Periodically clean rooms
- [x] Compaction and materialization (reimplement algorithm). Gzip
- [x] Offloading plain documents
- [x] Add greeting message
- [x] Benchmark file sizes
- [ ] Remove rooms older than one week (include this message into greeting)
- [ ] Prettify code for publishing

Server
- [x] Remove server from 0.0.0.0
- [x] Why websocket works?
- [x] Add logs rotation
  - It happens by itself
- [ ] Test reboot
- [x] What is wrong with ssh settings. I moved it to 2222
- [ ] Add ratelimiter. Stresstest it
- [x] Add ufw firewall
- [ ] Overwrite 404