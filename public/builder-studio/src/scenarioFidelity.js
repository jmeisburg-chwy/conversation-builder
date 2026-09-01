function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function same(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function channelOf(scenario) {
  return Array.isArray(scenario?.channels) ? scenario.channels[0] : "";
}

const FAMILY_ID_MAX_LENGTH = 127;
const CHAT_MATCH_OPERATORS = new Set(["contains_any"]);

export function copyFamilyId(value, suffix) {
  const safeSuffix = String(suffix || "copy")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12) || "copy";
  const marker = `_copy_${safeSuffix}`;
  const originalBase = String(value || "scenario")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_(?:chat|voice)$/g, "") || "scenario";
  const base = originalBase
    .slice(0, FAMILY_ID_MAX_LENGTH - marker.length)
    .replace(/_+$/g, "") || "scenario";
  return `${base}${marker}`;
}

export function rebaseCanonicalFamily(scenarios, nextFamilyId) {
  return scenarios.map((scenario) => {
    const channel = channelOf(scenario);
    const copy = clone(scenario);
    copy.id = `${nextFamilyId}_${channel}`;
    if (copy.catalog && typeof copy.catalog === "object") {
      copy.catalog.groupId = nextFamilyId;
    }
    return copy;
  });
}

export function allRolePlayChecksPassed(readiness) {
  const tests = readiness?.tests || {};
  return ["intended_handling", "common_mistake", "recovery"]
    .every((id) => tests[id]?.status === "passed");
}

export function isThinPublishReady({ validation, confirmed, publishComplete }) {
  return validation?.ok === true && confirmed === true && publishComplete !== true;
}

export function composeWithCanonicalFidelity({
  baselineDraft,
  canonicalScenarios,
  baselineGeneratedScenarios,
  generatedScenarios
}) {
  const generatedOutput = clone(generatedScenarios);
  if (
    !Array.isArray(canonicalScenarios) ||
    !canonicalScenarios.length ||
    !baselineDraft ||
    !Array.isArray(baselineGeneratedScenarios) ||
    !baselineGeneratedScenarios.length ||
    !Array.isArray(generatedScenarios) ||
    !generatedScenarios.length
  ) {
    return generatedOutput;
  }

  const canonicalByIdentity = scenariosByIdentity(canonicalScenarios);
  const baselineByIdentity = scenariosByIdentity(baselineGeneratedScenarios);
  const generatedByIdentity = scenariosByIdentity(generatedScenarios);
  if (
    !canonicalByIdentity ||
    !baselineByIdentity ||
    !generatedByIdentity ||
    !sameScenarioIdentities(canonicalByIdentity, generatedByIdentity) ||
    !sameScenarioIdentities(baselineByIdentity, generatedByIdentity)
  ) {
    return generatedOutput;
  }

  return generatedScenarios.map((generated) => {
    const identity = scenarioIdentity(generated);
    const canonical = canonicalByIdentity.get(identity.key);
    const baseline = baselineByIdentity.get(identity.key);
    return applyLegacyCompatibilityFields({
      baseline,
      generated,
      canonical,
      channel: identity.channel
    });
  });
}

// Published scenarios may contain authored runtime details that the Studio model
// cannot represent. Preserve only these schema-defined compatibility paths. The
// output is always constructed from the current generated scenario, so server
// publication metadata and arbitrary canonical siblings can never be replayed.
function applyLegacyCompatibilityFields({ baseline, generated, canonical, channel }) {
  const output = clone(generated);

  if (channel === "chat" && sameChatProgression(baseline, generated)) {
    const canonicalChatProgression = sanitizeChatProgression(canonical);
    const protectedChatProgression = preserveGeneratedNegativeChatConditions(
      canonicalChatProgression,
      generated
    );
    if (protectedChatProgression) {
      output.chatConfig.stepProgression = protectedChatProgression;
      output.simulation.stateModel.chatStepProgression = clone(protectedChatProgression);
    }
  }

  if (channel === "voice" && sameVoiceGuidance(baseline, generated)) {
    const canonicalGuideSections = sanitizeVoiceGuideSections(canonical);
    const generatedGuideSections = output.frontend?.voice?.guideSections;
    if (
      canonicalGuideSections &&
      Array.isArray(generatedGuideSections) &&
      canonicalGuideSections.length === generatedGuideSections.length
    ) {
      output.frontend.voice.guideSections = generatedGuideSections.map((section, index) => ({
        ...section,
        ...canonicalGuideSections[index]
      }));
    }
  }

  return output;
}

function sameChatProgression(baseline, generated) {
  const baselineChat = baseline.chatConfig?.stepProgression;
  const baselineState = baseline.simulation?.stateModel?.chatStepProgression;
  const generatedChat = generated.chatConfig?.stepProgression;
  const generatedState = generated.simulation?.stateModel?.chatStepProgression;
  return [baselineChat, baselineState, generatedChat, generatedState].every(Array.isArray) &&
    same(baselineChat, baselineState) &&
    same(generatedChat, generatedState) &&
    same(baselineChat, generatedChat) &&
    same(baselineState, generatedState);
}

