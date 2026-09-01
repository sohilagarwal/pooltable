# PoolCam V2 — iPad-first smart pool console

This version is designed specifically for an older iPad Pro running as an installable PWA.

## What changed

- Completely redesigned iPad UI
- Full-screen camera console
- Score strip and current-player indicator
- Manual 4-corner table calibration
- Calibration overlay
- Background Web Worker for vision calculations
- Downscaled 256×144 analysis frames to reduce CPU/RAM use
- Adjustable motion sensitivity
- Motion burst → probable shot detection
- Pocket-zone motion measurement around six calibrated pockets
- Manual one-tap Pot / Miss / Scratch / Safety correction
- Automatic turn switching for miss / scratch / safety
- Running pots and per-player pot percentage
- Highlights / moment timeline
- 90-second local recording chunks
- Browser storage meter
- Save video chunks to Files
- Session history in IndexedDB
- JSON export
- Email summary
- Offline PWA caching

## Important limitation

This is still a browser application. The iPad gives Safari/PWAs browser-managed storage, not unrestricted raw access to the full 128 GB. Keep valuable chunks by tapping Save.

The processing engine intentionally uses classical lightweight vision rather than a large neural network:
1. Downscale frame.
2. Apply calibrated table polygon.
3. Compare luminance against the previous frame.
4. Measure total movement.
5. Measure movement near calibrated pocket zones.
6. Detect a movement burst followed by stillness as a probable shot.
7. Keep rule/game/stat logic separate from the vision worker.

This is appropriate for a 2016 A9X iPad.

## GitHub Pages update

Replace your old repo files with all files from this folder:

- index.html
- styles.css
- app.js
- worker.js
- sw.js
- manifest.webmanifest
- README.md

Commit the changes.

GitHub Pages normally updates automatically. On the iPad, because the old service worker may cache the old app:
1. Close PoolCam.
2. Open the GitHub Pages site in Safari.
3. Refresh once.
4. If the old UI remains, go to Settings → Safari → Advanced → Website Data, find your github.io site, remove it, then reopen.
5. Add to Home Screen again if necessary.

## First real setup

1. Start Camera.
2. Position the iPad over the table.
3. Tap Calibrate Table.
4. Tap the four inside corners of the cloth:
   top-left → top-right → bottom-right → bottom-left.
5. Start Match.
6. Play.
7. Auto-detected shots appear in the timeline.
8. Correct the shot using Pot / Miss / Scratch / Safety when useful.
9. Tap Highlight immediately after a great moment.
10. End Match.
11. Save video chunks you care about.

## What is processing automatically now

- table ROI masking
- motion level
- probable shot detection
- pocket-zone activity
- session clock
- current-turn state
- run tracking
- pots / misses / scratches / safeties
- per-player pot rate
- simple live coaching insights
- automatic candidate moments when strong motion occurs near a pocket

## Next technical layer

The next meaningful upgrade is individual ball detection and tracking. That can be added as a second low-frequency worker:
- detect candidate ball circles / blobs only inside calibrated table
- track cue-ball and object-ball positions
- detect disappearance near a pocket
- maintain a table-state map
- infer ball-in-pocket events

For this old iPad, ball tracking should run at approximately 2–4 analysis frames per second, not 30 fps.
