// UiOverlayRenderer — generic renderer for the "UI Bus" wire protocol (v2).
//
// The Unity host (UiStreamRouter + a per-engine exporter) streams UI as small JSON
// deltas instead of baking it into the video. This renderer turns those deltas into
// crisp DOM that overlays the stream <video>, scaling with it so the overlay matches
// what the Unity server would have drawn.
//
// Messages (all { kind:"ui", op, ... }):
//   upsert { id, parent?, tag, classes?, text?, image?, rect?, style?, visible? }
//   text   { id, text }
//   class  { id, add?, remove? }
//   style  { id, style:{k:v} }
//   remove { id }
//   clear  { scope? }
//
// `id` is a stable path like "gamehud/continue". Nodes are tracked by a `data-uid`
// attribute so build-time-exported static HTML and runtime deltas address the same
// elements. `rect` positions a node absolutely; without a rect a node flows inside its
// parent using the exported CSS classes (faithful UI Toolkit / uGUI layout).

export class UiOverlayRenderer {
  /**
   * @param {object} opts
   * @param {() => HTMLElement} opts.getStage  returns the `.video-stage` overlapping the <video>.
   * @param {string} [opts.assetBase]          base path for exported CSS/sprites (default "/ui-assets").
   * @param {string} [opts.game]               game key ("unchained" | "smokebreak") for asset folder.
   * @param {{w:number,h:number}} [opts.referenceResolution]  Unity panel ref res (default 1920x1080).
   */
  constructor({ getStage, assetBase = "/ui-assets", game = null, referenceResolution } = {}) {
    this.getStage = getStage;
    this.assetBase = assetBase.replace(/\/$/, "");
    this.game = game;
    this.ref = referenceResolution || { w: 1920, h: 1080 };
    this.nodes = new Map(); // id -> HTMLElement
    this.manifest = {}; // assetKey -> url (sprites/fonts)
    this._overlay = null;
    if (game) this.loadAssets(game);
  }

