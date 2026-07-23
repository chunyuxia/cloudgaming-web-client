export class UiWorldCompositor {
  constructor(config = {}) {
    this.config = config;
    this.world = null;
    this.ui = null;
    this.stage = null;
  }

  setWorldVideo(videoElement, peerId) {
    this.world = this._prepareVideo(videoElement, peerId, "world");
    this._applyIfMounted();
  }

  setUiVideo(videoElement, peerId) {
    this.ui = this._prepareVideo(videoElement, peerId, "ui");
    this._applyIfMounted();
  }

  mountInto(stage) {
    if (!stage || !this.world || !this.ui) return false;

    this.stage = stage;
    this.stage.classList.remove("placeholder");
    this.stage.classList.add("ui-world-compositor");

    this._mountVideo(this.world.video, "world-layer");
    this._mountVideo(this.ui.video, "ui-layer");
    this._applyIfMounted();
    this._removeEmptyStages();
    return true;
  }

  removePeer(peerId) {
    if (this.world?.peerId === peerId) this.world = null;
    if (this.ui?.peerId === peerId) this.ui = null;

    if (!this.world || !this.ui) {
      this._resetStage();
    }
  }

  stop() {
    this._restoreVideo(this.world?.video);
    this._restoreVideo(this.ui?.video);
    this.world = null;
    this.ui = null;
    this._resetStage();
  }

  isReady() {
    return Boolean(this.world?.video && this.ui?.video);
  }

  getScaleReference() {
    return this.world?.video || this.ui?.video || null;
  }

  _prepareVideo(videoElement, peerId, role) {
    if (!videoElement) return null;

    if (!videoElement.dataset.originalInlineStyle) {
      videoElement.dataset.originalInlineStyle = videoElement.getAttribute("style") || "";
    }
    videoElement.dataset.uiOffloadRole = role;
    videoElement.dataset.uiOffloadPeerId = peerId;
    videoElement.controls = false;

    return { video: videoElement, peerId, role };
  }

  _mountVideo(videoElement, className) {
    if (!videoElement || !this.stage) return;
    if (videoElement.parentElement !== this.stage) {
      this.stage.appendChild(videoElement);
    }
    videoElement.classList.remove("world-layer", "ui-layer");
    videoElement.classList.add(className);
  }

  _applyIfMounted() {
    if (!this.stage) return;

    if (this.world?.video) {
      Object.assign(this.world.video.style, {
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "fill",
      });
    }

    if (this.ui?.video) {
      Object.assign(this.ui.video.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "fill",
        mixBlendMode: this.config.uiBlendMode || "screen",
      });
    }
  }

  _restoreVideo(videoElement) {
    if (!videoElement) return;
    videoElement.classList.remove("world-layer", "ui-layer");
    videoElement.removeAttribute("data-ui-offload-role");
    videoElement.removeAttribute("data-ui-offload-peer-id");

    const originalInlineStyle = videoElement.dataset.originalInlineStyle;
    if (originalInlineStyle != null) {
      if (originalInlineStyle) {
        videoElement.setAttribute("style", originalInlineStyle);
      } else {
        videoElement.removeAttribute("style");
      }
      delete videoElement.dataset.originalInlineStyle;
    }
  }

  _resetStage() {
    if (!this.stage) return;
    this.stage.classList.remove("ui-world-compositor");
    this.stage = null;
    this._removeEmptyStages();
  }

  _removeEmptyStages() {
    document.querySelectorAll(".video-stage").forEach((stage) => {
      if (!stage.querySelector("video") && !stage.querySelector("#uiOverlay, #popupOverlay")) {
        stage.remove();
      }
    });
  }
}
