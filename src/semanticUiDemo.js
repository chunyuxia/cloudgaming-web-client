// ─────────────────────────────────────────────────────────────────────────────
// Semantic-UI cloud-gaming prototype
//
// Demonstrates the core idea behind this client's data-channel + metadata path
// (see webRTCManager.js `onVideoMetadataReceived` / `sendViaDataChannel`):
//
//   The "server" runs a tiny game, renders the WORLD into a video frame, and
//   sends the UI state (health, score, ammo, objective, minimap, …) as small
//   JSON metadata over a REAL RTCDataChannel. The "client" renders that UI
//   locally as crisp DOM/SVG, composited on top of the streamed video.
//
// The convincing result:
//   Drag the "Network quality" slider down. The LEFT panel (traditional cloud
//   gaming, UI baked into the video pixels) turns to mush — health numbers and
//   text become unreadable. The RIGHT panel's video degrades identically, but
//   its UI stays razor-sharp because it is drawn locally from the metadata,
//   not transported as pixels.
//
// Everything runs in one page. The two RTCPeerConnections below form a genuine
// loopback data channel, so the UI state really does travel over WebRTC — the
// same mechanism the production client would use against the Unity host.
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_W = 480;
const VIDEO_H = 270;

// ── DOM handles ──────────────────────────────────────────────────────────────
const qualitySlider = document.getElementById("quality");
const qualityLabel = document.getElementById("qualityLabel");
const presetButtons = document.querySelectorAll("[data-preset]");

const videoCanvasL = document.getElementById("videoCanvasL"); // baked-UI video
const videoCanvasR = document.getElementById("videoCanvasR"); // world-only video
const overlay = document.getElementById("semanticOverlay");   // crisp DOM UI

const dcStatusEl = document.getElementById("dcStatus");
const videoKbpsEl = document.getElementById("videoKbps");
const metaKbpsEl = document.getElementById("metaKbps");
const seqEl = document.getElementById("seqCount");

const ctxL = videoCanvasL.getContext("2d");
const ctxR = videoCanvasR.getContext("2d");

// Offscreen buffer used to simulate "poor network" by encoding the frame at a
// low internal resolution and scaling it back up (resolution loss + blur is the
// dominant visible artifact of a starved video stream).
const lowResCanvas = document.createElement("canvas");
const lowResCtx = lowResCanvas.getContext("2d");

// Full-resolution source frames (rendered by the "server" before transport).
const srcBaked = document.createElement("canvas"); // world + baked UI
const srcWorld = document.createElement("canvas"); // world only
srcBaked.width = srcWorld.width = VIDEO_W;
srcBaked.height = srcWorld.height = VIDEO_H;
const srcBakedCtx = srcBaked.getContext("2d");
const srcWorldCtx = srcWorld.getContext("2d");

// ── Game simulation (the "server") ───────────────────────────────────────────
const game = {
  t: 0,
  player: { name: "NOVA_7", level: 42, x: 1280, y: 860, angle: 0 },
  health: 100,
  shield: 100,
  ammo: 24,
  ammoMax: 30,
  score: 18750,
  kills: 12,
  objective: "Capture the North Relay",
  hotbar: [
    { key: "1", name: "Pulse Rifle", sel: true },
    { key: "2", name: "Scattergun", sel: false },
    { key: "3", name: "Frag x3", sel: false },
    { key: "4", name: "Med Kit", sel: false },
  ],
  enemies: [],
  notif: null,
  notifUntil: 0,
};

// Seed some roaming enemies in world space.
for (let i = 0; i < 6; i++) {
  game.enemies.push({
    x: Math.random() * 2560,
    y: Math.random() * 1440,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
  });
}

