// Parallel WebCodecs decoder for T6_para measurement.
//
// Strategy: runs alongside Chrome's built-in WebRTC decode + render path.
// The display pipeline is NOT touched — this exists purely to time when the
// same encoded frame would be done decoding. Decode time is on the same order
// as Chrome's internal decoder since both go through libvpx / hardware decode,
// but it is a parallel instance, not the exact decode being displayed.
//
// Codec is auto-detected via RTCRtpReceiver.getStats() — looks for a "codec"
// stat with mimeType (e.g. "video/VP8", "video/VP9"). Polls a few times since
// the codec stat may not appear until the first packets flow.
//
// Limitations:
// - H264 will configure but decoder may still error if it requires AVCC
//   description (we don't extract SPS/PPS). VP8/VP9/AV1 are the safe paths.
// - Drops frames until first keyframe (VideoDecoder requires keyframe first).
// - If onT6 fires after rVFC for the same frame, that frame's t6_para is lost
//   (sample entry may already be deleted). Acceptable for measurement.

const MIME_TO_WEBCODECS = [
  { mime: "vp8",  codec: "vp8" },
  { mime: "vp9",  codec: "vp09.00.10.08" },     // profile 0, level 1.0, 8-bit
  { mime: "av1",  codec: "av01.0.04M.08" },     // profile main, level 4.0, 8-bit
  { mime: "h264", codec: "avc1.42e01e" },       // baseline (may need description)
  { mime: "avc",  codec: "avc1.42e01e" },
];

function mimeToWebCodecsId(mimeType) {
  const mt = (mimeType || "").toLowerCase();
  for (const m of MIME_TO_WEBCODECS) if (mt.includes(m.mime)) return m.codec;
  return null;
}

export class LatencyDecoder {
  constructor({ onT6, peerId = "unknown" } = {}) {
    this.onT6 = onT6;
    this.peerId = peerId;
    this.decoder = null;
    this.configured = false;
    this.codec = null;
    this.gotKeyframe = false;
    this.closed = false;
    this.loggedError = false;

    if (typeof VideoDecoder === "undefined") {
      console.warn(`[LatencyDecoder:${peerId}] WebCodecs VideoDecoder unavailable; T6_para disabled.`);
      return;
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        const t6 = Date.now();
        // We packed rtpTimestamp into chunk.timestamp on feed(); it flows through.
        const rtpTs = frame.timestamp;
        try {
          this.onT6?.(rtpTs, t6);
        } finally {
          frame.close();  // MUST close to avoid VideoFrame pile-up.
        }
      },
      error: (err) => {
        if (!this.loggedError) {
          console.warn(`[LatencyDecoder:${this.peerId}] decode error:`, err);
          this.loggedError = true;
        }
      },
    });
  }

  // Auto-detect codec from RTCRtpReceiver.getStats() and configure.
  // Polls every 200ms up to ~2s. Falls back to VP8 (WebRTC default) if no codec stat found.
  async autoConfigureFromReceiver(receiver) {
    if (!this.decoder || this.configured || this.closed) return this.configured;

    for (let attempt = 0; attempt < 10 && !this.closed && !this.configured; attempt++) {
      const codec = await this._probeCodec(receiver);
      if (codec) {
        this.configure(codec);
        return this.configured;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!this.configured) {
      console.warn(`[LatencyDecoder:${this.peerId}] codec stats not available after polling; falling back to vp8`);
      this.configure("vp8");
    }
    return this.configured;
  }

  async _probeCodec(receiver) {
    try {
      const stats = await receiver.getStats();
      for (const report of stats.values()) {
        if (report.type === "codec" && report.mimeType) {
          const id = mimeToWebCodecsId(report.mimeType);
          if (id) {
            console.log(`[LatencyDecoder:${this.peerId}] detected codec ${report.mimeType} -> ${id}`);
            return id;
          }
        }
      }
    } catch (e) {
      // ignore — try again next tick
    }
    return null;
  }

  configure(codec) {
    if (!this.decoder || this.configured || this.closed) return false;
    try {
      this.decoder.configure({ codec });
      this.configured = true;
      this.codec = codec;
      console.log(`[LatencyDecoder:${this.peerId}] configured for ${codec}`);
      return true;
    } catch (e) {
      console.warn(`[LatencyDecoder:${this.peerId}] configure failed for ${codec}:`, e);
      return false;
    }
  }

  // chunk shape: { type: 'key' | 'delta', data: ArrayBuffer, rtpTimestamp: number }
  feed(chunk) {
    if (!this.decoder || this.closed || !this.configured) return;
    if (chunk.rtpTimestamp == null || !chunk.data) return;

    const isKey = chunk.type === "key";
    if (!this.gotKeyframe) {
      if (!isKey) return;
      this.gotKeyframe = true;
    }

    try {
      const evc = new EncodedVideoChunk({
        type: isKey ? "key" : "delta",
        timestamp: chunk.rtpTimestamp,  // correlation key — flows through to VideoFrame
        data: chunk.data,
      });
      this.decoder.decode(evc);
    } catch (e) {
      if (!this.loggedError) {
        console.warn(`[LatencyDecoder:${this.peerId}] feed failed:`, e);
        this.loggedError = true;
      }
    }
  }

  close() {
    this.closed = true;
    if (this.decoder && this.decoder.state !== "closed") {
      try { this.decoder.close(); } catch {}
    }
  }
}
