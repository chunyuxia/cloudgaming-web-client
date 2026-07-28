# Cloud Gaming Semantic UI Web Client

Browser client for the SmokeBreak Semantic UI Offloading demo. The cloud Unity game streams world-only video, while the browser renders the SmokeBreak UI locally with a Unity WebGL UI client from semantic UI updates.

## What This Demo Shows

- The cloud/full SmokeBreak game remains authoritative and streams the world layer.
- Semantic UI JSON arrives through the WebRTC data channel.
- The browser forwards those UI updates into the embedded SmokeBreak Unity WebGL UI client.
- The locally rendered UI is composited over the cloud-rendered world video.

The default page is now equivalent to:

```text
?unityUi=1&game=smokebreak&unityUiCompression=none
```

## Local Development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The dev server uses a basic SSL plugin because browser WebRTC APIs work best from secure origins.

## Production Build

```bash
npm run build
npm run preview
```

## Demo Usage

1. Start the SmokeBreak cloud/world Unity sender, for example `smokebreak-world`.
2. Open this web client.
3. Click **Connect WebSocket**.
4. When the world stream appears, the browser loads the SmokeBreak Unity WebGL UI overlay automatically.
5. Click **Merge UI + World Streams** if needed to enter the stitched demo view.

Useful optional URL overrides:

```text
?worldPeerMatch=smokebreak-world
?unityUi=1&game=smokebreak&unityUiCompression=none
```

## GitHub Pages

This repository is configured as a SmokeBreak-only public demo. The included SmokeBreak WebGL UI build is uncompressed, so GitHub Pages can serve it without custom Brotli headers.

After pushing to GitHub, enable Pages with **Source: GitHub Actions** in the repository settings if GitHub does not enable it automatically.
