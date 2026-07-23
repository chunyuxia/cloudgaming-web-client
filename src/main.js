import { WebRTCManager } from "./webRTCManager.js";
import { UiOverlayRenderer } from "./uiOverlay/UiOverlayRenderer.js";
import { UI_OFFLOAD_CONFIG, matchUiOffloadPeerRole } from "./config.js";
import { UiWorldCompositor } from "./compositor/UiWorldCompositor.js";

// Which game's exported UI assets to load. Override with ?game=smokebreak in the URL.
const GAME = new URLSearchParams(location.search).get("game") || "unchained";

// Generic UI-overlay renderer (kind:"ui"). Shares the same .video-stage the legacy
// popup path uses, so both render over the stream and scale with it.
const uiRenderer = new UiOverlayRenderer({ getStage: () => ensureStage(), game: GAME });
const uiWorldCompositor = new UiWorldCompositor(UI_OFFLOAD_CONFIG);
const uiOffloadPeerRoles = new Map();

// Debug/manual handle for the UI-offload compositor. Lets you inspect roles and
// force the world+UI streams to merge from the console or the "Merge Streams" button,
// independent of auto-routing timing:
//   uiOffload.status()                         → current videos, roles, ready state
//   uiOffload.remerge()                        → re-classify & stitch all present videos
//   uiOffload.forceMerge("worldId","uiId")     → stitch two specific peers regardless of name
window.uiOffload = {
  compositor: uiWorldCompositor,
  config: UI_OFFLOAD_CONFIG,
  roles: uiOffloadPeerRoles,
  status: () => uiOffloadStatus(),
  remerge: () => remergeExistingVideos(),
  forceMerge: (worldPeerId, uiPeerId) => forceMergeStreams(worldPeerId, uiPeerId),
};

const websocketUrlInput = document.getElementById("websocketUrl");
const localPeerIdInput = document.getElementById("localPeerId");
const stunServerInput = document.getElementById("stunServer");
const connectWsBtn = document.getElementById("connectWsBtn");
const disconnectWsBtn = document.getElementById("disconnectWsBtn");

const refreshDevicesBtn = document.getElementById("refreshDevicesBtn");

const startMediaBtn = document.getElementById("startMediaBtn");
const stopMediaBtn = document.getElementById("stopMediaBtn");
const initiateOffersBtn = document.getElementById("initiateOffersBtn");
const closeWebRTCBtn = document.getElementById("closeWebRTCBtn");

const localVideoPlayer = document.getElementById("localVideoPlayer");
// const remoteVideosContainer = document.getElementById("remoteVideosContainer");

const dataChannelMessageInput = document.getElementById("dataChannelMessage");
const targetPeerIdInput = document.getElementById("targetPeerId");
const sendDataBtn = document.getElementById("sendDataBtn");

const startLatencyBtn = document.getElementById("startLatencyBtn");
const stopLatencyBtn  = document.getElementById("stopLatencyBtn");
let latencyIntervalId = null;
let processedLatencyPings = new Set();

let webRTCManager;
let localStream;

let pressedKeys = new Set(); // to avoid sending repeat keydown events

// --- Utility Functions ---
function generatePeerId() {
  return "web-" + Math.random().toString(36).substring(2, 11);
}

// --- Initialization ---
localPeerIdInput.value = generatePeerId();

// --- Event Listeners ---
connectWsBtn.addEventListener("click", async () => {
  if (webRTCManager && webRTCManager.isWebSocketConnected) {
    console.warn("WebSocket already connected.");
    return;
  }

  const wsUrl = websocketUrlInput.value;
  const peerId = localPeerIdInput.value;
  const stunUrl = stunServerInput.value;

  if (!wsUrl || !peerId) {
    console.error("WebSocket URL and Peer ID are required.");
    return;
  }

  const uiConfig = {
    videoContainerId: "remoteVideosContainer",
    localVideoPlayerId: "localVideoPlayer", // Manager uses this to know where to put local stream if not handled by app
  };

  webRTCManager = new WebRTCManager(peerId, stunUrl, uiConfig);
  setupWebRTCManagerCallbacks();
  setupKeyboardListeners();

  try {
    console.log(`Attempting to connect to WebSocket: ${wsUrl}`);
    // For this test, let's assume we want to send and receive audio/video by default
    await webRTCManager.connect(wsUrl, true, true);
    connectWsBtn.classList.add("hidden");
    disconnectWsBtn.classList.remove("hidden");
    initiateOffersBtn.classList.remove("hidden");
    closeWebRTCBtn.classList.remove("hidden");
    sendDataBtn.classList.remove("hidden");
    startLatencyBtn.classList.remove("hidden");
    stopLatencyBtn.classList.remove("hidden");
  } catch (error) {
    console.error("Failed to connect WebSocket:", error);
    webRTCManager = null; // Clean up
  }
});

