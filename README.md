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
- [ ] Add jslint

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
    - Add kudos and all used links

Server

- [x] Remove server from 0.0.0.0
- [x] Why websocket works?
- [x] Add logs rotation
    - It happens by itself
- [x] Test reboot
- [x] What is wrong with ssh settings. I moved it to 2222
- [x] Add ufw firewall
- [ ] Tune websocket ping pong timeout to match client heartbeats
- [ ] How do restarts work? Is there a limit
- [ ] Setup GitHub action for deployment
- [ ] Add ratelimiter. Stresstest it
- [ ] Overwrite 404