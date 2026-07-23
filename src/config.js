const params = new URLSearchParams(location.search);

function splitMatcher(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const UI_OFFLOAD_CONFIG = {
  worldPeerMatch: splitMatcher(
    params.get("worldPeerMatch") || params.get("worldPeer"),
    "world,cloud,remote"
  ),
  uiPeerMatch: splitMatcher(
    params.get("uiPeerMatch") || params.get("uiPeer"),
    "ui,hud,local,client"
  ),
  uiBlendMode: params.get("uiBlendMode") || "screen",
  fallbackAssignment: params.get("uiOffloadFallback") !== "false",
  renderDataUi: params.get("renderDataUi") !== "false",
};

function matchesMatcher(peerId, matcher) {
  const normalizedPeerId = String(peerId).toLowerCase();
  const normalizedMatcher = String(matcher).toLowerCase();

  if (normalizedMatcher.startsWith("/") && normalizedMatcher.endsWith("/")) {
    try {
      return new RegExp(matcher.slice(1, -1), "i").test(peerId);
    } catch (error) {
      console.warn(`[UI Offload] Invalid peer matcher regex "${matcher}":`, error);
      return false;
    }
  }

  return normalizedPeerId.includes(normalizedMatcher);
}

export function matchUiOffloadPeerRole(peerId, config = UI_OFFLOAD_CONFIG) {
  const isWorldPeer = config.worldPeerMatch.some((matcher) => matchesMatcher(peerId, matcher));
  const isUiPeer = config.uiPeerMatch.some((matcher) => matchesMatcher(peerId, matcher));

  if (isWorldPeer && isUiPeer) {
    console.warn(`[UI Offload] Peer "${peerId}" matched both world and UI roles; using world.`);
    return "world";
  }
  if (isWorldPeer) return "world";
  if (isUiPeer) return "ui";
  return null;
}