function updateGame() {
  game.t += 1;

  // Player wanders along a lissajous path so the world visibly scrolls.
  game.player.x = 1280 + Math.sin(game.t * 0.012) * 760;
  game.player.y = 860 + Math.cos(game.t * 0.009) * 460;
  game.player.angle = Math.atan2(Math.cos(game.t * 0.009), Math.cos(game.t * 0.012));

  // Live-looking stats.
  game.health = 55 + Math.round(40 * (0.5 + 0.5 * Math.sin(game.t * 0.02)));
  game.shield = 40 + Math.round(55 * (0.5 + 0.5 * Math.sin(game.t * 0.013 + 1)));
  if (game.t % 18 === 0) {
    game.ammo -= 1;
    if (game.ammo < 0) {
      game.ammo = game.ammoMax;
      game.score += 250;
      game.kills += 1;
      game.notif = ["DOUBLE KILL", "HEADSHOT", "+250 SCORE", "RELOAD"][game.kills % 4];
      game.notifUntil = game.t + 70;
    }
  }
  if (game.t > game.notifUntil) game.notif = null;

  for (const e of game.enemies) {
    e.x += e.vx;
    e.y += e.vy;
    if (e.x < 0 || e.x > 2560) e.vx *= -1;
    if (e.y < 0 || e.y > 1440) e.vy *= -1;
  }
}

// Build the compact UI-state message sent over the data channel.
function buildMetadata(seq, fps) {
  const cx = game.player.x;
  const cy = game.player.y;
  return {
    kind: "uiState",
    seq,
    fps,
    name: game.player.name,
    level: game.player.level,
    health: game.health,
    shield: game.shield,
    ammo: game.ammo,
    ammoMax: game.ammoMax,
    score: game.score,
    kills: game.kills,
    objective: game.objective,
    coords: { x: Math.round(cx), y: Math.round(cy) },
    hotbar: game.hotbar,
    notif: game.notif,
    // Minimap: self + nearby blips, normalised 0..1 over the 2560x1440 world.
    minimap: {
      self: { x: cx / 2560, y: cy / 1440, a: game.player.angle },
      blips: game.enemies.map((e) => ({ x: e.x / 2560, y: e.y / 1440 })),
    },
  };
}

