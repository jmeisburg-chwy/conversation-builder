const SCENARIO_ID_PATTERN = /^[a-z0-9][a-z0-9_]{1,125}[a-z0-9]_(?:chat|voice)$/;
const PUBLICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEARNER_SESSION_ID_PATTERN = PUBLICATION_ID_PATTERN;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp)$/i;

const unavailable = () => new Error("Reference image unavailable.");

export function createScenarioAssetLoader({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw unavailable();
  const capabilityCache = new Map();

  async function capabilityFor(scenarioId, publicationId) {
    const cacheKey = `${scenarioId}\u0000${publicationId}`;
    if (!capabilityCache.has(cacheKey)) {
      const pending = fetchCapability(fetchImpl, scenarioId, publicationId)
        .catch((error) => {
          capabilityCache.delete(cacheKey);
          throw error;
        });
      capabilityCache.set(cacheKey, pending);
    }
    return capabilityCache.get(cacheKey);
  }

  return {
    async load({ scenarioId, assetKey, publicationId = "" }) {
      const safeScenarioId = validateScenarioId(scenarioId);
      const safeAssetKey = validateAssetKey(assetKey, safeScenarioId);
      const safePublicationId = validatePublicationId(publicationId);
      const headers = {};

      if (safePublicationId) {
        const capability = await capabilityFor(safeScenarioId, safePublicationId);
        headers["x-ccs-publication-capability"] = capability.publicationCapability;
        headers["x-ccs-learner-session-id"] = capability.learnerSessionId;
      }

      const query = new URLSearchParams({
        scenarioId: safeScenarioId,
        assetKey: safeAssetKey
      });
      if (safePublicationId) query.set("publicationId", safePublicationId);
      let response;
      try {
        response = await fetchImpl(`/api/scenario-asset?${query}`, {
          method: "GET",
          headers,
          cache: "no-store"
        });
      } catch {
        throw unavailable();
      }
      if (!response?.ok) throw unavailable();
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/")) throw unavailable();
      try {
        return await response.blob();
      } catch {
        throw unavailable();
      }
    },

    clear() {
      capabilityCache.clear();
    }
  };
}

async function fetchCapability(fetchImpl, scenarioId, publicationId) {
  const query = new URLSearchParams({ scenarioId, publicationId });
  let response;
  try {
    response = await fetchImpl(`/api/scenario?${query}`, {
      method: "GET",
      cache: "no-store"
    });
  } catch {
    throw unavailable();
  }
  if (!response?.ok) throw unavailable();

  let value;
  try {
    value = await response.json();
  } catch {
    throw unavailable();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const scenario = value.scenario;
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) throw unavailable();
  if (
    scenario.id !== scenarioId ||
    scenario.publicationId !== publicationId ||
    value.publicationId !== publicationId ||
    !CAPABILITY_PATTERN.test(String(value.publicationCapability || "")) ||
    !LEARNER_SESSION_ID_PATTERN.test(String(value.learnerSessionId || ""))
  ) {
    throw unavailable();
  }
  return {
    publicationCapability: value.publicationCapability,
    learnerSessionId: value.learnerSessionId
  };
}

function validateScenarioId(value) {
  const scenarioId = String(value || "").trim();
  if (!SCENARIO_ID_PATTERN.test(scenarioId)) throw unavailable();
  return scenarioId;
}

function validateAssetKey(value, scenarioId) {
  const assetKey = String(value || "").trim();
  if (
    !assetKey.startsWith(`assets/scenarios/${scenarioId}/`) ||
    assetKey.includes("..") ||
    assetKey.includes("\\") ||
    !IMAGE_EXTENSION_PATTERN.test(assetKey)
  ) {
    throw unavailable();
  }
  return assetKey;
}

function validatePublicationId(value) {
  const publicationId = String(value || "").trim().toLowerCase();
  if (publicationId && !PUBLICATION_ID_PATTERN.test(publicationId)) throw unavailable();
  return publicationId;
}
