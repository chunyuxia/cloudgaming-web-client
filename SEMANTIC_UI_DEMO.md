# Semantic UI vs. Video-Streamed UI — prototype

A minimal, self-contained demo of the idea: **the server sends window/text/UI
metadata over a data channel, and the client renders that UI locally on top of
the streamed game video.** Under poor network, UI baked into the video becomes
blurry, while the semantically-streamed UI stays crisp because it is drawn
client-side from the metadata.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL and go to **`/semantic-ui-demo.html`**
(e.g. `https://localhost:5173/semantic-ui-demo.html`).

> The dev server uses a self-signed cert (`@vitejs/plugin-basic-ssl`); accept the
> browser warning once. WebRTC also works on `localhost` over plain HTTP if you
> prefer to serve the folder with any static server.

## What you see

Two panels show the **same** game video, degraded identically by the
**Network quality** slider:

| Panel | UI source | Behaviour under poor network |
|-------|-----------|------------------------------|
| ① Traditional | UI is baked into the video pixels | HUD blurs into mush with the stream |
| ② Semantic UI | UI is JSON over a data channel, drawn locally | HUD stays razor-sharp |

Drag the slider down (or hit the **Critical** preset) and watch panel ① dissolve
while panel ②'s HUD — name, health/shield, score, objective text, minimap,
hotbar, kill banner — stays perfectly legible. The metrics row shows the UI
metadata costs a tiny fraction of the video bitrate (~100 kbps vs ~12 Mbps).

## How it maps to this client

The demo uses a **real `RTCDataChannel`** (a two-`RTCPeerConnection` loopback in
the page) so the UI state genuinely travels over WebRTC — the same mechanism the
production client already has:

- **Server side:** `sendViaDataChannel(JSON.stringify(uiState))`
  (`src/webRTCManager.js`).
- **Client side:** parse the message in `onDataChannelMessageReceived` and render
  the HUD as DOM/SVG, exactly as `renderOverlay()` does in
  `src/semanticUiDemo.js`.

The same metadata path also exists per-frame inside the video transform
(`onVideoMetadataReceived`), so UI state could instead ride alongside each
encoded frame if tighter video/UI sync is desired.

## Files

- `semantic-ui-demo.html` — the page (layout, HUD styles, metrics).
- `src/semanticUiDemo.js` — game sim, video-degradation transport, data channel,
  and the local semantic-UI renderer. Fully commented.

The demo is standalone and does not touch the existing test page (`index.html`).