// ── Rendering: the game WORLD (goes into the video either way) ────────────────
function drawWorld(ctx) {
  ctx.fillStyle = "#0d1b24";
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

  // Parallax grid that scrolls with the player — gives the "video" real motion.
  const ox = (game.player.x * 0.15) % 48;
  const oy = (game.player.y * 0.15) % 48;
  ctx.strokeStyle = "rgba(80,150,180,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -ox; x < VIDEO_W; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, VIDEO_H);
  }
  for (let y = -oy; y < VIDEO_H; y += 48) {
    ctx.moveTo(0, y);
    ctx.lineTo(VIDEO_W, y);
  }
  ctx.stroke();

  // A couple of structures.
  ctx.fillStyle = "rgba(60,110,140,0.45)";
  for (let i = 0; i < 5; i++) {
    const bx = ((i * 520 - game.player.x * 0.15) % (VIDEO_W + 120) + VIDEO_W + 120) % (VIDEO_W + 120) - 60;
    ctx.fillRect(bx, 60 + (i % 3) * 50, 70, 90);
  }

  // Enemies relative to player (centre = player).
  ctx.fillStyle = "#ff5a5a";
  for (const e of game.enemies) {
    const sx = VIDEO_W / 2 + (e.x - game.player.x) * 0.25;
    const sy = VIDEO_H / 2 + (e.y - game.player.y) * 0.25;
    if (sx > -8 && sx < VIDEO_W + 8 && sy > -8 && sy < VIDEO_H + 8) {
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Player at centre.
  ctx.save();
  ctx.translate(VIDEO_W / 2, VIDEO_H / 2);
  ctx.rotate(game.player.angle);
  ctx.fillStyle = "#37e0a0";
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Rendering: the UI BAKED into the video (the traditional approach) ─────────
// This is the exact UI that becomes unreadable when the video degrades.
function drawBakedUI(ctx) {
  // Health + shield bars (top-left).
  drawBar(ctx, 12, 12, 130, 10, game.health / 100, "#37e0a0", "#0a2a20");
  drawBar(ctx, 12, 26, 130, 8, game.shield / 100, "#49b6ff", "#0a2030");
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px Arial";
  ctx.fillText(`${game.player.name}  Lv.${game.player.level}`, 12, 52);
  ctx.font = "10px Arial";
  ctx.fillText(`HP ${game.health}   SH ${game.shield}`, 12, 66);

  // Score / kills (top-right).
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffd54a";
  ctx.font = "bold 14px Arial";
  ctx.fillText(`${game.score.toLocaleString()}`, VIDEO_W - 12, 22);
  ctx.fillStyle = "#fff";
  ctx.font = "10px Arial";
  ctx.fillText(`KILLS ${game.kills}`, VIDEO_W - 12, 38);
  ctx.textAlign = "left";

  // Objective (top-centre).
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(VIDEO_W / 2 - 95, 8, 190, 18);
  ctx.fillStyle = "#9fe8ff";
  ctx.font = "bold 10px Arial";
  ctx.fillText("◈ " + game.objective, VIDEO_W / 2, 21);
  ctx.textAlign = "left";

  // Ammo (bottom-right).
  ctx.textAlign = "right";
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px Arial";
  ctx.fillText(`${game.ammo}`, VIDEO_W - 40, VIDEO_H - 14);
  ctx.font = "11px Arial";
  ctx.fillStyle = "#9bb";
  ctx.fillText(`/ ${game.ammoMax}`, VIDEO_W - 12, VIDEO_H - 14);
  ctx.textAlign = "left";

  // Coords (bottom-left).
  ctx.fillStyle = "#7fa";
  ctx.font = "10px monospace";
  ctx.fillText(`X:${Math.round(game.player.x)}  Y:${Math.round(game.player.y)}`, 12, VIDEO_H - 14);

  // Hotbar (bottom-centre).
  const slotW = 40;
  const startX = VIDEO_W / 2 - (game.hotbar.length * slotW) / 2;
  game.hotbar.forEach((item, i) => {
    const x = startX + i * slotW;
    const y = VIDEO_H - 34;
    ctx.fillStyle = item.sel ? "rgba(55,224,160,0.85)" : "rgba(20,40,50,0.8)";
    ctx.fillRect(x, y, slotW - 4, 24);
    ctx.fillStyle = item.sel ? "#012" : "#cde";
    ctx.font = "bold 9px Arial";
    ctx.fillText(item.key, x + 4, y + 11);
    ctx.font = "7px Arial";
    ctx.fillText(item.name.slice(0, 9), x + 4, y + 20);
  });

  // Notification (centre).
  if (game.notif) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff5a5a";
    ctx.font = "bold 20px Arial";
    ctx.fillText(game.notif, VIDEO_W / 2, VIDEO_H / 2 - 40);
    ctx.textAlign = "left";
  }

  // Minimap (top-right, below score).
  drawCanvasMinimap(ctx, VIDEO_W - 70, 48, 58);
}

function drawBar(ctx, x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

function drawCanvasMinimap(ctx, x, y, size) {
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "rgba(120,200,230,0.7)";
  ctx.strokeRect(x + 0.5, y + 0.5, size, size);
  for (const e of game.enemies) {
    ctx.fillStyle = "#ff5a5a";
    ctx.fillRect(x + (e.x / 2560) * size - 1, y + (e.y / 1440) * size - 1, 2, 2);
  }
  ctx.fillStyle = "#37e0a0";
  ctx.fillRect(x + (game.player.x / 2560) * size - 1.5, y + (game.player.y / 1440) * size - 1.5, 3, 3);
}

// ── "Network" transport: degrade a source frame onto a display canvas ─────────
// quality 0..100 → internal resolution scale. Low quality = few pixels scaled
// up = the blur/blockiness you get from a bandwidth-starved video encoder.
function transportVideo(srcCanvas, dstCtx, quality) {
  const scale = 0.05 + (quality / 100) * 0.95; // 5% .. 100% internal resolution
  const lw = Math.max(2, Math.round(VIDEO_W * scale));
  const lh = Math.max(2, Math.round(VIDEO_H * scale));
  lowResCanvas.width = lw;
  lowResCanvas.height = lh;

  lowResCtx.imageSmoothingEnabled = true;
  lowResCtx.clearRect(0, 0, lw, lh);
  lowResCtx.drawImage(srcCanvas, 0, 0, lw, lh); // downscale (lose detail)

  dstCtx.imageSmoothingEnabled = true;
  // Extra CSS-style blur grows as quality drops, mimicking compression softness.
  const blurPx = (1 - quality / 100) * 2.5;
  dstCtx.filter = blurPx > 0.05 ? `blur(${blurPx.toFixed(2)}px)` : "none";
  dstCtx.clearRect(0, 0, VIDEO_W, VIDEO_H);
  dstCtx.drawImage(lowResCanvas, 0, 0, VIDEO_W, VIDEO_H); // upscale (blow up blur)
  dstCtx.filter = "none";

  // Rough bytes estimate for the on-screen meter. ~0.1 bytes/pixel/frame puts a
  // clean 480p60 stream around ~6 Mbps and a starved one near ~0.3 Mbps — i.e.
  // realistic cloud-gaming bitrates that scale with the internal resolution.
  return lw * lh * 0.1;
}

// ── Semantic overlay: crisp DOM/SVG UI built from RECEIVED metadata ───────────
// Built once; subsequent frames just update text/transforms (cheap + crisp).
let overlayBuilt = false;
const el = {}; // cached element references

function buildOverlay() {
  overlay.innerHTML = `
    <div class="hud-tl">
      <div class="hud-bar"><div id="ov-hp" class="hud-fill hp"></div></div>
      <div class="hud-bar sm"><div id="ov-sh" class="hud-fill sh"></div></div>
      <div id="ov-name" class="hud-name"></div>
      <div id="ov-hpsh" class="hud-sub"></div>
    </div>
    <div class="hud-tc"><span id="ov-obj"></span></div>
    <div class="hud-tr">
      <div id="ov-score" class="hud-score"></div>
      <div id="ov-kills" class="hud-sub"></div>
      <div id="ov-fps" class="hud-fps"></div>
    </div>
    <svg id="ov-map" class="hud-map" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
    <div id="ov-notif" class="hud-notif"></div>
    <div id="ov-coords" class="hud-coords"></div>
    <div id="ov-ammo" class="hud-ammo"></div>
    <div id="ov-hotbar" class="hud-hotbar"></div>
  `;
  for (const id of [
    "ov-hp", "ov-sh", "ov-name", "ov-hpsh", "ov-obj", "ov-score", "ov-kills",
    "ov-fps", "ov-map", "ov-notif", "ov-coords", "ov-ammo", "ov-hotbar",
  ]) {
    el[id] = overlay.querySelector("#" + id);
  }
  overlayBuilt = true;
}

let lastHotbarKey = "";

function renderOverlay(m) {
  if (!m) return;
  if (!overlayBuilt) buildOverlay();

  el["ov-hp"].style.width = m.health + "%";
  el["ov-sh"].style.width = m.shield + "%";
  el["ov-name"].textContent = `${m.name}  Lv.${m.level}`;
  el["ov-hpsh"].textContent = `HP ${m.health}   SH ${m.shield}`;
  el["ov-obj"].textContent = "◈ " + m.objective;
  el["ov-score"].textContent = m.score.toLocaleString();
  el["ov-kills"].textContent = `KILLS ${m.kills}`;
  el["ov-fps"].textContent = `${m.fps} FPS`;
  el["ov-coords"].textContent = `X:${m.coords.x}  Y:${m.coords.y}`;
  el["ov-ammo"].innerHTML = `<b>${m.ammo}</b> / ${m.ammoMax}`;

  if (m.notif) {
    el["ov-notif"].textContent = m.notif;
    el["ov-notif"].style.opacity = "1";
  } else {
    el["ov-notif"].style.opacity = "0";
  }

  // Hotbar only rebuilt when its shape changes.
  const key = m.hotbar.map((h) => h.key + h.sel).join("|");
  if (key !== lastHotbarKey) {
    lastHotbarKey = key;
    el["ov-hotbar"].innerHTML = m.hotbar
      .map(
        (h) =>
          `<div class="slot ${h.sel ? "sel" : ""}"><span class="k">${h.key}</span><span class="n">${h.name}</span></div>`
      )
      .join("");
  }

  // Minimap as SVG (stays vector-crisp at any zoom).
  const blips = m.minimap.blips
    .map((b) => `<rect x="${(b.x * 100 - 1.2).toFixed(1)}" y="${(b.y * 100 - 1.2).toFixed(1)}" width="2.4" height="2.4" fill="#ff5a5a"/>`)
    .join("");
  const sx = (m.minimap.self.x * 100).toFixed(1);
  const sy = (m.minimap.self.y * 100).toFixed(1);
  el["ov-map"].innerHTML = `${blips}<circle cx="${sx}" cy="${sy}" r="2.4" fill="#37e0a0"/>`;
}

// ── Real WebRTC loopback data channel (server → client) ───────────────────────
let serverDc = null;
let clientDc = null;
let latestMetadata = null; // ONLY source for the semantic overlay
let metaBytesWindow = 0;

async function setupDataChannel() {
  const pcServer = new RTCPeerConnection();
  const pcClient = new RTCPeerConnection();

  pcServer.onicecandidate = (e) => e.candidate && pcClient.addIceCandidate(e.candidate);
  pcClient.onicecandidate = (e) => e.candidate && pcServer.addIceCandidate(e.candidate);

  serverDc = pcServer.createDataChannel("ui-metadata");
  serverDc.onopen = () => {
    dcStatusEl.textContent = "● data channel open (ui-metadata)";
    dcStatusEl.classList.add("ok");
  };

  pcClient.ondatachannel = (e) => {
    clientDc = e.channel;
    clientDc.onmessage = (ev) => {
      // The client only ever learns the UI from what arrives on the channel.
      metaBytesWindow += ev.data.length;
      try {
        latestMetadata = JSON.parse(ev.data);
      } catch {
        /* ignore malformed */
      }
    };
  };

  const offer = await pcServer.createOffer();
  await pcServer.setLocalDescription(offer);
  await pcClient.setRemoteDescription(offer);
  const answer = await pcClient.createAnswer();
  await pcClient.setLocalDescription(answer);
  await pcServer.setRemoteDescription(answer);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let seq = 0;
let frames = 0;
let fps = 60;
let lastFpsT = performance.now();
let videoBytesWindow = 0;
let lastMetaSendT = 0;
const META_HZ = 15; // UI state only needs a low, fixed update rate

function loop() {
  const quality = Number(qualitySlider.value);

  updateGame();

  // SERVER: render the two source frames.
  drawWorld(srcWorldCtx);          // world only  → right panel video
  drawWorld(srcBakedCtx);          // world + ...
  drawBakedUI(srcBakedCtx);        // ... baked UI → left panel video

  // SERVER → CLIENT over the data channel: send the UI state as JSON at a
  // fixed low rate (the HUD does not need the video's frame rate).
  const nowMs = performance.now();
  if (serverDc && serverDc.readyState === "open" && nowMs - lastMetaSendT >= 1000 / META_HZ) {
    lastMetaSendT = nowMs;
    const meta = buildMetadata(seq++, fps);
    serverDc.send(JSON.stringify(meta));
  }

  // CLIENT: receive video (degraded by "network") on both panels.
  const vbytesL = transportVideo(srcBaked, ctxL, quality); // traditional
  const vbytesR = transportVideo(srcWorld, ctxR, quality); // semantic
  videoBytesWindow += (vbytesL + vbytesR) / 2;

  // CLIENT: render crisp UI from the RECEIVED metadata over the right video.
  renderOverlay(latestMetadata);

  // Metrics.
  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    fps = Math.round((frames * 1000) / (now - lastFpsT));
    const secs = (now - lastFpsT) / 1000;
    videoKbpsEl.textContent = ((videoBytesWindow * 8) / 1000 / secs).toFixed(0);
    metaKbpsEl.textContent = ((metaBytesWindow * 8) / 1000 / secs).toFixed(1);
    if (latestMetadata) seqEl.textContent = latestMetadata.seq;
    frames = 0;
    videoBytesWindow = 0;
    metaBytesWindow = 0;
    lastFpsT = now;
  }

  requestAnimationFrame(loop);
}

// ── Wire up controls ──────────────────────────────────────────────────────────
function setQuality(v) {
  qualitySlider.value = v;
  let label = "Excellent";
  if (v < 12) label = "Critical";
  else if (v < 30) label = "Poor";
  else if (v < 60) label = "Fair";
  else if (v < 85) label = "Good";
  qualityLabel.textContent = `${v}% — ${label}`;
}
qualitySlider.addEventListener("input", () => setQuality(Number(qualitySlider.value)));
presetButtons.forEach((b) =>
  b.addEventListener("click", () => setQuality(Number(b.dataset.preset)))
);

// ── Go ────────────────────────────────────────────────────────────────────────
videoCanvasL.width = VIDEO_W;
videoCanvasL.height = VIDEO_H;
videoCanvasR.width = VIDEO_W;
videoCanvasR.height = VIDEO_H;
setQuality(Number(qualitySlider.value));
setupDataChannel().then(() => requestAnimationFrame(loop));
