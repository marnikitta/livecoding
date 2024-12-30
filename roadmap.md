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
- [x] Record a GIF with an editor
- [x] Add visibility presence highlighting
- [x] Add favicon and the rest of the stuff
- [x] Pretty "room not found" error
- [x] Fix messed up input border
- [ ] Presence tooltips
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
- [x] Prettify code for publishing
- [x] Remove rooms older than one week (include this message in the greeting)
- [ ] Fix UTF16 (javascript) vs UTF-32 (python) handling
  - https://tonsky.me/blog/unicode/
  - https://hsivonen.fi/string-length/
- [ ] Create docker image for easy self-hosting
  - Replicate hastebin settings and extract them to ENV variables
- 
## Server:

- [x] Remove server from 0.0.0.0
- [x] Why does WebSocket work?
- [x] Add log rotation
    - It happens by itself
- [x] Test reboot
- [x] What is wrong with SSH settings? I moved it to 2222
- [x] Add UFW firewall
- [x] Set up GitHub action for deployment
- [ ] Add known_hosts to the deployment script
- [ ] How do restarts work? Is there a limit?
- [ ] Add rate limiter. Stress test it
- [ ] Overwrite 404 nginx error with something fun