disconnectWsBtn.addEventListener("click", () => {
  if (webRTCManager) {
    webRTCManager.closeWebSocket(); // This should trigger onWebSocketConnection('closed')
    // Further UI cleanup might happen in the callback
  }
});

refreshDevicesBtn.addEventListener("click", async () => {
  const cameraSelect = document.getElementById("cameraSelect");
  const micSelect = document.getElementById("micSelect");

  // Clear current options
  cameraSelect.innerHTML = "";
  micSelect.innerHTML = "";

  let tempStream = null;

  try {
    // Prompt permissions (important for Firefox)
    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

    // Enumerate devices
    const devices = await navigator.mediaDevices.enumerateDevices();

    // Filter and populate camera options
    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    // Filter and populate microphone options
    const audioDevices = devices.filter((device) => device.kind === "audioinput");
    audioDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.text = device.label || `Microphone ${index + 1}`;
      micSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Error accessing media devices.", err);
    alert("Please allow camera and microphone access to list devices.");
  } finally {
    // Stop all tracks and release camera/mic
    if (tempStream) {
      tempStream.getTracks().forEach((track) => track.stop());
      tempStream = null;
      console.log("Media tracks stopped and camera/mic released.");
    }
  }
});

startMediaBtn.addEventListener("click", async () => {
  if (localStream) {
    console.warn("Local media already started.");
    return;
  }
  try {
    console.log("Requesting local media (audio & video)...");
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideoPlayer.srcObject = localStream;
    localVideoPlayer.play().catch((e) => console.error("Local video play error:", e));

    if (webRTCManager) {
      webRTCManager.setLocalStream(localStream);
    }
    startMediaBtn.classList.add("hidden");
    stopMediaBtn.classList.remove("hidden");
    console.log("Local media started and set.");
  } catch (error) {
    console.error("Error starting local media:", error);
  }
});

stopMediaBtn.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localVideoPlayer.srcObject = null;
    localStream = null;
    if (webRTCManager) {
      webRTCManager.setLocalStream(null); // Inform manager
    }
    stopMediaBtn.classList.add("hidden");
    startMediaBtn.classList.remove("hidden");
    console.log("Local media stopped.");
  }
});

initiateOffersBtn.addEventListener("click", () => {
  if (webRTCManager) {
    console.log("Manually initiating offers to all peers...");
    webRTCManager.initiateOffersToAllPeers();
  } else {
    console.warn("WebRTCManager not initialized.");
  }
});

closeWebRTCBtn.addEventListener("click", () => {
  if (webRTCManager) {
    resetUiOffloadRouting();
    webRTCManager.closeWebRTC(); // This also disposes remote media elements handled by manager
    console.log("WebRTC connections closed.");
    // No need to iterate remoteVideosContainer here if manager handles its elements
  }
});

document.getElementById("mergeStreamsBtn")?.addEventListener("click", () => {
  const merged = remergeExistingVideos();
  if (!merged) {
    console.warn(
      "[UI Offload] Merge incomplete — need one world peer and one UI peer. Status:",
      uiOffloadStatus()
    );
  }
});

sendDataBtn.addEventListener("click", () => {
  if (!webRTCManager || !webRTCManager.isWebSocketConnected) {
    console.warn("WebRTCManager not connected. Cannot send data.");
    return;
  }
  const message = dataChannelMessageInput.value;
  const targetId = targetPeerIdInput.value.trim();
  if (!message) {
    console.warn("Cannot send empty message.");
    return;
  }
  console.log(`Sending data: "${message}" to ${targetId || "ALL"}`);
  webRTCManager.sendViaDataChannel(message, targetId || null);
});

