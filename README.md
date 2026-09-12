# PoolCam v2.3 Audited

A lightweight, local-first iPad PWA for recording pool games and doing basic on-device vision analysis without an Apple Developer account.

## What this build does now

- Rear-camera preview with microphone fallback to video-only
- Four-corner table calibration that correctly maps taps to the actual camera image even when Safari letterboxes it
- Calibration saved locally on the iPad
- Lightweight vision in a Web Worker at 256×144, about 3 frames/second
- Motion-burst → probable-shot detection
- Six pocket activity zones, including correctly choosing the two long-rail middle pockets
- Pocket activity peak preserved across the whole shot instead of sampling only after motion stops
- Auto-detected shots are created once and can then be classified Pot / Miss / Scratch / Safety without double-counting
- Manual turn changes
- Manual rack wins and race-to score
- Runs, pots, misses, scratches, safeties, shot count, classified-shot count, tagged pot rate
- Manual highlights plus automatic highlight candidates when strong shot motion overlaps pocket activity
- 90-second independently rotated recording files rather than assuming MediaRecorder timeslices are standalone videos
- Local IndexedDB session/video storage
- Save video chunks to Files
- Session history, JSON export, mailto report
- Network-first service worker so GitHub Pages updates are less likely to be stuck behind an old cache

## Performance design for the 9.7-inch iPad Pro

The camera records at normal quality, while analysis uses small grayscale frames. Vision runs in a Web Worker so the interface stays responsive. Heavy per-ball neural-network inference is intentionally not included in this version.

## What is NOT automatic yet

This build does not yet know ball numbers, solids vs stripes, exact cue-ball trajectory, legal/illegal 8-ball shots, automatic rack winner, or player identity from faces. Pot detection is currently a pocket-activity clue, not proof that a ball dropped.

Those features require a separate ball-detection/tracking layer calibrated to the actual mounted camera, table color, lighting, and ball set.

## First setup

1. Upload every file in this folder to the GitHub Pages repository root.
2. Wait for GitHub Pages to deploy.
3. Open the page in Safari on the iPad.
4. Confirm the header says `v2.3 audited`.
5. Start Camera.
6. Mount the iPad in its final position and orientation.
7. Tap Calibrate Table.
8. Tap the inside playing-surface corners: top-left → top-right → bottom-right → bottom-left.
9. Start Match.
10. Leave the PWA open in the foreground while playing.

## Important browser limitation

Safari/PWAs do not get unrestricted access to the iPad's entire 128 GB. Storage is browser-managed and background recording is not reliable. Save important clips to Files.