  // Load the build-time exported stylesheet + asset manifest for a game. Optional:
  // the renderer still works for pure runtime upserts if these are absent.
  async loadAssets(game) {
    this.game = game;
    const cssHref = `${this.assetBase}/${game}/styles.css`;
    if (!document.querySelector(`link[data-ui-overlay="${game}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      link.dataset.uiOverlay = game;
      link.onerror = () => console.warn(`[UiOverlay] no exported stylesheet at ${cssHref} (runtime styles only)`);
      document.head.appendChild(link);
    }
    try {
      const res = await fetch(`${this.assetBase}/${game}/manifest.json`);
      if (res.ok) this.manifest = await res.json();
    } catch {
      /* manifest optional */
    }
  }

  // The overlay root that hosts all UI nodes, mounted inside the video stage and
  // re-parented if the stage element changes (e.g. the video element is recreated).
  overlay() {
    const stage = this.getStage();
    if (!this._overlay) {
      this._overlay = document.createElement("div");
      this._overlay.id = "uiOverlay";
    }
    if (stage && this._overlay.parentElement !== stage) stage.appendChild(this._overlay);
    return this._overlay;
  }

  // Entry point: parse and dispatch one data-channel message. Returns true if handled.
  handle(message) {
    let m;
    try {
      m = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      return false;
    }
    if (!m || m.kind !== "ui") return false;
    switch (m.op) {
      case "upsert": this.upsert(m); return true;
      case "text": this.setText(m.id, m.text); return true;
      case "class": this.setClass(m.id, m.add, m.remove); return true;
      case "style": this.applyStyle(m.id, m.style); return true;
      case "remove": this.remove(m.id); return true;
      case "clear": this.clear(m.scope); return true;
      default: return false;
    }
  }

  // ── node ops ────────────────────────────────────────────────────────────────

  getEl(id) {
    if (!id) return null;
    let el = this.nodes.get(id);
    if (el && el.isConnected) return el;
    // Fall back to build-time static HTML that declared this id.
    el = this.overlay().querySelector(`[data-uid="${cssEscape(id)}"]`);
    if (el) this.nodes.set(id, el);
    return el || null;
  }

  upsert(m) {
    let el = this.getEl(m.id);
    if (!el) {
      el = document.createElement(m.tag || "div");
      el.dataset.uid = m.id;
      this.nodes.set(m.id, el);
    } else if (m.tag && el.tagName.toLowerCase() !== m.tag.toLowerCase()) {
      // Tag changed: rebuild the element, preserving children.
      const replacement = document.createElement(m.tag);
      replacement.dataset.uid = m.id;
      while (el.firstChild) replacement.appendChild(el.firstChild);
      el.replaceWith(replacement);
      el = replacement;
      this.nodes.set(m.id, el);
    }

    // Parent / mount point.
    const parent = m.parent ? this.getEl(m.parent) || this.overlay() : this.overlay();
    if (el.parentElement !== parent) parent.appendChild(el);

    if (Array.isArray(m.classes)) el.className = m.classes.join(" ");
    if (m.text != null) this._setText(el, m.text);
    if (m.image != null) this._setImage(el, m.image);
    if (m.rect) this._applyRect(el, m.rect);
    if (m.style) Object.assign(el.style, normalizeStyle(m.style));
    if (m.visible != null) el.style.display = m.visible ? (el.style.display === "none" ? "" : el.style.display) : "none";
    return el;
  }

  setText(id, text) {
    const el = this.getEl(id);
    if (el) this._setText(el, text);
  }

  setClass(id, add, remove) {
    const el = this.getEl(id);
    if (!el) return;
    if (Array.isArray(remove)) remove.forEach((c) => c && el.classList.remove(c));
    if (Array.isArray(add)) add.forEach((c) => c && el.classList.add(c));
  }

  applyStyle(id, style) {
    const el = this.getEl(id);
    if (el && style) Object.assign(el.style, normalizeStyle(style));
  }

  remove(id) {
    const el = this.nodes.get(id) || this.overlay().querySelector(`[data-uid="${cssEscape(id)}"]`);
    if (el) el.remove();
    this.nodes.delete(id);
  }

  clear(scope) {
    if (!scope) {
      this.overlay().innerHTML = "";
      this.nodes.clear();
      return;
    }
    for (const [id, el] of [...this.nodes]) {
      if (id === scope || id.startsWith(scope + "/")) {
        el.remove();
        this.nodes.delete(id);
      }
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  // Text nodes may carry "\n" (newlines) — render as <br/>. We only touch the text
  // content, leaving any child elements (e.g. nested icon) created via upsert intact.
  _setText(el, text) {
    el.textContent = "";
    String(text).split("\n").forEach((line, i) => {
      if (i) el.appendChild(document.createElement("br"));
      el.appendChild(document.createTextNode(line));
    });
  }

  // image value forms: "sprite:Key" / "font:Key" (resolved via manifest) or a raw URL.
  _setImage(el, image) {
    const url = this._resolveAsset(image);
    if (!url) return;
    if (el.tagName.toLowerCase() === "img") el.src = url;
    else {
      el.style.backgroundImage = `url("${url}")`;
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundSize = el.style.backgroundSize || "contain";
    }
  }

  _resolveAsset(ref) {
    if (!ref) return null;
    const key = ref.includes(":") ? ref.split(":").slice(1).join(":") : ref;
    if (this.manifest[ref]) return prefix(this.manifest[ref], this.assetBase, this.game);
    if (this.manifest[key]) return prefix(this.manifest[key], this.assetBase, this.game);
    if (/^(https?:|data:|\/)/.test(ref)) return ref; // raw URL
    return null;
  }

  // Absolute-position a node from a normalized rect. "ref" units are in the Unity
  // panel reference resolution; "percent" units are 0..100 of the stage. Either way
  // the result is a percentage so it scales with the video automatically.
  _applyRect(el, rect) {
    const toPct = (v, total) => (rect.unit === "percent" ? v : (v / total) * 100);
    el.style.position = "absolute";
    el.style.left = toPct(rect.x, this.ref.w) + "%";
    el.style.top = toPct(rect.y, this.ref.h) + "%";
    el.style.width = toPct(rect.w, this.ref.w) + "%";
    el.style.height = toPct(rect.h, this.ref.h) + "%";
  }
}

// camelCase passthrough; also accept kebab-case CSS names from Unity (e.g. "font-size").
function normalizeStyle(style) {
  const out = {};
  for (const k in style) {
    const camel = k.includes("-") ? k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : k;
    out[camel] = style[k];
  }
  return out;
}

function prefix(url, base, game) {
  if (/^(https?:|data:|\/)/.test(url)) return url;
  return `${base}/${game}/${url}`;
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}
