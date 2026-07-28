const params = new URLSearchParams(location.search);

function splitMatcher(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolParam(name, defaultValue = false) {
  const value = params.get(name);
  if (value == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const GAME = (params.get("game") || "smokebreak").toLowerCase();

function defaultUnityUiBuildName(game) {
  if (game === "smokebreak") return "smokebreak-ui-webgl";
  return `${game}-ui-webgl`;
}

function defaultUnityUiCompression() {
  return "none";
}

const defaultUnityBuildName = defaultUnityUiBuildName(GAME);
const defaultUnityCompression = defaultUnityUiCompression();

export const UI_OFFLOAD_CONFIG = {
  game: GAME,
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
  unityWebglUi: boolParam("unityUi", true),
  unityUiBuildUrl: params.get("unityUiBuildUrl") || `./${defaultUnityBuildName}/Build`,
  unityUiBuildName: params.get("unityUiBuildName") || defaultUnityBuildName,
  unityUiBridgeObject: params.get("unityUiBridgeObject") || "SemanticUiBridge",
  unityUiCompression: params.get("unityUiCompression") || defaultUnityCompression,
  unityUiBlendMode: params.get("unityUiBlendMode") || "screen",
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
