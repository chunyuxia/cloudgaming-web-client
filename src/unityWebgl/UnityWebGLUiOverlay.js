export class UnityWebGLUiOverlay {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.getStage = options.getStage;
    this.buildUrl = stripTrailingSlash(options.buildUrl || "./smokebreak-ui-webgl/Build");
    this.buildName = options.buildName || "smokebreak-ui-webgl";
    this.compressionSuffix = compressionSuffix(options.compression);
    this.bridgeObject = options.bridgeObject || "SemanticUiBridge";
    this.blendMode = options.blendMode || "screen";

    this.layer = null;
    this.canvas = null;
    this.instance = null;
    this.loadingPromise = null;
    this.pendingMessages = [];
  }

  mount() {
    if (!this.enabled) return null;

    const stage = this.getStage?.();
    if (!stage) return null;

    if (!this.layer) {
      this.layer = document.createElement("div");
      this.layer.id = "unityWebglUiOverlay";
      this.layer.className = "unity-webgl-ui-layer";
      this.layer.style.mixBlendMode = this.blendMode;

      this.canvas = document.createElement("canvas");
      this.canvas.id = "unityWebglUiCanvas";
      this.canvas.className = "unity-webgl-ui-canvas";
      this.canvas.tabIndex = -1;
      this.layer.appendChild(this.canvas);
    }

    if (this.layer.parentElement !== stage) {
      stage.appendChild(this.layer);
    }

    return this.layer;
  }

  async load() {
    if (!this.enabled) return null;
    const layer = this.mount();
    if (!layer || !this.canvas) {
      // Wait until the world-video stage exists. This avoids creating/loading a
      // standalone black Unity canvas next to the actual stream.
      return null;
    }
    if (this.instance) return this.instance;
    if (this.loadingPromise) return this.loadingPromise;

    const loaderUrl = `${this.buildUrl}/${this.buildName}.loader.js`;
    const config = {
      dataUrl: `${this.buildUrl}/${this.buildName}.data${this.compressionSuffix}`,
      frameworkUrl: `${this.buildUrl}/${this.buildName}.framework.js${this.compressionSuffix}`,
      codeUrl: `${this.buildUrl}/${this.buildName}.wasm${this.compressionSuffix}`,
      streamingAssetsUrl: `${this.buildUrl.replace(/\/Build$/, "")}/StreamingAssets`,
      companyName: "Applewood Studios",
      productName: "SmokeBreak UI Client",
      productVersion: "0.1",
      matchWebGLToCanvasSize: true,
    };

    this.loadingPromise = loadScript(loaderUrl)
      .then(() => {
        if (typeof createUnityInstance !== "function") {
          throw new Error("Unity WebGL loader did not expose createUnityInstance");
        }
        return createUnityInstance(this.canvas, config, (progress) => {
          this.layer?.style.setProperty("--unity-load-progress", String(progress));
        });
      })
      .then((instance) => {
        this.instance = instance;
        this.flush();
        console.log("[UnityWebGLUiOverlay] Unity UI client loaded.");
        return instance;
      })
      .catch((error) => {
        console.warn(
          `[UnityWebGLUiOverlay] Could not load Unity WebGL UI build at ${loaderUrl}. ` +
            "Build it from Unity first, then reload with ?unityUi=1.",
          error
        );
        this.loadingPromise = null;
        throw error;
      });

    return this.loadingPromise;
  }

  receiveJson(json) {
    if (!this.enabled || !json) return false;
    const layer = this.mount();

    if (!this.instance) {
      this.pendingMessages.push(json);
      if (layer) this.load().catch(() => {});
      return true;
    }

    this.send(json);
    return true;
  }

  flush() {
    while (this.pendingMessages.length > 0) {
      this.send(this.pendingMessages.shift());
    }
  }

  send(json) {
    try {
      this.instance.SendMessage(this.bridgeObject, "ReceiveJson", json);
    } catch (error) {
      console.warn("[UnityWebGLUiOverlay] SendMessage failed:", error, json);
    }
  }
}

function compressionSuffix(value) {
  if (!value || value === "none" || value === "false" || value === "0") return "";
  const normalized = String(value).trim().replace(/^\./, "");
  return normalized ? `.${normalized}` : "";
}

function loadScript(src) {
  const existing = document.querySelector(`script[data-unity-webgl-ui-loader="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.unityWebglUiLoader = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}