startLatencyBtn.addEventListener("click", () => {
  if (!webRTCManager || !webRTCManager.isWebSocketConnected) {
    console.warn("WebRTCManager not connected. Cannot start latency test.");
    return;
  }
  if (latencyIntervalId !== null) {
    console.warn("Latency test already running.");
    return;
  }

  const targetId = targetPeerIdInput.value.trim() || null;

  latencyIntervalId = setInterval(() => {
    const now = Date.now(); // t0 (client send)
    const msg = JSON.stringify({
      kind: "latencyPing",
      t0: now,
    });

    webRTCManager.sendViaDataChannel(msg, targetId);
  }, 200); // send every 500ms; adjust as you like

  console.log("Latency test started.");
});

stopLatencyBtn.addEventListener("click", () => {
  if (latencyIntervalId !== null) {
    clearInterval(latencyIntervalId);
    latencyIntervalId = null;
    console.log("Latency test stopped.");
  }
});


// Listen to keyboard and send to Unity via data channel
function setupKeyboardListeners() {
  // keydown
  window.addEventListener("keydown", (e) => {
    if (!webRTCManager || !webRTCManager.isWebSocketConnected) return;
    if (e.repeat) return; // ignore held-down repeat events

    const keyId = `${e.code}`;
    if (pressedKeys.has(keyId)) return;
    pressedKeys.add(keyId);

    const msg = JSON.stringify({
      kind: "key",
      action: "down",
      code: e.code,   // e.g., "KeyW"
      key: e.key,     // e.g., "w"
      t0: Date.now(), // optional timestamp
    });

    // null / undefined targetId = broadcast
    webRTCManager.sendViaDataChannel(msg, null);
    // console.log(msg);
  });

  // keyup
  window.addEventListener("keyup", (e) => {
    if (!webRTCManager || !webRTCManager.isWebSocketConnected) return;

    const keyId = `${e.code}`;
    pressedKeys.delete(keyId);

    const msg = JSON.stringify({
      kind: "key",
      action: "up",
      code: e.code,
      key: e.key,
      t0: Date.now(),
    });
    // console.log(msg);
    webRTCManager.sendViaDataChannel(msg, null);
  });
}