function sanitizeChatProgression(canonical) {
  const chatProgression = canonical.chatConfig?.stepProgression;
  const stateProgression = canonical.simulation?.stateModel?.chatStepProgression;
  const sanitizedChat = sanitizeChatSteps(chatProgression);
  const sanitizedState = sanitizeChatSteps(stateProgression);
  return sanitizedChat && sanitizedState && same(sanitizedChat, sanitizedState)
    ? sanitizedChat
    : null;
}

function sanitizeChatSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return null;
  const sanitized = steps.map(sanitizeChatStep);
  if (!sanitized.every(Boolean)) return null;
  const ids = sanitized.map((step) => chatStepIdentity(step.id));
  return new Set(ids).size === ids.length ? sanitized : null;
}

function sanitizeChatStep(step) {
  if (
    !plainObject(step) ||
    !chatStepIdentity(step.id) ||
    typeof step.label !== "string" ||
    typeof step.customerResponse !== "string" ||
    typeof step.scenarioPathHint !== "string"
  ) {
    return null;
  }
  const match = sanitizeChatMatch(step.match);
  if (!match) return null;
  return {
    id: step.id,
    label: step.label,
    match,
    customerResponse: step.customerResponse,
    scenarioPathHint: step.scenarioPathHint
  };
}

function sanitizeChatMatch(match) {
  if (!plainObject(match)) return null;
  const all = sanitizeChatConditions(match.all);
  const any = sanitizeChatConditions(match.any);
  const hasNone = Object.prototype.hasOwnProperty.call(match, "none");
  const none = hasNone ? sanitizeChatConditions(match.none) : [];
  if (!all || !any || !none || (!all.length && !any.length)) return null;
  return { all, any, ...(hasNone ? { none } : {}) };
}

function preserveGeneratedNegativeChatConditions(canonicalProgression, generated) {
  if (!canonicalProgression) return null;
  const generatedSteps = generated?.chatConfig?.stepProgression;
  if (!Array.isArray(generatedSteps)) return canonicalProgression;

  const generatedNoneById = new Map();
  for (const step of generatedSteps) {
    if (!plainObject(step?.match) || !Object.prototype.hasOwnProperty.call(step.match, "none")) continue;
    const none = sanitizeChatConditions(step.match.none);
    const id = chatStepIdentity(step.id);
    if (!none || !id || generatedNoneById.has(id)) return null;
    generatedNoneById.set(id, none);
  }
  if (!generatedNoneById.size) return canonicalProgression;

  const canonicalIds = new Set(canonicalProgression.map((step) => chatStepIdentity(step.id)));
  if ([...generatedNoneById.keys()].some((id) => !canonicalIds.has(id))) return null;
  return canonicalProgression.map((step) => {
    const none = generatedNoneById.get(chatStepIdentity(step.id));
    return none
      ? { ...step, match: { ...step.match, none: clone(none) } }
      : step;
  });
}

function sanitizeChatConditions(conditions) {
  if (!Array.isArray(conditions)) return null;
  const sanitized = conditions.map((condition) => {
    if (
      !plainObject(condition) ||
      !CHAT_MATCH_OPERATORS.has(condition.op) ||
      !Array.isArray(condition.phrases) ||
      !condition.phrases.length ||
      !condition.phrases.every((phrase) => typeof phrase === "string" && phrase.trim())
    ) {
      return null;
    }
    return { op: condition.op, phrases: clone(condition.phrases) };
  });
  return sanitized.every(Boolean) ? sanitized : null;
}

function chatStepIdentity(value) {
  if (typeof value === "string") return value.trim();
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function sameVoiceGuidance(baseline, generated) {
  return same(
    baseline.frontend?.voice?.guideSections,
    generated.frontend?.voice?.guideSections
  );
}

function sanitizeVoiceGuideSections(canonical) {
  const sections = canonical.frontend?.voice?.guideSections;
  if (!Array.isArray(sections)) return null;
  const sanitized = sections.map((section) => {
    if (
      !plainObject(section) ||
      typeof section.title !== "string" ||
      typeof section.body !== "string" ||
      !Array.isArray(section.bullets) ||
      !section.bullets.every((bullet) => typeof bullet === "string")
    ) {
      return null;
    }
    return {
      title: section.title,
      body: section.body,
      bullets: clone(section.bullets)
    };
  });
  return sanitized.every(Boolean) ? sanitized : null;
}

function scenariosByIdentity(scenarios) {
  const result = new Map();
  const ids = new Set();
  const channels = new Set();
  for (const scenario of scenarios) {
    const identity = scenarioIdentity(scenario);
    if (
      !identity ||
      result.has(identity.key) ||
      ids.has(identity.id) ||
      channels.has(identity.channel)
    ) {
      return null;
    }
    result.set(identity.key, scenario);
    ids.add(identity.id);
    channels.add(identity.channel);
  }
  return result;
}

function scenarioIdentity(scenario) {
  if (
    !plainObject(scenario) ||
    typeof scenario.id !== "string" ||
    !scenario.id.trim() ||
    scenario.id !== scenario.id.trim() ||
    !Array.isArray(scenario.channels) ||
    scenario.channels.length !== 1 ||
    !["chat", "voice"].includes(scenario.channels[0])
  ) {
    return null;
  }
  const channel = scenario.channels[0];
  return { id: scenario.id, channel, key: `${scenario.id}\u0000${channel}` };
}

function sameScenarioIdentities(left, right) {
  return left.size === right.size && [...right.keys()].every((key) => left.has(key));
}

function plainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
