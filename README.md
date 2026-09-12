# PoolCam v3.0 Core

GitHub-ready installable PWA for a home pool table and an older iPad Pro.

## Core gameplay loop

The software is built around this state machine:

1. Table is still -> capture approximate ball state.
2. Motion begins -> shot starts.
3. Balls move -> monitor table and six pocket zones.
4. Table becomes still again -> capture new ball state.
5. Compare before vs after.
6. Infer pot / miss / likely scratch and attach confidence.
7. High confidence -> apply automatically.
8. Low confidence -> ask for one-tap confirmation.
9. Rules engine decides who plays next.
10. Save event to timeline and statistics.

Turn logic:
- legal pot -> same player continues
- no pot -> other player
- scratch/foul -> other player + ball in hand
- declared safety -> other player

## Included

- Rear-camera recording
- 90-second safe local recording segments belonging to one session
- Four-corner table calibration
- Video letterbox-aware calibration coordinates
- Six pocket-zone generation
- 256x144 lightweight analysis frames
- Web Worker vision processing
- Shot start/end detection from motion
- Approximate ball candidate detection based on felt-color difference
- Approximate cue-ball candidate detection
- Before/after ball count comparison
- Pocket-area motion measurement
- Pot / miss / scratch inference with confidence
- Confidence threshold setting
- Low-confidence shot review
- Automatic player turn tracking
- Break-shot state
- Ball-in-hand state
- Open-table state
- Solids / stripes state with manual assignment
- WPA-style foul categories
- House-rule switches for selected common variants
- Safety declaration
- 8-ball result handling
- Rack score and race-to score
- Manual switch player
- Undo
- Highlight timestamps
- Timeline
- Basic stats and insights
- IndexedDB session history
- Video save links
- JSON session export
- Email summary
- PWA/offline shell via service worker

## Important limits of this build

This is the first version that attempts the actual game loop, but it does not pretend one overhead iPad can reliably see every pool-rule detail yet.

Automatic vision currently attempts:
- shot occurred
- table stopped
- approximate object-ball disappearance
- likely pot/no-pot
- likely cue-ball disappearance / scratch
- activity near a pocket

Still manual or semi-manual:
- exact numbered ball
- solids vs stripes recognition
- first ball contacted
- rail-after-contact proof
- called ball / called pocket
- double hit
- push shot
- clothing/hand touching a ball
- foot-on-floor foul
- subtle ball-off-table situations

For those cases, use the large correction/foul controls. The rules engine applies the consequence after you identify the event.

## Upload to GitHub

Repository root should contain exactly these files:

- index.html
- styles.css
- rules.js
- app.js
- worker.js
- sw.js
- manifest.webmanifest
- README.md

If GitHub Pages is already configured for your repository from `main` and `/ (root)`, upload/replace these files and commit.

On the iPad, confirm the header says:

`Home Pool Analyzer · v3.0 core`

If you still see an older version, clear the github.io site data in Safari and reopen the site.

## First real-table test

Test only the core loop first:

1. Start Camera.
2. Calibrate the four inside cloth corners.
3. Enter Player 1 / Player 2 and breaker.
4. Start Game.
5. Break with no ball going in.
6. Wait for all balls to stop.
7. Check whether the turn changes to Player 2.
8. Have Player 2 pot one ball.
9. Check whether Player 2 remains current.
10. Have Player 2 miss.
11. Check whether turn changes to Player 1.
12. Scratch the cue ball.
13. Check whether the opponent becomes current and BALL IN HAND appears.
14. End Game.
15. Review Timeline, Analysis and Saved Video.

## Internal validation performed

- app.js syntax checked
- rules.js syntax checked
- worker.js syntax checked
- sw.js syntax checked
- every `$()` UI id referenced by app.js was verified to exist in index.html
- local assets referenced by index.html were verified present
- rules acceptance sequence tested:
  - break + no pot -> switch player
  - pot -> same player
  - miss -> switch player
  - scratch -> switch player + ball in hand
  - safety -> switch player
  - generic foul -> switch player + ball in hand

The remaining validation must happen against the real iPad/table/camera/lighting because vision thresholds cannot be proven in a desktop code audit.