function setupWebRTCManagerCallbacks() {
  if (!webRTCManager) return;

  webRTCManager.onWebSocketConnection = (state) => {
    console.log(`WebSocket Connection State: ${state}`);
    if (state === "closed" || state === "error") {
      resetUiOffloadRouting();
      disconnectWsBtn.classList.add("hidden");
      connectWsBtn.classList.remove("hidden");
      initiateOffersBtn.classList.add("hidden");
      closeWebRTCBtn.classList.add("hidden");
      sendDataBtn.classList.add("hidden");
      // Optionally, clean up WebRTC resources if WebSocket drops unexpectedly
      // webRTCManager.closeWebRTC(); // This might be too aggressive depending on desired reconnect logic
    }
  };

  webRTCManager.onWebRTCConnection = (peerId) => {
    console.log(`WebRTC Connection established/completed with peer: ${peerId}`);
  };

  webRTCManager.onDataChannelConnection = (peerId) => {
    console.log(`Data Channel OPEN with peer: ${peerId}. Ready to send/receive data.`);
    // Example: Send a greeting
    // webRTCManager.sendViaDataChannel(`Hello ${peerId}, I'm ${localPeerIdInput.value}!`, peerId);
  };

  webRTCManager.onDataChannelMessageReceived = (message, peerId) => {
    console.log(`Message from ${peerId} (DataChannel): ${message}`);
    // Semantic UI: the server sends UI over the data channel instead of baking it
    // into the video, so it renders locally — crisp and network-independent.
    routeDataChannelMessage(message);
  };

  webRTCManager.onVideoStreamEstablished = (peerId, stream) => {
    console.log(`Video stream established from peer: ${peerId}`);
    // The manager should have already created and attached the stream to a video element
    // in #remoteVideosContainer. If custom handling is needed, do it here.
    // Example: Check if the element exists
    const videoElement = document.getElementById(`video-${peerId}`);
    if (!videoElement) {
      console.warn(`Video element for ${peerId} not found after onVideoStreamEstablished.`);
      return;
    }
    if (videoElement.srcObject) {
      console.log(`Video element for ${peerId} is active.`);
      routeVideoToUiOffloadCompositor(peerId, videoElement);
    } else {
      // The stream may attach a moment after this callback in some renegotiation
      // paths; route as soon as the media is ready instead of silently skipping.
      console.log(`Video element for ${peerId} not ready yet; routing on loadedmetadata.`);
      videoElement.addEventListener(
        "loadedmetadata",
        () => routeVideoToUiOffloadCompositor(peerId, videoElement),
        { once: true }
      );
    }
  };
  webRTCManager.onPeerDisconnected = (peerId) => {
    uiOffloadPeerRoles.delete(peerId);
    uiWorldCompositor.removePeer(peerId);
  };
  webRTCManager.onAudioStreamEstablished = (peerId, stream) => {
    console.log(`Audio stream established from peer: ${peerId}`);
    const audioElement = document.getElementById(`audio-${peerId}`);
    if (audioElement && audioElement.srcObject) {
      console.log(`Audio element for ${peerId} is active.`);
    } else {
      const videoElement = document.getElementById(`video-${peerId}`); // Check if audio is on video el
      if (videoElement && videoElement.srcObject && videoElement.srcObject.getAudioTracks().length > 0) {
        console.log(`Audio for ${peerId} is playing through its video element.`);
      } else {
        console.warn(`Audio element for ${peerId} not found or stream not set after onAudioStreamEstablished.`);
      }
    }
  };
  // webRTCManager.onVideoMetadataReceived = (peerId, metadataText, metadataBytes) => {
  //   console.log(
  //     "[Metadata] From peer:",
  //     peerId,
  //     "text:",
  //     metadataText,
  //     "raw bytes:",
  //     Array.from(metadataBytes)
  //   );

  //   // If Unity sends JSON like: { "t": <timestamp>, "frameId": <id> }
  //   // if (metadataText) {
  //   //   try {
  //   //     const obj = JSON.parse(metadataText);
  //   //     console.log("[Metadata JSON]", peerId, "frameId:", obj.frameId, "t:", obj.t);
  //   //   } catch {
  //   //     // not JSON or parse failed; ignore
  //   //   }
  //   // }
  // };
  webRTCManager.onVideoMetadataReceived = (peerId, metadataText, metadataBytes) => {
    if (!metadataText) return;

    let meta;
    try {
      meta = JSON.parse(metadataText);
    } catch {
      return; // not JSON, ignore
    }

    if (meta.kind !== "latencySample") return;

    const t0 = meta.t0;
    if (t0 == null) return;

    // ✅ Only compute latency for the *first* frame that carries this t0
    if (processedLatencyPings.has(t0)) {
      // we've already seen a frame for this ping; ignore duplicates
      return;
    }
    processedLatencyPings.add(t0);

    const t1 = meta.t1;
    const t2 = Date.now();

    const e2e = t2 - t0; // JS-send → first frame received
    console.log(
      `[Latency-FirstFrame] peer=${peerId} t0=${t0} t1=${t1} t2=${t2}  e2e≈${e2e} ms`
    );

    // const t2 = Date.now(); // time at client when we see the frame
    // const t0 = meta.t0;
    // const t1 = meta.t1;

    // const e2e = t2 - t0; // roughly: "input (JS ping) → frame arrive at JS"
    // console.log(
    //   `[Latency] peer=${peerId} t0=${t0} t1=${t1} t2=${t2}  e2e≈${e2e} ms`
    // );
  };
}

function routeVideoToUiOffloadCompositor(peerId, videoElement) {
  const role = resolveUiOffloadRole(peerId);
  if (!role) {
    console.log(`[UI Offload] Peer ${peerId} left as a normal debug video.`);
    return;
  }

  uiOffloadPeerRoles.set(peerId, role);
  if (role === "world") {
    uiWorldCompositor.setWorldVideo(videoElement, peerId);
  } else if (role === "ui") {
    uiWorldCompositor.setUiVideo(videoElement, peerId);
  }

  console.log(`[UI Offload] Routed peer ${peerId} as ${role}.`);
  mountUiOffloadCompositor();
}

function resolveUiOffloadRole(peerId) {
  const configuredRole = matchUiOffloadPeerRole(peerId, UI_OFFLOAD_CONFIG);
  if (configuredRole) return configuredRole;

  if (!UI_OFFLOAD_CONFIG.fallbackAssignment) return null;

  const assignedRoles = new Set(uiOffloadPeerRoles.values());
  if (!assignedRoles.has("world")) return "world";
  if (!assignedRoles.has("ui")) return "ui";
  return null;
}

