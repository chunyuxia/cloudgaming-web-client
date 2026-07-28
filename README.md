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

### 1. Start the SmokeBreak cloud/world sender

In the SmokeBreak Unity project:

1. Open the gameplay scene, usually `Tutorial.unity`.
2. Run **Tools > UI Client > Live Demo > Configure Active Scene as Cloud World Sender**.
3. Press **Play** in Unity.

This creates the WebRTC peer named `smokebreak-world`. It runs the full game logic, streams world-only video, and sends semantic UI deltas over the data channel.

### 2. Open the browser client

1. Open this GitHub Pages site.
2. Click **Connect WebSocket**.
3. When the world stream appears, the browser loads the SmokeBreak Unity WebGL UI overlay automatically.
4. Click **Merge UI + World Streams** if needed to enter the stitched demo view.

For a standalone UI asset check, click **Load Unity WebGL UI Overlay** before connecting the world sender.

Useful optional URL overrides:

```text
?worldPeerMatch=smokebreak-world
?unityUi=1&game=smokebreak&unityUiCompression=none
```

## GitHub Pages

This repository is configured as a SmokeBreak-only public demo. The included SmokeBreak WebGL UI build is uncompressed, so GitHub Pages can serve it without custom Brotli headers.

After pushing to GitHub, enable Pages with **Source: GitHub Actions** in the repository settings if GitHub does not enable it automatically.
