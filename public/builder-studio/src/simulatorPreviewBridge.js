export const BUILDER_PREVIEW_MESSAGE_VERSION = 1;

const MAX_EVENT_TEXT_LENGTH = 20_000;
const CHANNELS = new Set(["chat", "voice"]);
const TURN_TYPES = new Set([
  "ccs:builder-learner-turn",
  "ccs:builder-partner-turn",
  "ccs:builder-transcript-turn"
]);
const EVENT_TYPES = new Set([
  "ccs:builder-ready",
  ...TURN_TYPES,
  "ccs:builder-ended",
  "ccs:builder-restart",
  "ccs:builder-resize"
]);
const BASE_KEYS = ["type", "version", "channel", "scenarioId", "previewCapability"];

function isBoundedString(value, maxLength = MAX_EVENT_TEXT_LENGTH) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function hasExactKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    allowedKeys.every((key) => Object.hasOwn(value, key));
}

function assertBootstrapValue(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function createPreviewBootstrap({
  channel,
  scenario,
  clientSecret,
  previewCapability,
  operationId
} = {}) {
  assertBootstrapValue(CHANNELS.has(channel), "Preview channel must be Chat or Voice.");
  assertBootstrapValue(scenario && typeof scenario === "object" && !Array.isArray(scenario), "Preview scenario is required.");
  assertBootstrapValue(isBoundedString(scenario.id, 240), "Preview scenario ID is required.");
  assertBootstrapValue(isBoundedString(clientSecret, 4096), "Preview client secret is required.");
  assertBootstrapValue(isBoundedString(previewCapability, 4096), "Preview capability is required.");
  assertBootstrapValue(isBoundedString(operationId, 240), "Preview operation ID is required.");

  return {
    type: "ccs:builder-bootstrap",
    version: BUILDER_PREVIEW_MESSAGE_VERSION,
    channel,
    scenario: structuredClone(scenario),
    clientSecret,
    previewCapability,
    operationId
  };
}

export function readBuilderPreviewEvent(event, expected = {}) {
  if (!event || event.origin !== expected.origin || event.source !== expected.source) return null;
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!EVENT_TYPES.has(data.type)) return null;
  if (data.version !== BUILDER_PREVIEW_MESSAGE_VERSION) return null;
  if (data.channel !== expected.channel || !CHANNELS.has(data.channel)) return null;
  if (data.scenarioId !== expected.scenarioId || !isBoundedString(data.scenarioId, 240)) return null;
  if (data.previewCapability !== expected.previewCapability || !isBoundedString(data.previewCapability, 4096)) return null;

  if (TURN_TYPES.has(data.type)) {
    if (!hasExactKeys(data, [...BASE_KEYS, "role", "text"])) return null;
    if (!new Set(["learner", "partner"]).has(data.role)) return null;
    if (!isBoundedString(data.text)) return null;
  } else if (data.type === "ccs:builder-resize") {
    if (!hasExactKeys(data, [...BASE_KEYS, "height"])) return null;
    if (!Number.isFinite(data.height)) return null;
  } else if (!hasExactKeys(data, BASE_KEYS)) {
    return null;
  }

  return data;
}

export function hasCompletedPreviewExchange(turns = []) {
  let learnerSeen = false;
  for (const turn of Array.isArray(turns) ? turns : []) {
    const text = String(turn?.text || "").trim();
    if (!text) continue;
    if (turn.role === "learner") learnerSeen = true;
    if (turn.role === "partner" && learnerSeen) return true;
  }
  return false;
}
