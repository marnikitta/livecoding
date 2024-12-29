# Roadmap

## Frontend:

- [x] Room from URL
- [x] Room creation interface
- [x] Design
- [x] Speed up PlainUpdates by pre-combining popular changes
    - [x] Add more tests
- [x] Add (you) suffix
- [x] Add esbuild step
- [x] Support different languages via path extension
- [x] Send site hellos after connection
- [x] Limit canvas size
    - Allow proper deletion
- [x] Fix navigation history
- [x] WebSocket disconnect handling
- [x] Corrupt state handling
- [x] Frontend stats
- [x] Persist name in cookies or browser
- [x] Mobile responsive design
- [x] Revising 37signals paddings and margins. Probably need to change everything to ems instead of rems
- [x] Focus on the name field. Focus on the code after room creation
- [x] Stretch code editor
- [ ] Add favicon and the rest of the stuff
- [ ] Record a GIF with an editor
- [ ] Pretty "room not found" error
- [ ] Presence tooltips
- [ ] Add new document placeholder
- [ ] Call intro.js during create and handle update afterwards
- [ ] Automatic reconnect
- [ ] Add jslint

## Backend:

- [x] Prefetch the state, not the history (otherwise it replays it including deletions).
    - [x] Download, apply, then show
- [x] Periodically clean rooms
- [x] Compaction and materialization (reimplement algorithm). Gzip
- [x] Offloading plain documents
- [x] Add greeting message
- [x] Benchmark file sizes
- [x] Tune WebSocket ping-pong timeout to match client heartbeats
- [ ] Remove rooms older than one week (include this message in the greeting)
- [ ] Prettify code for publishing
    - Add kudos and all used links

## Server:

- [x] Remove server from 0.0.0.0
- [x] Why does WebSocket work?
- [x] Add log rotation
    - It happens by itself
- [x] Test reboot
- [x] What is wrong with SSH settings? I moved it to 2222
- [x] Add UFW firewall
- [ ] Set up restart cron
- [ ] How do restarts work? Is there a limit?
- [ ] Set up GitHub action for deployment
- [ ] Add rate limiter. Stress test it
- [ ] Overwrite 404