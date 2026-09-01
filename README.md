# PoolCam PWA

This is an installable website/PWA for an iPad. No Apple Developer account or App Store submission is required.

## What it uses on the iPad

- Rear camera
- Microphone
- CPU/RAM for live preview, recording, and motion analysis
- Browser-managed local storage for video chunks and session data
- Safari/PWA Home Screen mode

## Important iPad limitation

A website cannot claim unrestricted access to all 128 GB of iPad storage. iPadOS gives Safari/PWAs a storage quota and may reclaim browser data under storage pressure. For footage you truly want to keep, tap **Save to Files** for each chunk or later add a receiver/server upload option.

The page must remain open/in the foreground for reliable long recordings.

## How to install on iPad without an Apple developer account

You need to host these files on an HTTPS website. Easy options include GitHub Pages, Netlify, Cloudflare Pages, or Vercel.

After hosting:

1. Open the HTTPS address in Safari on the iPad.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Open PoolCam from the Home Screen.
5. Tap **Start Camera**.
6. Allow Camera + Microphone access.
7. Enter both player names.
8. Tap **Start Game**.
9. Leave PoolCam open while playing.
10. Tap **End Game** when finished.
11. Save video chunks you want to keep to the Files app.
12. Export the JSON report or use Email Report.

## Why HTTPS is required

Safari requires a secure context for web camera access. A normal `http://192.168...` page on your home network generally won't be sufficient.

## How recording works

The app asks the browser for 1080p/30fps camera video and audio. MediaRecorder writes a new chunk roughly every 2 minutes. Each chunk is stored in IndexedDB on the iPad.

The app simultaneously downsamples frames to 320x180 about four times per second and looks for a burst of visual movement. A movement burst ending after relative stillness creates a "probable shot" timestamp.

This first version is deliberately lightweight enough for an older 9.7-inch iPad Pro.

## Files

- `index.html` — app interface
- `app.js` — camera, recording, motion detection, local database, reports
- `styles.css` — iPad-friendly UI
- `manifest.webmanifest` — installable PWA metadata
- `sw.js` — offline caching

## Next upgrades

The web version can later add:

- table calibration
- per-ball detection with TensorFlow.js / ONNX Web
- automatic pocket detection
- shot trajectory tracking
- player turn tracking
- Elo and head-to-head history
- automatic highlight extraction
- local-network upload to a computer/NAS
- server-side email report
- advanced AI analysis after each session

For this 2016 iPad, heavy neural-network inference should be optional and run at a low frame rate rather than on every video frame.
