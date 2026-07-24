# Cloud Gaming Semantic UI Web Client

Browser client for the Semantic UI Offloading cloud-gaming demo. It connects to the Unity signaling server, receives remote WebRTC streams, and can merge a cloud-rendered world stream with a locally rendered UI stream.

## Features

- WebRTC signaling through `wss://unity-signaling-server.onrender.com`
- Remote video display for Unity world/UI streams
- `Merge UI + World Streams` compositor for semantic UI offloading demos
- Data-channel utilities for latency/input experiments
- Optional semantic UI overlay renderer for JSON-driven UI messages

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

1. Start the Unity world sender, for example `smokebreak-world`.
2. Start the Unity UI sender, for example `smokebreak-ui`.
3. Open this web client.
4. Click **Connect WebSocket**.
5. Once both remote videos appear, click **Merge UI + World Streams**.

Peer role matching can be overridden with URL parameters:

```text
?worldPeerMatch=world&uiPeerMatch=ui
?game=smokebreak
?game=unchained
```


## Unity WebGL UI Overlay

The web client can also render the semantic UI locally inside the browser with a Unity WebGL UI client. Build the SmokeBreak UI client from Unity into:

```text
public/smokebreak-ui-webgl
```

Then open the web client with:

```text
?unityUi=1&game=smokebreak
```

In this mode the browser receives the cloud world video and forwards semantic UI JSON into the embedded Unity WebGL canvas. This removes the separate local UI-video stream and is the preferred mobile-browser direction.

## GitHub Pages

This repository includes a GitHub Actions workflow that builds the Vite app and deploys it to GitHub Pages. After pushing to GitHub, enable Pages with **Source: GitHub Actions** in the repository settings if GitHub does not enable it automatically.
