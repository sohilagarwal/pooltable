# PoolCam v4.4 camera-isolated

The camera is now bootstrapped by a tiny standalone `camera.js` loaded before the game/vision code. Camera startup does not depend on OpenCV, rules, ball detection, recording, or app initialization. A `camera-test.html` page is included for direct iPad camera verification.

# PoolCam v4.3 camera-safe

Camera startup is now completely independent of OpenCV. It uses camera-only permission, multiple Safari fallbacks, explicit video.play(), and loads vision only after live camera frames are confirmed.

# PoolCam v4.2 Audited — Automatic Home Pool Analyzer

This is the GitHub Pages / iPad PWA build for a fixed overhead home pool-table camera.

## What it does

- records the game locally in ~90-second safety segments grouped into one session
- calibrates the four inside cloth corners and perspective-flattens the table to 640×320
- loads OpenCV.js and uses Hough-circle detection for actual ball candidates
- requires a stable opening scan of all **15 object balls + cue ball (16 total)** before automatic play can start
- learns the cue-ball appearance from the isolated cue ball beside the opening rack, then uses that model during play
- runs lightweight motion detection separately in a Web Worker
- detects `still → shot → moving → stable`
- after each shot, takes multiple stable ball scans and compares them with the pre-shot physical table baseline
- combines **ball-count change + pocket-area motion** before automatically calling a pot/scratch
- treats uncertain detections as a visible Pot / Miss / Scratch confirmation instead of silently changing the turn
- automatically applies the core turn loop:
  - legal pot → shooter continues
  - no pot → other player
  - scratch / standard foul → other player + ball in hand
  - declared safety → other player
- pauses after a scratch so cue-ball placement is not mistaken for a shot
- requires a fresh 16-ball scan after re-racking before the next rack starts
- stores timeline, rack score, pots, misses, scratches, fouls, runs and previous sessions
- supports manual solids / stripes assignment until exact numbered-ball classification is reliable
- supports manually confirmed 8-ball rack outcomes and a foul picker
- exports session JSON, email summary and saved video files

## Why the pot detector is binary

A Hough-circle detector can occasionally change its raw count when a tight rack becomes a scattered table even when no ball was pocketed. Synthetic tests reproduced this. Therefore PoolCam v4.2 does **not** pretend that a raw count drop of two means exactly two balls were pocketed.

For automatic turn tracking it answers the safer question:

**Did at least one legal object ball appear to be pocketed?**

A normal automatic pot needs both:

1. a plausible before/after ball disappearance, and
2. convincing motion in a calibrated pocket zone.

On a break, count changes are treated even more cautiously because rack-to-scatter geometry is the hardest case. Ambiguous shots ask for one tap rather than silently changing the game incorrectly.

## First setup

1. Open the GitHub Pages site on the iPad and wait for **Vision ready**.
2. Tap **Start Camera**.
3. Mount/aim the iPad so the entire playing surface and six pockets are visible.
4. Tap **Calibrate Table** and tap:
   - top-left
   - top-right
   - bottom-right
   - bottom-left
5. Put the full 15-ball rack on the table plus the cue ball in breaking position.
6. Tap **Scan Balls**.
7. Open **Vision** and confirm green circles sit on the balls and the readout says approximately:
   `16 balls · cue YES`
8. PoolCam will only enable **Start Game** after a stable 16-ball + cue scan.
9. Start the game and select the breaker.

## Expected core game behavior

- dry break → incoming player
- break with a confirmed pot → breaker continues
- normal pot → same player continues
- miss → switch player
- scratch → switch player + BALL IN HAND
- safety → switch player

The software does not use face recognition to identify the shooter. Once the breaker is selected, the rules state determines the current player.

## What is deliberately manual

A single overhead iPad cannot reliably prove every tournament foul. PoolCam therefore provides manual correction for things such as:

- wrong ball first
- no rail after contact
- no foot on floor
- touched/moved ball
- double hit / frozen-ball foul
- push shot
- shooting while balls are still moving
- bad cue-ball placement
- bad play from above the head string
- playing out of turn
- slow play
- ball-rack-template foul
- ball driven off the table
- illegal break
- exact 8-ball / called-pocket outcome

This is intentional: the vision engine should automate only what it can observe with useful confidence.

## OpenCV first-load requirement

OpenCV.js is loaded from the official OpenCV 4.13 documentation build. The iPad needs internet access on first load. The service worker will cache fetched resources when possible for later use.

Wait until the app says **Vision ready** before scanning.

## GitHub Pages files

Upload these files to the repository root:

- `index.html`
- `styles.css`
- `rules.js`
- `decision.js`
- `vision.js`
- `motion-worker.js`
- `app.js`
- `sw.js`
- `manifest.webmanifest`
- `README.md`

The header must show:

`Automatic Home Pool Analyzer · v4.2 audited`

If you still see an older version, Safari / the old PWA is cached.

## Acceptance test

Do this before playing a long match:

1. full rack scan = stable 16 + cue YES
2. dry break → other player
3. pot one ball → same player
4. miss → other player
5. scratch → other player + BALL IN HAND
6. replace cue ball and Resume
7. End Game → timeline and stats remain saved

## Important real-world limitation

The code, rules transitions, motion state machine, caching references, DOM wiring and synthetic detector cases can be tested off-device. Exact vision accuracy still depends on the real table: camera height, glare, shadows, cloth color, ball size in pixels and how completely the pockets are visible. The Vision tab is intentionally included so the detector's actual circles are visible rather than hidden behind a number.