function mountUiOffloadCompositor() {
  if (!uiWorldCompositor.isReady()) return;

  const mounted = uiWorldCompositor.mountInto(ensureStage());
  if (mounted) {
    applyStageScale(ensureStage(), uiWorldCompositor.getScaleReference());
    console.log(
      `[UI Offload] Compositing active. UI blend mode: ${UI_OFFLOAD_CONFIG.uiBlendMode}.`
    );
  }
}

function resetUiOffloadRouting() {
  uiOffloadPeerRoles.clear();
  uiWorldCompositor.stop();
}

// Re-classify and stitch every remote <video> currently in the container. Use when
// auto-routing didn't fire (e.g. streams arrived before callbacks were wired, or the
// page was loaded before this code). Safe to call repeatedly.
function remergeExistingVideos() {
  const container = document.getElementById("remoteVideosContainer");
  if (!container) return false;
  resetUiOffloadRouting();
  const videos = [...container.querySelectorAll('video[id^="video-"]')];
  for (const video of videos) {
    const peerId = video.id.replace(/^video-/, "");
    routeVideoToUiOffloadCompositor(peerId, video);
  }
  console.log(
    `[UI Offload] remerge: ${videos.length} video(s), ready=${uiWorldCompositor.isReady()}.`
  );
  return uiWorldCompositor.isReady();
}

// Force a specific world/UI pairing regardless of peerId naming.
function forceMergeStreams(worldPeerId, uiPeerId) {
  const worldVideo = document.getElementById(`video-${worldPeerId}`);
  const uiVideo = document.getElementById(`video-${uiPeerId}`);
  if (!worldVideo || !uiVideo) {
    console.warn(
      `[UI Offload] forceMerge: missing video element(s) for "${worldPeerId}" / "${uiPeerId}".`
    );
    return false;
  }
  resetUiOffloadRouting();
  uiOffloadPeerRoles.set(worldPeerId, "world");
  uiWorldCompositor.setWorldVideo(worldVideo, worldPeerId);
  uiOffloadPeerRoles.set(uiPeerId, "ui");
  uiWorldCompositor.setUiVideo(uiVideo, uiPeerId);
  mountUiOffloadCompositor();
  return uiWorldCompositor.isReady();
}

// Console-friendly snapshot of what the compositor sees.
function uiOffloadStatus() {
  const container = document.getElementById("remoteVideosContainer");
  const videos = container
    ? [...container.querySelectorAll('video[id^="video-"]')].map((v) => ({
        id: v.id,
        hasStream: !!v.srcObject,
        role: v.dataset.uiOffloadRole || null,
        parent: v.parentElement?.className || null,
      }))
    : [];
  return {
    ready: uiWorldCompositor.isReady(),
    blendMode: UI_OFFLOAD_CONFIG.uiBlendMode,
    roles: Object.fromEntries(uiOffloadPeerRoles),
    videos,
  };
}

// ── Semantic popup UI (rendered locally from data-channel metadata) ──────────
// The Unity host (PopupMetadataStreamer) sends popups as JSON instead of drawing
// them into the streamed video, so they stay crisp regardless of video quality.
//   show: { kind:"popup", action:"show", id, header, body, prompt, icon }
//   hide: { kind:"popup", action:"hide", id }
let activePopupId = null;

// Locate the remote stream's <video> element (the streaming "canvas").
function getStreamVideoEl() {
  const c = document.getElementById("remoteVideosContainer");
  if (!c) return null;
  return (
    uiWorldCompositor.getScaleReference() ||
    c.querySelector(".video-stage .world-layer") ||
    c.querySelector('video[id^="video-"]') ||
    c.querySelector("video") ||
    null
  );
}

// Relative scale: expose 1% units of the video's size as CSS vars on the stage so
// the popup (sized in calc(var(--u)*N)) scales with the stream and re-flows on resize.
function applyStageScale(stage, ref) {
  const w = ref.clientWidth || ref.offsetWidth || 320;
  const h = ref.clientHeight || ref.offsetHeight || 180;
  stage.style.setProperty("--w", w / 100 + "px"); // 1% of width
  stage.style.setProperty("--u", Math.min(w, h) / 100 + "px"); // 1% of min side
}

// Ensure a positioned "stage" that exactly overlaps the video, so the popup can be
// centred on the stream and scaled to it. Falls back to a sized placeholder if the
// video isn't ready yet, so the popup still renders.
function ensureStage() {
  const video = getStreamVideoEl();
  if (video) {
    let stage = video.closest(".video-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "video-stage";
      video.parentNode.insertBefore(stage, video);
      stage.appendChild(video);
    }
    stage.classList.remove("placeholder");
    applyStageScale(stage, video);
    if (!video._popupRO && typeof ResizeObserver !== "undefined") {
      video._popupRO = new ResizeObserver(() => applyStageScale(stage, video));
      video._popupRO.observe(video);
    }
    return stage;
  }

  // No video yet — a sized placeholder keeps the popup visible and scaled.
  const container = document.getElementById("remoteVideosContainer") || document.body;
  let stage = container.querySelector(".video-stage.placeholder");
  if (!stage) {
    stage = document.createElement("div");
    stage.className = "video-stage placeholder";
    container.appendChild(stage);
  }
  applyStageScale(stage, stage);
  return stage;
}

function getPopupOverlay() {
  const stage = ensureStage();
  let overlay = document.getElementById("popupOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "popupOverlay";
  }
  if (overlay.parentElement !== stage) stage.appendChild(overlay);
  // Tidy: drop empty stages left over from disconnected peers.
  document.querySelectorAll(".video-stage").forEach((s) => {
    if (s !== stage && !s.classList.contains("placeholder") && !s.querySelector("video")) {
      s.remove();
    }
  });
  return overlay;
}

// Route an incoming data-channel message by its "kind":
//   "ui"    → generic overlay renderer (HUD, menus, dialogue, popups; faithful layout)
//   "popup" → legacy single-card popup path (kept for back-compat during migration)
// Anything else (e.g. "latencyPing") is ignored here.
function routeDataChannelMessage(message) {
  if (!UI_OFFLOAD_CONFIG.renderDataUi) {
    return;
  }

  let meta;
  try {
    meta = JSON.parse(message);
  } catch {
    return; // not JSON we care about
  }
  if (!meta) return;
  if (meta.kind === "ui") uiRenderer.handle(meta);
  else if (meta.kind === "popup") handlePopupMessage(meta);
}

function handlePopupMessage(message) {
  // Accept either a raw JSON string or an already-parsed object (from the router).
  let meta = message;
  if (typeof message === "string") {
    try {
      meta = JSON.parse(message);
    } catch {
      return; // not JSON we care about
    }
  }
  if (!meta || meta.kind !== "popup") return;

  if (meta.action === "hide") {
    hidePopup(meta.id);
  } else if (meta.action === "show") {
    showPopup(meta);
  }
}

function showPopup(meta) {
  const overlay = getPopupOverlay();
  activePopupId = meta.id;
  overlay.innerHTML = `
    <div class="semantic-popup" role="dialog" aria-live="polite">
      ${meta.icon ? `<div class="sp-icon" data-icon="${escapeHtml(meta.icon)}"></div>` : ""}
      ${meta.header ? `<div class="sp-header">${escapeHtml(meta.header)}</div>` : ""}
      ${meta.body ? `<div class="sp-body">${escapeHtml(meta.body).replace(/\n/g, "<br/>")}</div>` : ""}
      ${meta.prompt ? `<div class="sp-prompt">${escapeHtml(meta.prompt)}</div>` : ""}
    </div>`;
  overlay.classList.add("visible");
}

function hidePopup(id) {
  // Ignore a stale hide for a popup that was already replaced by a newer one.
  if (id != null && activePopupId != null && id !== activePopupId) return;
  const overlay = document.getElementById("popupOverlay");
  if (overlay) overlay.classList.remove("visible");
  activePopupId = null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Initial state update for buttons
disconnectWsBtn.classList.add("hidden");
stopMediaBtn.classList.add("hidden");
initiateOffersBtn.classList.add("hidden");
closeWebRTCBtn.classList.add("hidden");
sendDataBtn.classList.add("hidden");
startLatencyBtn.classList.add("hidden");
stopLatencyBtn.classList.add("hidden");


console.log("Test page initialized. Enter WebSocket URL and connect.");
