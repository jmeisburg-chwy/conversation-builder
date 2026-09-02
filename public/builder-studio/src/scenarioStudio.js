import {
  applyTuningToScenario,
  normalizeScenarioTuning
} from "./scenarioTuning.js";
import {
  BEHAVIOR_RUBRIC_REQUIRED_FIELDS,
  OFFICIAL_BEHAVIOR_IDS,
  SCENARIO_REQUIRED_TOP_LEVEL_FIELDS
} from "./scenarioContract.js";
import {
  emptySourceGrounding,
  normalizeSourceGrounding,
  publishableSourceGrounding,
  remapConversationPhaseCitations,
  sourceGroundingFromPublished
} from "./sourceGrounding.js";
import { containsAnyCompleteApprovedResponseTemplate } from "./approvedResponseTemplates.js";

export const STUDIO_DRAFT_VERSION = 2;

export const STUDIO_EVALUATION_MODES = [
  "customer_care_behaviors",
  "focused_learning_objectives"
];

const DEFAULT_SOURCE_MATERIAL =
  "A customer needs help with a Chewy request and wants a clear, approved next step.";

const FICTIONAL_PET_NAMES = ["Bailey", "Charlie", "Milo", "Luna"];

const BEHAVIOR_LABELS = {
  issue_understanding: "Issue Understanding",
  emotional_acknowledgement: "Emotional Acknowledgement",
  problem_ownership: "Problem Ownership",
  personalization: "Personalization",
  expectation_setting: "Expectation Setting",
  pet_engagement: "Pet Engagement",
  communication_style: "Communication Style"
};

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, fallback = "") {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function cleanMultiline(value, fallback = "") {
  const cleaned = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return cleaned || fallback;
}

export function stripAuthorFacingChallengePrefix(value) {
  return cleanText(value)
    .replace(
      /^\s*(?:challenge level|difficulty)\s*:\s*[^.\n—-]+(?:[.\n]|\s*[—-]\s*)?/iu,
      ""
    )
    .trim();
}

function cleanList(value, fallback = []) {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  const cleaned = input
    .map((item) => cleanText(item))
    .filter(Boolean);
  return cleaned.length ? [...new Set(cleaned)] : clone(fallback);
}

function criterionText(value) {
  return cleanText(isPlainObject(value) ? value.text : value);
}

function criterionTexts(values) {
  return (Array.isArray(values) ? values : [])
    .map(criterionText)
    .filter(Boolean);
}

function normalizeGuidanceBullet(value) {
  if (!isPlainObject(value)) return cleanText(value);
  const text = cleanText(value.text);
  const children = Array.isArray(value.children)
    ? value.children
        .filter((item) => typeof item === "string")
        .map((item) => cleanText(item))
        .filter(Boolean)
    : [];
  const reference = isPlainObject(value.systemReference)
    ? value.systemReference
    : null;
  if (!text) return "";
  const normalized = {
    text,
    ...(children.length ? { children: [...new Set(children)] } : {})
  };
  if (!reference) return children.length ? normalized : text;
  const assetKey = cleanText(reference.assetKey);
  const alt = cleanText(reference.alt);
  if (!assetKey || !alt) return children.length ? normalized : text;
  return {
    ...normalized,
    systemReference: {
      type: cleanText(reference.type, "image"),
      assetKey,
      alt,
      ...(cleanText(reference.caption)
        ? { caption: cleanText(reference.caption) }
        : {})
    }
  };
}

function normalizeGuidanceBullets(value, fallback = []) {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = input
    .map(normalizeGuidanceBullet)
    .filter((item) => typeof item === "string" ? Boolean(item) : Boolean(item?.text));
  return normalized.length ? normalized : clone(fallback);
}

const READINESS_TEST_IDS = [
  "intended_handling",
  "common_mistake",
  "recovery"
];

function normalizeReadinessStatus(value) {
  return ["not_tested", "passed", "needs_revision"].includes(value)
    ? value
    : "not_tested";
}

function normalizeReadiness(value = {}) {
  const candidate = isPlainObject(value) ? value : {};
  const incomingTests = isPlainObject(candidate.tests) ? candidate.tests : {};
  const testHistory = Array.isArray(candidate.testHistory)
    ? candidate.testHistory
        .map((entry) => {
          if (!isPlainObject(entry)) return null;
          const channel = ["chat", "voice"].includes(entry.channel)
            ? entry.channel
            : "";
          const completedAt = cleanText(entry.completedAt).slice(0, 40);
          const draftFingerprint = cleanText(entry.draftFingerprint).slice(0, 80);
          if (!channel || !completedAt || !draftFingerprint) return null;
          return {
            completedAt,
            channel,
            draftFingerprint,
            sessionReference: cleanText(entry.sessionReference).slice(0, 128),
            transcriptReference: cleanText(entry.transcriptReference).slice(0, 128)
          };
        })
        .filter(Boolean)
        .slice(-20)
    : [];
  return {
    required: candidate.required === true,
    contentReviewed: candidate.contentReviewed === true,
    testHistory,
    tests: Object.fromEntries(
      READINESS_TEST_IDS.map((id) => [
        id,
        {
          status: normalizeReadinessStatus(incomingTests[id]?.status),
          notes: cleanMultiline(incomingTests[id]?.notes)
        }
      ])
    )
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprintText(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function materialDraftFingerprint(draft = {}) {
  const material = {
    conversation: {
      description: draft.scenario?.description || "",
      learnerGoal: draft.scenario?.learnerGoal || "",
      channels: draft.scenario?.channels || []
    },
    flow: {
      phases: draft.flow?.phases || [],
      closingPartnerTurn: draft.flow?.closingPartnerTurn || ""
    },
    partner: draft.partner || {},
    guardrails: {
      avoid: draft.handling?.avoid || [],
      facts: draft.facts || {}
    },
    evaluation: {
      mode: draft.evaluation?.mode || "",
      criteria: draft.evaluation?.criteria || [],
      passingScore: draft.evaluation?.passingScore ?? null,
      objectives: draft.evaluation?.objectives || []
    },
    openings: {
      scenario: draft.scenario?.openingLine || "",
      chat: draft.chat?.openingLine || "",
      voice: draft.voice?.openingLine || ""
    },
    partnerBehavior: {
      tuning: draft.tuning || {},
      chatStarts: draft.chat?.customerStarts ?? null,
      voiceStarts: draft.voice?.customerStarts ?? null
    }
  };
  return `material-v2-${fingerprintText(stableJson(material))}`;
}

export function isCurrentMaterialDraftFingerprint(draft = {}, fingerprint = "") {
  const expected = cleanText(fingerprint);
  return Boolean(expected && expected === materialDraftFingerprint(draft));
}

export function evaluationApprovalFingerprint(draft = {}) {
  const evaluation = draft.evaluation || {};
  const objectives = (evaluation.objectives || []).map((objective) => ({
    id: cleanText(objective?.id),
    label: cleanText(objective?.label),
    description: cleanText(objective?.description),
    criteria: (objective?.criteria || []).map((criterion) => ({
      id: cleanText(criterion?.id),
      text: criterionText(criterion)
    }))
  }));
  const phaseAssignments = (draft.flow?.phases || []).map((phase) => ({
    id: cleanText(phase?.id),
    evaluationLinks: (phase?.evaluationLinks || []).map((link) => ({
      objectiveId: cleanText(link?.objectiveId),
      criterionIds: cleanList(link?.criterionIds)
    }))
  })).sort((left, right) => left.id.localeCompare(right.id));
  return `evaluation-v1-${fingerprintText(stableJson({ objectives, phaseAssignments }))}`;
}

export function approveEvaluation(draft = {}, approvedAt = new Date().toISOString()) {
  const next = clone(draft);
  next.evaluation ||= {};
  next.evaluation.approval = {
    fingerprint: evaluationApprovalFingerprint(next),
    approvedAt: cleanText(approvedAt, new Date().toISOString()).slice(0, 40)
  };
  return next;
}

export function approveCurrentEvaluationForTest(
  draft = {},
  approvedAt = new Date().toISOString()
) {
  return approveEvaluation(normalizeStudioDraft(draft), approvedAt);
}

export function selectedPhaseEvaluation(input = {}, phaseId = "") {
  const draft = normalizeStudioDraft(input);
  const phase = draft.flow.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) return [];
  return phase.evaluationLinks.flatMap((link) => {
    const objective = draft.evaluation.objectives.find(
      (candidate) => candidate.id === link.objectiveId
    );
    if (!objective) return [];
    const selectedIds = new Set(link.criterionIds);
    const criteria = objective.criteria.filter((criterion) =>
      selectedIds.has(criterion.id)
    );
    return criteria.length ? [{ objective, criteria }] : [];
  });
}

export function isEvaluationApproved(draft = {}) {
  const approval = draft.evaluation?.approval;
  return Boolean(
    approval?.approvedAt &&
    approval?.fingerprint === evaluationApprovalFingerprint(draft)
  );
}

export function hasCurrentDraftTest(draft = {}) {
  const fingerprint = materialDraftFingerprint(draft);
  return (draft.readiness?.testHistory || []).some((entry) =>
    entry?.draftFingerprint === fingerprint &&
    ["chat", "voice"].includes(entry?.channel) &&
    Boolean(entry?.completedAt) &&
    Boolean(cleanText(entry?.sessionReference)) &&
    transcriptReferenceHasBothTurns(entry?.transcriptReference)
  );
}

export function isPublishReadyForCurrentDraft(draft = {}) {
  return isEvaluationApproved(draft);
}

export function canEnterPublish(input = {}) {
  return isEvaluationApproved(normalizeStudioDraft(input));
}

export function recordCompletedDraftTest(draft = {}, evidence = {}) {
  const next = clone(draft);
  next.readiness = normalizeReadiness(next.readiness);
  const channel = ["chat", "voice"].includes(evidence.channel) ? evidence.channel : "";
  const sessionReference = cleanText(evidence.sessionReference).slice(0, 128);
  const transcriptReference = cleanText(evidence.transcriptReference).slice(0, 128);
  if (!channel || !sessionReference || !transcriptReferenceHasBothTurns(transcriptReference)) {
    return next;
  }
  next.readiness.testHistory.push({
    completedAt: cleanText(evidence.completedAt, new Date().toISOString()).slice(0, 40),
    channel,
    draftFingerprint: materialDraftFingerprint(next),
    sessionReference,
    transcriptReference
  });
  next.readiness.testHistory = next.readiness.testHistory.slice(-20);
  return next;
}

function transcriptReferenceHasBothTurns(value) {
  const text = cleanText(value);
  const countFor = (role) => {
    const compact = text.match(new RegExp(`\\b${role}\\s*:\\s*(\\d+)`, "i"));
    const prose = text.match(new RegExp(`\\b(\\d+)\\s+${role}\\s+turns?\\b`, "i"));
    return Number(compact?.[1] || prose?.[1] || 0);
  };
  return countFor("learner") >= 1 && countFor("partner") >= 1;
}

function slugify(value, fallback = "customer_order_support") {
  const normalize = (input) => String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_(chat|voice)$/u, "");
  let slug = normalize(value) || normalize(fallback) || "scenario";
  if (slug.length < 3) slug = `${slug}_scenario`;
  return slug.slice(0, 127).replace(/_+$/g, "");
}

function uniqueEntityId(existingIds = [], requested = "", fallback = "item") {
  const used = new Set(existingIds.map((id) => slugify(id, fallback)));
  const base = slugify(requested, fallback);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function normalizeStableId(value, fallback = "item") {
  const normalize = (input) => String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (normalize(value) || normalize(fallback) || "item").slice(0, 96).replace(/_+$/g, "");
}

function uniqueStableId(usedIds, requested, fallback) {
  const base = normalizeStableId(requested, fallback);
  if (!usedIds.has(base)) return base;
  let suffix = 2;
  while (usedIds.has(`${base.slice(0, 96 - String(suffix).length - 1)}_${suffix}`)) {
    suffix += 1;
  }
  return `${base.slice(0, 96 - String(suffix).length - 1)}_${suffix}`;
}

function titleCase(value) {
  return cleanText(value)
    .split(/[_\s/-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCustomerName(material) {
  const match = String(material || "").match(
    /^\s*([A-Z][a-z]{1,30})\s+(?:needs|wants|contacts|contacted|calls|called|is)\b/u
  );
  return match?.[1] || "";
}

function inferPetName(material) {
  const matches = [
    ...String(material || "").matchAll(
      /\bfor\s+([A-Z][a-z]{1,30})(?=[\s,.!?]|$)/gu
    )
  ];
  const excluded = new Set([
    "Chewy",
    "Customer",
    "Help",
    "Pharmacy",
    "Support"
  ]);
  return matches.map((match) => match[1]).find((name) => !excluded.has(name)) || "";
}

function isGenericPetName(value) {
  const name = cleanText(value).toLowerCase().replace(/[’]/g, "'");
  return !name || /^(?:the\s+)?customer'?s\s+pet$/u.test(name) || /^\[?pet name\]?$/u.test(name);
}

function fictionalPetNameFor(material) {
  const key = cleanText(material, DEFAULT_SOURCE_MATERIAL).toLowerCase();
  const index = [...key].reduce(
    (total, character) => total + character.codePointAt(0),
    0,
  ) % FICTIONAL_PET_NAMES.length;
  return FICTIONAL_PET_NAMES[index];
}

function normalizedPetName(value, material) {
  const authored = cleanText(value);
  if (!isGenericPetName(authored)) return authored;
  const inferred = inferPetName(material);
  return !isGenericPetName(inferred) ? inferred : fictionalPetNameFor(material);
}

function isCustomerCareSource(source, material) {
  if (source.customerName || source.petName || source.product) return true;
  const domainText = String(material || "")
    .replace(/^customer situation:\s*/gimu, "")
    .toLowerCase();
  return /\b(chewy|customer|pet|order|delivery|shipment|refund|replacement|autoship|pharmacy|prescription|medication|clinic|veterinar(?:y|ian))\b/u.test(
    domainText
  );
}

function inferPartnerRole(material, customerCare) {
  if (customerCare) return "Chewy Customer";
  const text = String(material || "").toLowerCase();
  if (/\b(team member|employee|direct report)\b/u.test(text)) return "Team member";
  if (/\b(candidate|applicant|interviewee)\b/u.test(text)) return "Candidate";
  if (/\b(peer|colleague|coworker)\b/u.test(text)) return "Colleague";
  if (/\b(manager|supervisor|leader)\b/u.test(text)) return "Manager";
  return "Conversation participant";
}

function inferProduct(material, isRx) {
  const text = cleanText(material).toLowerCase();
  const exactCandidates = [
    "pharmacy prescription renewal",
    "prescription renewal",
    "prescription refill",
    "medication refill",
    "prescription food",
    "prescription",
    "medication",
    "autoship",
    "subscription",
    "refund",
    "replacement"
  ];
  const exact = exactCandidates.find((candidate) => text.includes(candidate));
  if (exact) {
    return exact === "pharmacy prescription renewal"
      ? "prescription renewal"
      : exact;
  }

  const merchandise = text.match(
    /\b(?:([a-z][a-z'-]*)\s+)?(food|litter|supplies)(?:\s+(order|shipment|delivery))?\b/u
  );
  if (merchandise) {
    const modifier = ["chewy", "delayed", "late", "the", "a"].includes(
      merchandise[1]
    )
      ? ""
      : merchandise[1];
    return cleanText(
      [modifier, merchandise[2], merchandise[3]].filter(Boolean).join(" ")
    );
  }
  const fulfillment = text.match(/\b(order|shipment|delivery)\b/u)?.[1];
  if (fulfillment) return fulfillment;
  return isRx ? "pharmacy request" : "customer request";
}

function supportSubject(product) {
  const value = cleanText(product, "customer request");
  return /\b(request|issue|concern|question|support)\b/iu.test(value)
    ? value
    : `${value} request`;
}

function petContext(petName) {
  const value = cleanText(petName);
  return !value || /customer'?s pet/iu.test(value) ? "" : ` for ${value}`;
}

function isGenericCustomerName(customerName) {
  return /^customer$/iu.test(cleanText(customerName));
}

function customerReference(customerName) {
  return isGenericCustomerName(customerName)
    ? "the customer"
    : cleanText(customerName, "the customer");
}

function customerPossessive(customerName) {
  const name = cleanText(customerName);
  if (!name || isGenericCustomerName(name)) return "the customer's";
  return /s$/iu.test(name) ? `${name}'` : `${name}'s`;
}

function sourceScenarioDescription({ customerName, petName, product }) {
  const subject =
    cleanText(customerName, "Customer") === "Customer"
      ? "A customer"
      : cleanText(customerName);
  return `${subject} needs Chewy support with a ${supportSubject(product)}${petContext(petName)} and wants a clear, approved next step.`;
}

function normalizeChannels(value) {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  const channels = input
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => item === "chat" || item === "voice");
  return [...new Set(channels)].length ? [...new Set(channels)] : ["chat", "voice"];
}

function normalizeEvaluationMode(value) {
  const mode = cleanText(value).toLowerCase();
  if (
    mode === "focused_learning_objectives" ||
    mode === "learning_objective" ||
    mode === "learning_objectives" ||
    mode.includes("learning objective")
  ) {
    return "focused_learning_objectives";
  }
  return "customer_care_behaviors";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSourceInput(source) {
  if (typeof source === "string") {
    return normalizeSourceInput({ type: "idea", material: source });
  }
  if (!isPlainObject(source)) {
    return normalizeSourceInput({ type: "idea", material: DEFAULT_SOURCE_MATERIAL });
  }
  const material = cleanMultiline(
    source.material || source.sourceMaterial || source.description,
    DEFAULT_SOURCE_MATERIAL
  );
  const requestedAgentType = cleanText(source.agentType);
  const isRx =
    /^rx$/iu.test(requestedAgentType) ||
    /\b(rx|pharmacy|prescription|medication|clinic|veterinar(?:y|ian))\b/iu.test(
      material
    );
  const customerCare = isCustomerCareSource(source, material) || isRx;
  const product = customerCare
    ? cleanText(source.product, inferProduct(material, isRx))
    : "";
  const customerName = cleanText(
    source.customerName,
    inferCustomerName(material) || (customerCare ? "Customer" : "Conversation Partner")
  );
  const petName = customerCare ? normalizedPetName(source.petName, material) : "";
  const partnerInput = isPlainObject(source.partner) ? source.partner : {};
  const partnerRole = cleanText(
    partnerInput.role || source.partnerRole,
    inferPartnerRole(material, customerCare)
  );
  const partnerMood = cleanText(
    partnerInput.mood || source.customerEmotion,
    customerCare ? "Concerned" : "Open but thoughtful"
  );
  return {
    type: cleanText(source.type || source.sourceType, "idea"),
    material,
    title: cleanText(source.title),
    channels: source.channels,
    evaluationMode: source.evaluationMode || source.mode,
    anonymized: source.anonymized === true,
    generalized: source.generalized === true,
    customerCare,
    customerName,
    petName,
    product,
    agentType: isRx
      ? "Rx"
      : cleanText(requestedAgentType, customerCare ? "Core" : "General"),
    topic: cleanText(
      source.topic,
      isRx
        ? "Pharmacy Support"
        : customerCare
          ? titleCase(supportSubject(product))
          : /\b(feedback|coaching|performance)\b/iu.test(material)
            ? "Coaching and Feedback"
            : "Conversation Practice"
    ),
    subtopic: cleanText(
      source.subtopic,
      isRx ? titleCase(product) : customerCare ? "Issue Resolution" : "Practice"
    ),
    primarySkillFocus: cleanText(
      source.primarySkillFocus,
      customerCare ? "Issue Understanding" : "Conversation Skills"
    ),
    customerEmotion: partnerMood,
    partner: {
      name: cleanText(partnerInput.name || source.partnerName, customerName),
      role: partnerRole,
      mood: partnerMood,
      personality: cleanText(
        partnerInput.personality,
        customerCare
          ? "Realistic, concise, and focused on receiving accurate help."
          : "Realistic, professional, and responsive to the learner's approach."
      ),
      knows: cleanList(partnerInput.knows, [material]),
      withholds: cleanList(partnerInput.withholds),
      behaviorRules: cleanList(
        partnerInput.behaviorRules,
        [
          "Stay in the assigned role and never act as the learner.",
          "Use only authored information and wait after each completed response."
        ]
      )
    }
  };
}

function defaultCorrectHandling(customerName, product, customerCare = true) {
  if (!customerCare) {
    return [
      "Open the conversation and explain its purpose clearly.",
      "Ask focused questions and listen for the Conversation Partner's perspective.",
      "Confirm the agreed next step and close with shared understanding."
    ];
  }
  const request = supportSubject(product);
  const customer = customerReference(customerName);
  return [
    `Acknowledge ${customerPossessive(customerName)} concern about the ${request} before moving into details.`,
    `Confirm the relevant customer information and explain the approved next step for the ${request} clearly.`,
    `Check that ${customer} understands what will happen next and close with ownership.`
  ];
}

function defaultAvoidHandling(customerCare = true) {
  if (!customerCare) {
    return [
      "Do not invent facts, make unsupported promises, or speak for the Conversation Partner.",
      "Do not skip the conversation purpose or close without confirming the next step."
    ];
  }
  return [
    "Do not invent customer details, promise an unsupported outcome, or offer an unapproved resolution.",
    "Do not skip required verification or state that an account action is complete when it is not."
  ];
}

function defaultCustomerResponses(customerCare = true) {
  if (!customerCare) {
    return [
      "I understand why you wanted to talk. Can you share what you have observed?",
      "That context helps. I would like to share my perspective.",
      "I understand the next step and what we agreed to do."
    ];
  }
  return [
    "Thank you. I want to understand what is happening with my request.",
    "That helps. What should I expect next?",
    "That answers my question. Thank you for helping me."
  ];
}

function buildDefaultGuidance(correct) {
  return correct.map((step, index) => ({
    title: `${index + 1}. ${index === 0 ? "Understand the Concern" : index === correct.length - 1 ? "Confirm the Next Step" : "Handle the Request"}`,
    body: step,
    bullets: [step]
  }));
}

function normalizePartner(value, fallback) {
  const candidate = isPlainObject(value) ? value : {};
  return {
    name: cleanText(candidate.name, fallback.name),
    role: cleanText(candidate.role, fallback.role),
    mood: cleanText(candidate.mood, fallback.mood),
    personality: cleanText(candidate.personality, fallback.personality),
    knows: cleanList(candidate.knows, fallback.knows),
    withholds: cleanList(candidate.withholds, fallback.withholds),
    behaviorRules: cleanList(candidate.behaviorRules, fallback.behaviorRules)
  };
}

function createBaseDraft(sourceInput = {}) {
  const source = normalizeSourceInput(sourceInput);
  const title = source.title || (source.customerCare
    ? `${titleCase(source.product)} Practice`
    : "Conversation Practice");
  const customerName = source.customerName;
  const petName = source.petName;
  const product = source.product;
  const request = supportSubject(product);
  const customer = customerReference(customerName);
  const correct = defaultCorrectHandling(customerName, product, source.customerCare);
  const avoid = defaultAvoidHandling(source.customerCare);
  const baseId = slugify(title);
  const learnerGoal = source.customerCare
    ? `Support ${customer} by understanding the ${request}, following the approved Chewy process, and setting a clear next expectation.`
    : "Lead a clear conversation, understand the Conversation Partner's perspective, and agree on an actionable next step.";
  const description = source.customerCare
    ? sourceScenarioDescription({ customerName, petName, product })
    : source.material;
  const openingLine = source.customerCare
    ? `Hi, I need help with my ${request}${petContext(petName)}. Can you help me understand what happens next?`
    : "Thanks for meeting with me. What would you like to discuss?";

  return {
    studioVersion: STUDIO_DRAFT_VERSION,
    draftId: baseId,
    updatedAt: new Date().toISOString(),
    source: {
      type: source.type,
      material: source.material,
      anonymized: source.anonymized,
      generalized: source.generalized
    },
    sourceGrounding: emptySourceGrounding(),
    scenario: {
      baseId,
      title,
      description,
      channels: normalizeChannels(source.channels),
      teamAudience: source.customerCare ? "Customer Care" : "Training",
      agentType: source.agentType,
      difficulty: "beginner",
      topic: source.topic,
      subtopic: source.subtopic,
      primarySkillFocus: source.primarySkillFocus,
      customerEmotion: source.customerEmotion,
      customerName,
      petName,
      product,
      openingLine,
      learnerGoal
    },
    handling: {
      correct,
      avoid,
      customerResponses: defaultCustomerResponses(source.customerCare)
    },
    facts: {
      keyQuestion: source.customerCare
        ? `What approved help can Chewy provide for the ${request}?`
        : "What does the Conversation Partner need the Learner to understand?",
      shareOnlyIfAsked: [source.customerCare
        ? "relevant customer details"
        : "relevant conversation details"],
      address: "",
      medication: "",
      rootCauseBelief: source.customerCare
        ? `The customer believes the ${request} needs attention because the approved next step is unclear.`
        : "The Conversation Partner has a perspective the Learner needs to understand.",
      urgency: source.customerCare
        ? `The customer wants clear help with the ${request} and an approved next step.`
        : "The Conversation Partner wants a clear, constructive conversation and an actionable next step.",
      allowedObjections: [
        source.customerCare
          ? "Ask for a clearer explanation if the learner gives a vague or incomplete answer."
          : "Ask for a clearer explanation if the learner is vague or skips the conversation purpose."
      ],
      closingLine: source.customerCare
        ? "That answers my question. Thank you for your help."
        : "I understand what we agreed to do next.",
      clinic: "",
      conditionalFollowUp: source.customerCare
        ? "Share protected customer details only after the learner asks for or verifies the relevant information."
        : "Share authored details only when the learner asks a relevant question."
    },
    evaluation: {
      mode: source.customerCare
        ? normalizeEvaluationMode(source.evaluationMode)
        : "focused_learning_objectives",
      criteria: [...correct, ...avoid],
      passingScore: 100,
      objectives: [
        {
          id: source.customerCare ? "approved_customer_support" : "approved_conversation_path",
          label: source.customerCare
            ? "Use the approved customer support path"
            : "Lead the conversation effectively",
          description: learnerGoal,
          criteria: correct
        }
      ]
    },
    voice: {
      selectedVoice: "marin",
      speed: 1,
      customerStarts: true,
      openingLine,
      pacing:
        "Use calm, natural pacing and wait for each completed learner response."
    },
    chat: {
      hotkeyProfile: source.agentType === "Rx" ? "rx" : "core",
      customerStarts: true,
      openingLine,
      standardText: [],
      approvedResponseAssignments: []
    },
    guidance: {
      sections: buildDefaultGuidance(correct)
    },
    partner: clone(source.partner),
    readiness: normalizeReadiness(),
    tuning: {
      version: 1,
      voice: {
        id: "marin",
        speed: 1
      },
      customer: {
        emotionIntensity: 2,
        patience: 4,
        resistance: 2,
        responseLength: "brief"
      },
      conversation: {
        informationReveal: [
          {
            id: source.customerCare ? "customer_details" : "conversation_details",
            label: source.customerCare
              ? "Relevant customer details"
              : "Relevant conversation details",
            trigger: "when_asked"
          }
        ],
        objectionBehavior: "gap_only",
        recoveryTolerance: 2
      }
    }
  };
}

function normalizeCriterion(value, objectiveId, index) {
  const candidate = isPlainObject(value) ? value : { text: value };
  const text = cleanText(candidate.text);
  return text ? {
    id: slugify(candidate.id || `${objectiveId}_criterion_${index + 1}`),
    text
  } : null;
}

function normalizeObjectives(value, fallback) {
  const input = Array.isArray(value) ? value : [];
  const objectives = input
    .map((objective, index) => {
      if (!isPlainObject(objective)) return null;
      const label = cleanText(objective.label, `Learning objective ${index + 1}`);
      const id = slugify(objective.id || label, `learning_objective_${index + 1}`);
      const criteria = (Array.isArray(objective.criteria) ? objective.criteria : fallback)
        .map((criterion, criterionIndex) => normalizeCriterion(criterion, id, criterionIndex))
        .filter(Boolean);
      return {
        id,
        label,
        description: cleanText(objective.description, label),
        criteria
      };
    })
    .filter(Boolean);
  return objectives.length
    ? objectives
    : [
        {
          id: "approved_customer_support",
          label: "Use the approved customer support path",
          description: cleanText(fallback[0], "Use the approved Chewy customer support path."),
          criteria: fallback
            .map((criterion, index) => normalizeCriterion(criterion, "approved_customer_support", index))
            .filter(Boolean)
        }
      ];
}

export function removeObjective(draft = {}, objectiveId = "") {
  const next = clone(draft);
  const objectives = Array.isArray(next.evaluation?.objectives)
    ? next.evaluation.objectives
    : [];
  if (objectives.length <= 1 || !objectives.some((objective) => objective.id === objectiveId)) {
    return next;
  }
  const remainingObjectives = objectives.filter((objective) => objective.id !== objectiveId);
  if (isPlainObject(next.sourceGrounding?.citations)) {
    const objectiveIndexById = new Map(remainingObjectives.map((objective, index) => [
      objective.id,
      index
    ]));
    const citations = {};
    Object.entries(next.sourceGrounding.citations).forEach(([path, entries]) => {
      const objectiveMatch = path.match(/^evaluation\.objectives\.(\d+)(?:\.(.*))?$/);
      if (!objectiveMatch) {
        citations[path] = entries;
        return;
      }
      const previousObjective = objectives[Number(objectiveMatch[1])];
      const nextObjectiveIndex = objectiveIndexById.get(previousObjective?.id);
      if (nextObjectiveIndex === undefined) return;
      let suffix = objectiveMatch[2] || "";
      const criterionMatch = suffix.match(/^criteria\.(\d+)(?:\.(.*))?$/);
      if (criterionMatch) {
        const previousCriterion = previousObjective?.criteria?.[Number(criterionMatch[1])];
        const previousCriterionId = isPlainObject(previousCriterion)
          ? cleanText(previousCriterion.id)
          : "";
        const nextCriterionIndex = (remainingObjectives[nextObjectiveIndex].criteria || [])
          .findIndex((criterion) =>
            isPlainObject(criterion) && cleanText(criterion.id) === previousCriterionId
          );
        if (!previousCriterionId || nextCriterionIndex < 0) return;
        suffix = `criteria.${nextCriterionIndex}${criterionMatch[2] ? `.${criterionMatch[2]}` : ""}`;
      }
      const remappedPath = `evaluation.objectives.${nextObjectiveIndex}${suffix ? `.${suffix}` : ""}`;
      citations[remappedPath] = entries;
    });
    next.sourceGrounding.citations = citations;
  }
  next.evaluation.objectives = remainingObjectives;
  if (Array.isArray(next.flow?.phases)) {
    next.flow.phases = next.flow.phases.map((phase) => ({
      ...phase,
      evaluationLinks: (Array.isArray(phase.evaluationLinks) ? phase.evaluationLinks : [])
        .filter((link) => link.objectiveId !== objectiveId)
    }));
  }
  return next;
}

export function addObjective(draft = {}, {
  objectiveId = "learning_objective",
  criterionId = "",
} = {}) {
  const next = clone(draft);
  const objectives = Array.isArray(next.evaluation?.objectives)
    ? next.evaluation.objectives
    : [];
  if (objectives.length >= 12) return { draft: next, objectiveId: "", criterionId: "" };
  const id = uniqueEntityId(
    objectives.map((item) => item.id),
    objectiveId,
    "learning_objective",
  );
  const allCriterionIds = objectives.flatMap((item) =>
    (item.criteria || []).map((criterion) => criterion.id)
  );
  const nextCriterionId = uniqueEntityId(
    allCriterionIds,
    criterionId || `${id}_criterion_1`,
    `${id}_criterion_1`,
  );
  next.evaluation ||= {};
  next.evaluation.objectives = [
    ...objectives,
    { id, label: "", description: "", criteria: [{ id: nextCriterionId, text: "" }] },
  ];
  return { draft: next, objectiveId: id, criterionId: nextCriterionId };
}

export function updateObjectiveLabel(draft = {}, objectiveId = "", label = "") {
  const next = clone(draft);
  next.evaluation ||= {};
  next.evaluation.objectives = (next.evaluation.objectives || []).map((objective) =>
    objective.id === objectiveId ? { ...objective, label: String(label || "") } : objective
  );
  return next;
}

function normalizeGuidance(value, correct) {
  const input = Array.isArray(value) ? value : [];
  const sections = input
    .map((section, index) => {
      if (!isPlainObject(section)) return null;
      const title = cleanText(section.title, `${index + 1}. Coach Chewy Guidance`);
      const body = cleanText(section.body, correct[index] || correct[0]);
      const bullets = normalizeGuidanceBullets(section.bullets, [body]);
      return { title, body, bullets };
    })
    .filter(Boolean);
  return sections.length ? sections : buildDefaultGuidance(correct);
}

function normalizeGuidanceChild(value, phaseId, itemIndex, childIndex) {
  const candidate = isPlainObject(value) ? value : { text: value };
  const text = cleanText(candidate.text);
  const kindOverride = candidate.kindOverride === true;
  return text ? {
    id: cleanText(candidate.id, `${phaseId}_guidance_${itemIndex + 1}_${childIndex + 1}`),
    text,
    kind: (kindOverride && candidate.kind === "support")
      ? "support"
      : candidate.kind === "caution" || /^(?:do not|don't|never|avoid)\b/iu.test(text)
      ? "caution"
      : "support",
    ...(kindOverride ? { kindOverride: true } : {})
  } : null;
}

function normalizeGuidanceItem(value, phaseId, itemIndex) {
  const candidate = isPlainObject(value) ? value : { text: value };
  const text = cleanText(candidate.text || candidate.body);
  if (!text) return null;
  const children = (Array.isArray(candidate.children) ? candidate.children : [])
    .map((child, childIndex) => normalizeGuidanceChild(child, phaseId, itemIndex, childIndex))
    .filter(Boolean);
  return {
    id: cleanText(candidate.id, `${phaseId}_guidance_${itemIndex + 1}`),
    text,
    ...(children.length ? { children } : {}),
    ...(isPlainObject(candidate.systemReference) ? { systemReference: clone(candidate.systemReference) } : {})
  };
}

function normalizePhaseGuidance(value, phaseId, index, fallback = "") {
  const candidate = isPlainObject(value) ? value : {};
  const body = cleanText(candidate.body, fallback);
  const sourceBullets = Array.isArray(candidate.bullets) && candidate.bullets.length
    ? candidate.bullets
    : body ? [body] : [];
  const bullets = sourceBullets
    .map((bullet, itemIndex) => normalizeGuidanceItem(bullet, phaseId, itemIndex))
    .filter(Boolean);
  return {
    title: cleanText(candidate.title, `Coach Chewy Guidance ${index + 1}`),
    bullets
  };
}

function projectGuidanceBulletForRuntime(bullet) {
  if (!isPlainObject(bullet)) return cleanText(bullet);
  const hasChildren = Array.isArray(bullet.children) && bullet.children.length > 0;
  const hasSystemReference = isPlainObject(bullet.systemReference);
  return hasChildren || hasSystemReference
    ? clone(bullet)
    : cleanText(bullet.text);
}

function phasesFromLegacyFields({ correct, customerResponses, guidanceSections, openingLine }) {
  return correct.map((strongLearnerResponse, index) => {
    const coachGuidance = guidanceSections[index] || {};
    const id = `phase_${index + 1}`;
    return {
      id,
      title: cleanText(coachGuidance.title, `Phase ${index + 1}`),
      purpose: cleanText(coachGuidance.body, strongLearnerResponse),
      partnerTurn: index === 0
        ? cleanText(openingLine)
        : cleanText(customerResponses[index - 1]),
      strongLearnerResponse,
      chatAdvanceRequirements: [],
      coachGuidance: normalizePhaseGuidance(coachGuidance, id, index, strongLearnerResponse),
      advanceWhen: strongLearnerResponse,
      evaluationLinks: []
    };
  });
}

function normalizeChatAdvanceRequirements(value, phaseId) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((requirement, index) => {
    if (!isPlainObject(requirement)) return [];
    const phrases = [...new Set(cleanList(requirement.phrases).map((phrase) => phrase.toLowerCase()))];
    return [{
      id: slugify(cleanText(requirement.id, `${phaseId}_requirement_${index + 1}`)),
      phrases,
    }];
  });
}

function normalizeConversationPhases(value, fallback, openingLine) {
  const incoming = Array.isArray(value) ? value : [];
  const phases = incoming.length ? incoming : fallback;
  return phases.map((phase, index) => {
    const candidate = isPlainObject(phase) ? phase : {};
    const id = cleanText(candidate.id, `phase_${index + 1}`);
    const strongLearnerResponse = cleanText(
      candidate.strongLearnerResponse,
      cleanText(candidate.learnerExpectation)
    );
    const fallbackPartnerTurn = index === 0
      ? cleanText(openingLine)
      : cleanText(phases[index - 1]?.partnerResponse);
    return {
      id,
      title: cleanText(candidate.title, `Phase ${index + 1}`),
      purpose: cleanText(candidate.purpose),
      partnerTurn: cleanText(candidate.partnerTurn, fallbackPartnerTurn),
      strongLearnerResponse,
      learnerActions: cleanList(candidate.learnerActions, strongLearnerResponse ? [strongLearnerResponse] : []),
      chatAdvanceRequirements: normalizeChatAdvanceRequirements(candidate.chatAdvanceRequirements, id),
      coachGuidance: normalizePhaseGuidance(
        candidate.coachGuidance,
        id,
        index,
        strongLearnerResponse
      ),
      advanceWhen: cleanText(candidate.advanceWhen, strongLearnerResponse),
      evaluationLinks: (Array.isArray(candidate.evaluationLinks) ? candidate.evaluationLinks : [])
        .map((link) => {
          if (!isPlainObject(link)) return null;
          const objectiveId = cleanText(link.objectiveId);
          const criterionIds = cleanList(link.criterionIds);
          return objectiveId && criterionIds.length ? { objectiveId, criterionIds } : null;
        })
        .filter(Boolean)
    };
  });
}

function fallbackEvaluationLinks(phase, objectives, phaseIndex, phaseCount) {
  return objectives.flatMap((objective) => {
    const matching = objective.criteria.filter((criterion) =>
      criterion.text === phase.strongLearnerResponse
    );
    const assigned = matching.length
      ? matching
      : objective.criteria.filter((_criterion, criterionIndex) =>
          Math.min(criterionIndex, Math.max(0, phaseCount - 1)) === phaseIndex
        );
    return assigned.length ? [{ objectiveId: objective.id, criterionIds: assigned.map((criterion) => criterion.id) }] : [];
  });
}

function normalizePhaseEvaluationLinks(phases, objectives) {
  return phases.map((phase, phaseIndex) => ({
    ...phase,
    evaluationLinks: phase.evaluationLinks.length
      ? phase.evaluationLinks.map((link) => ({
          objectiveId: slugify(link.objectiveId),
          criterionIds: link.criterionIds.map((id) => slugify(id))
        }))
      : fallbackEvaluationLinks(phase, objectives, phaseIndex, phases.length)
  }));
}

function criterionTextsForLink(objectives, link) {
  const objective = objectives.find((item) => item.id === link?.objectiveId);
  if (!objective) return [];
  return objective.criteria
    .filter((criterion) => link.criterionIds.includes(criterion.id))
    .map((criterion) => criterion.text);
}

function phaseExpectedCriteria(objectives, phase) {
  return (phase.evaluationLinks || [])
    .flatMap((link) => criterionTextsForLink(objectives, link));
}

function normalizeStandardText(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  return value.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const hotkey = cleanText(item.hotkey).toLowerCase();
    const template = cleanMultiline(item.template);
    if (!hotkey || !template) return [];
    const id = uniqueStableId(
      usedIds,
      cleanText(item.id),
      `response_${normalizeStableId(hotkey, "standard_text")}`,
    );
    usedIds.add(id);
    return [{
      id,
      hotkey,
      category: cleanText(item.category),
      template,
      notes: cleanList(item.notes)
    }];
  });
}

function normalizeApprovedResponseAssignments(value, standardText, phases) {
  if (!Array.isArray(value)) return [];
  const responsesById = new Map(standardText.map((response) => [response.id, response]));
  const selectedTemplates = standardText.map((response) => response.template);
  const phaseIds = new Set(phases.map((phase) => phase.id));
  const usedIds = new Set();
  const usedResponseIds = new Set();
  return value.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const responseId = cleanText(item.responseId);
    const phaseId = cleanText(item.phaseId);
    const instruction = cleanText(item.instruction);
    const response = responsesById.get(responseId);
    if (
      !response ||
      !phaseIds.has(phaseId) ||
      !instruction ||
      containsAnyCompleteApprovedResponseTemplate(instruction, selectedTemplates)
    ) return [];
    const id = normalizeStableId(
      item.id,
      `assignment_${responseId}_${phaseId}`,
    );
    if (usedIds.has(id) || usedResponseIds.has(responseId)) return [];
    usedIds.add(id);
    usedResponseIds.add(responseId);
    return [{ id, responseId, phaseId, instruction }];
  });
}

export function normalizeStudioDraft(input = {}) {
  const candidate = isPlainObject(input) ? clone(input) : {};
  const defaults = createBaseDraft(candidate.source || candidate);
  const source = normalizeSourceInput(candidate.source || defaults.source);
  const incomingScenario = isPlainObject(candidate.scenario) ? candidate.scenario : {};
  const scenario = {
    ...defaults.scenario,
    ...incomingScenario
  };
  const partner = normalizePartner(
    isPlainObject(candidate.partner)
      ? candidate.partner
      : {
          name: incomingScenario.customerName,
          role: defaults.partner.role,
          mood: incomingScenario.customerEmotion,
          personality: defaults.partner.personality,
          knows: defaults.partner.knows,
          withholds: defaults.partner.withholds,
          behaviorRules: defaults.partner.behaviorRules
        },
    defaults.partner
  );
  const title = cleanText(scenario.title, defaults.scenario.title);
  const baseId = slugify(
    scenario.baseId || candidate.baseId || candidate.draftId || title,
    defaults.scenario.baseId
  );
  const customerName = partner.name;
  const petName = !isGenericPetName(scenario.petName)
    ? cleanText(scenario.petName)
    : source.customerCare
      ? normalizedPetName(scenario.petName, source.material)
      : "";
  const product = cleanText(scenario.product, defaults.scenario.product);
  const defaultCorrect = defaults.handling.correct;
  const incomingHandling = isPlainObject(candidate.handling) ? candidate.handling : {};
  const legacyCorrect = cleanList(incomingHandling.correct, defaultCorrect);
  const avoid = cleanList(
    incomingHandling.avoid,
    Number(candidate.studioVersion) >= STUDIO_DRAFT_VERSION ? [] : defaults.handling.avoid
  );
  const legacyCustomerResponses = cleanList(
    incomingHandling.customerResponses,
    defaults.handling.customerResponses
  );
  const legacyGuidance = normalizeGuidance(
    candidate.guidance?.sections,
    legacyCorrect
  );
  const openingLine = cleanText(
    scenario.openingLine,
    defaults.scenario.openingLine
  );
  const hasRichPhases = Array.isArray(candidate.flow?.phases) && candidate.flow.phases.length > 0;
  let rawPhases = normalizeConversationPhases(
    hasRichPhases ? candidate.flow.phases : [],
    phasesFromLegacyFields({
      correct: legacyCorrect,
      customerResponses: legacyCustomerResponses,
      guidanceSections: legacyGuidance,
      openingLine
    }),
    openingLine
  );
  const cautionsAuthoritative = candidate.flow?.cautionsAuthoritative === true;
  if (!cautionsAuthoritative && avoid.length && rawPhases.length) {
    const existingCautions = new Set(rawPhases.flatMap((phase) =>
      phase.coachGuidance.bullets.flatMap((bullet) =>
        (bullet.children || [])
          .filter((child) => child.kind === "caution")
          .map((child) => child.text)
      )
    ));
    const firstPhase = rawPhases[0];
    if (!firstPhase.coachGuidance.bullets.length) {
      firstPhase.coachGuidance.bullets.push({
        id: `${firstPhase.id}_guidance_1`,
        text: firstPhase.strongLearnerResponse || "Guide the Learner through this phase."
      });
    }
    const firstBullet = firstPhase.coachGuidance.bullets[0];
    firstBullet.children ||= [];
    const childIds = new Set(firstBullet.children.map((child) => child.id));
    avoid.forEach((text, index) => {
      if (existingCautions.has(text)) return;
      let id = `${firstPhase.id}_legacy_caution_${index + 1}`;
      let suffix = 2;
      while (childIds.has(id)) {
        id = `${firstPhase.id}_legacy_caution_${index + 1}_${suffix}`;
        suffix += 1;
      }
      childIds.add(id);
      firstBullet.children.push({ id, text, kind: "caution" });
    });
  }
  const incomingFacts = isPlainObject(candidate.facts) ? candidate.facts : {};
  const facts = {
    ...defaults.facts,
    ...incomingFacts,
    keyQuestion: cleanText(
      incomingFacts.keyQuestion,
      cleanText(scenario.description, source.material)
    ),
    shareOnlyIfAsked: cleanList(
      incomingFacts.shareOnlyIfAsked,
      defaults.facts.shareOnlyIfAsked
    ),
    address: cleanText(incomingFacts.address),
    medication: cleanText(incomingFacts.medication),
    rootCauseBelief: cleanText(
      incomingFacts.rootCauseBelief,
      defaults.facts.rootCauseBelief
    ),
    urgency: cleanText(incomingFacts.urgency, defaults.facts.urgency),
    allowedObjections: cleanList(
      incomingFacts.allowedObjections,
      defaults.facts.allowedObjections
    ),
    closingLine: cleanText(
      incomingFacts.closingLine,
      defaults.facts.closingLine
    ),
    clinic: cleanText(incomingFacts.clinic),
    conditionalFollowUp: cleanText(
      incomingFacts.conditionalFollowUp,
      defaults.facts.conditionalFollowUp
    )
  };
  const incomingEvaluation = isPlainObject(candidate.evaluation)
    ? candidate.evaluation
    : {};
  const evaluationMode = normalizeEvaluationMode(
    incomingEvaluation.mode || defaults.evaluation.mode
  );
  const canonicalAvoid = cleanList(rawPhases.flatMap((phase) =>
    phase.coachGuidance.bullets.flatMap((bullet) =>
      (bullet.children || [])
        .filter((child) => child.kind === "caution")
        .map((child) => child.text)
    )
  ));
  const evaluationCriteria = cleanList(
    incomingEvaluation.criteria,
    [
      ...(hasRichPhases ? rawPhases.map((phase) => phase.strongLearnerResponse) : legacyCorrect),
      ...canonicalAvoid
    ]
  );
  const objectives = normalizeObjectives(
    incomingEvaluation.objectives,
    evaluationCriteria
  );
  const phases = normalizePhaseEvaluationLinks(rawPhases, objectives);
  const closingPartnerTurn = cleanText(
    candidate.flow?.closingPartnerTurn,
    cleanText(
      hasRichPhases && !candidate.flow?.phases?.[0]?.partnerTurn
        ? candidate.flow.phases.at(-1)?.partnerResponse
        : "",
      cleanText(candidate.facts?.closingLine, legacyCustomerResponses.at(-1))
    )
  );
  const projectedCorrect = phases.map((phase) => {
    const strongLearnerResponse = cleanText(phase.strongLearnerResponse);
    if (strongLearnerResponse) return strongLearnerResponse;
    return phaseExpectedCriteria(objectives, phase).join(" ");
  });
  const projectedCustomerResponses = phases.map((phase, index) =>
    phases[index + 1]?.partnerTurn || closingPartnerTurn
  );
  const projectedAvoid = cleanList(
    phases.flatMap((phase) => phase.coachGuidance.bullets.flatMap((bullet) =>
      (bullet.children || [])
        .filter((child) => child.kind === "caution")
        .map((child) => child.text)
    ))
  );
  const sharedGuidance = phases.map((phase) => ({
    title: phase.coachGuidance.title,
    body: phase.coachGuidance.bullets[0]?.text || phase.strongLearnerResponse,
    bullets: phase.coachGuidance.bullets.map(projectGuidanceBulletForRuntime)
  }));
  const incomingVoice = isPlainObject(candidate.voice) ? candidate.voice : {};
  const incomingChat = isPlainObject(candidate.chat) ? candidate.chat : {};
  const selectedVoice = cleanText(
    incomingVoice.selectedVoice ||
      candidate.tuning?.voice?.id ||
      defaults.voice.selectedVoice
  ).toLowerCase();
  const speed = clampNumber(
    incomingVoice.speed ?? candidate.tuning?.voice?.speed,
    0.75,
    1.25,
    1
  );
  const pseudoScenario = {
    channels: ["voice"],
    catalog: {
      customerEmotion: cleanText(
        partner.mood,
        defaults.partner.mood
      )
    },
    facts,
    customer: {
      persona: {
        tone: cleanText(
          partner.mood,
          defaults.partner.mood
        )
      }
    },
    frontend: {
      voice: {
        selectedVoice
      }
    }
  };
  const tuning = normalizeScenarioTuning(pseudoScenario, {
    ...(isPlainObject(candidate.tuning) ? candidate.tuning : {}),
    voice: {
      ...(isPlainObject(candidate.tuning?.voice) ? candidate.tuning.voice : {}),
      id: selectedVoice,
      speed
    }
  });
  const incomingChannelSections = isPlainObject(
    candidate.guidance?.channelSections
  )
    ? candidate.guidance.channelSections
    : {};
  const channelSections = Object.fromEntries(
    ["chat", "voice"]
      .filter((channel) => Array.isArray(incomingChannelSections[channel]))
      .map((channel) => [
        channel,
        normalizeGuidance(incomingChannelSections[channel], projectedCorrect)
      ])
  );
  const standardText = normalizeStandardText(incomingChat.standardText);
  const approvedResponseAssignments = normalizeApprovedResponseAssignments(
    incomingChat.approvedResponseAssignments,
    standardText,
    phases,
  );

  return {
    studioVersion: STUDIO_DRAFT_VERSION,
    draftId: slugify(candidate.draftId || baseId, baseId),
    updatedAt: cleanText(candidate.updatedAt, new Date().toISOString()),
    source: {
      type: cleanText(source.type, defaults.source.type),
      material: cleanMultiline(source.material, defaults.source.material),
      anonymized: source.anonymized === true,
      generalized: source.generalized === true
    },
    sourceGrounding: remapConversationPhaseCitations(
      normalizeSourceGrounding(candidate.sourceGrounding),
      phases,
      phases
    ),
    scenario: {
      baseId,
      title,
      description: stripAuthorFacingChallengePrefix(
        cleanText(scenario.description, source.material)
      ),
      channels: normalizeChannels(scenario.channels),
      teamAudience: cleanText(
        scenario.teamAudience,
        defaults.scenario.teamAudience
      ),
      agentType: cleanText(scenario.agentType, defaults.scenario.agentType),
      difficulty: cleanText(
        scenario.difficulty,
        defaults.scenario.difficulty
      ).toLowerCase(),
      topic: cleanText(scenario.topic, defaults.scenario.topic),
      subtopic: cleanText(scenario.subtopic, defaults.scenario.subtopic),
      primarySkillFocus: cleanText(
        scenario.primarySkillFocus,
        defaults.scenario.primarySkillFocus
      ),
      customerEmotion: cleanText(
        partner.mood,
        defaults.partner.mood
      ),
      customerName,
      petName,
      product,
      openingLine: phases[0]?.partnerTurn || openingLine,
      learnerGoal: cleanText(
        scenario.learnerGoal,
        defaults.scenario.learnerGoal
      )
    },
    partner,
    handling: {
      correct: projectedCorrect,
      avoid: projectedAvoid,
      customerResponses: projectedCustomerResponses
    },
    flow: {
      phases,
      closingPartnerTurn,
      cautionsAuthoritative: true
    },
    facts,
    evaluation: {
      mode: evaluationMode,
      criteria: evaluationCriteria,
      passingScore: Math.round(
        clampNumber(incomingEvaluation.passingScore, 0, 100, 100)
      ),
      objectives,
      ...(isPlainObject(incomingEvaluation.approval)
        ? { approval: clone(incomingEvaluation.approval) }
        : {}),
      ...(Array.isArray(incomingEvaluation.qualityChecklist)
        ? { qualityChecklist: clone(incomingEvaluation.qualityChecklist) }
        : {}),
      ...(Array.isArray(incomingEvaluation.behaviorRubric)
        ? { behaviorRubric: clone(incomingEvaluation.behaviorRubric) }
        : {})
    },
    voice: {
      selectedVoice: tuning.voice.id,
      speed: tuning.voice.speed,
      customerStarts:
        incomingVoice.customerStarts === undefined
          ? true
          : Boolean(incomingVoice.customerStarts),
      openingLine: cleanText(
        phases[0]?.partnerTurn,
        cleanText(incomingVoice.openingLine || incomingScenario.openingLines?.voice, openingLine)
      ),
      pacing: cleanText(incomingVoice.pacing, defaults.voice.pacing)
    },
    chat: {
      hotkeyProfile: cleanText(
        incomingChat.hotkeyProfile,
        defaults.chat.hotkeyProfile
      ).toLowerCase(),
      customerStarts:
        incomingChat.customerStarts === undefined
          ? true
          : Boolean(incomingChat.customerStarts),
      openingLine: cleanText(
        phases[0]?.partnerTurn,
        cleanText(incomingChat.openingLine || incomingScenario.openingLines?.chat, openingLine)
      ),
      standardText,
      approvedResponseAssignments
    },
    guidance: {
      sections: sharedGuidance,
      ...(Object.keys(channelSections).length ? { channelSections } : {})
    },
    coverage: clone(Array.isArray(candidate.coverage) ? candidate.coverage : []),
    readiness: normalizeReadiness(candidate.readiness),
    tuning
  };
}

export function createDefaultStudioDraft(source = {}) {
  return normalizeStudioDraft(createBaseDraft(source));
}

function nestGeneratedCautionGuidance(items = []) {
  const bullets = [];
  for (const item of Array.isArray(items) ? items : []) {
    const bullet = clone(item);
    const caution = /^(?:avoid|do not|don't|never)\b/iu.test(cleanText(bullet?.text));
    if (!caution || !bullets.length) {
      bullets.push(bullet);
      continue;
    }
    const parent = bullets.at(-1);
    parent.children = [
      ...(Array.isArray(parent.children) ? parent.children : []),
      {
        id: bullet.id,
        text: bullet.text,
        kind: "caution"
      },
      ...(Array.isArray(bullet.children) ? bullet.children : [])
    ];
  }
  return bullets;
}

export function createStudioDraftFromGeneration(generated, creatorInput = {}, options = {}) {
  const generation = isPlainObject(generated) ? clone(generated) : {};
  const conversation = isPlainObject(generation.conversation) ? generation.conversation : {};
  const partner = isPlainObject(generation.partner) ? generation.partner : {};
  const phases = Array.isArray(generation.phases) ? generation.phases : [];
  const objectives = Array.isArray(generation.objectives) ? generation.objectives : [];
  const conversationAbout = cleanMultiline(creatorInput.conversationAbout);
  const learnerApproach = cleanMultiline(creatorInput.learnerApproach);
  if (!conversationAbout || !learnerApproach) {
    throw new Error("Answer both questions before building the draft.");
  }
  const material = [
    `What the conversation is about:\n${conversationAbout}`,
    `How the Learner should handle the conversation:\n${learnerApproach}`
  ].join("\n\n");
  const base = createBaseDraft({
    type: "rough_idea",
    material,
    channels: ["chat", "voice"],
    evaluationMode: "focused_learning_objectives"
  });
  const familySuffix = /^[a-f0-9]{8}$/u.test(String(options.familySuffix || ""))
    ? String(options.familySuffix)
    : crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
  const familyTitle = slugify(conversation.title, "conversation").slice(0, 118).replace(/_+$/u, "");
  const familyId = `${familyTitle}_${familySuffix}`;
  return normalizeStudioDraft({
    ...base,
    studioVersion: STUDIO_DRAFT_VERSION,
    draftId: familyId,
    coverage: clone(Array.isArray(generation.coverage) ? generation.coverage : []),
    source: { type: "rough_idea", material, anonymized: true },
    scenario: {
      ...base.scenario,
      baseId: familyId,
      title: conversation.title,
      description: conversation.description,
      channels: ["chat", "voice"],
      teamAudience: conversation.teamAudience,
      difficulty: "beginner",
      topic: conversation.topic,
      subtopic: conversation.subtopic,
      primarySkillFocus: objectives[0]?.label,
      customerEmotion: partner.mood,
      openingLine: partner.openingLine,
      learnerGoal: objectives.map((objective) => objective.description).filter(Boolean).join(" ")
    },
    partner: {
      ...base.partner,
      name: partner.name,
      role: partner.role,
      mood: partner.mood,
      behaviorRules: partner.behaviorRules
    },
    flow: {
      cautionsAuthoritative: true,
      phases: phases.map((phase) => ({
        id: phase.id,
        title: phase.title,
        purpose: phase.strongLearnerResponse,
        partnerTurn: phase.partnerTurn,
        strongLearnerResponse: phase.strongLearnerResponse,
        coachGuidance: {
          title: phase.title,
          bullets: nestGeneratedCautionGuidance(phase.guidance)
        },
        advanceWhen: phase.strongLearnerResponse,
        evaluationLinks: phase.evaluationLinks
      })),
      closingPartnerTurn: partner.closingLine
    },
    facts: {
      ...base.facts,
      keyQuestion: conversation.description,
      closingLine: partner.closingLine
    },
    evaluation: {
      mode: "focused_learning_objectives",
      criteria: objectives.flatMap((objective) =>
        Array.isArray(objective.criteria)
          ? objective.criteria.map((criterion) => criterion?.text).filter(Boolean)
          : []
      ),
      passingScore: 100,
      objectives
    },
    sourceGrounding: emptySourceGrounding()
  });
}

export const createStudioDraft = createDefaultStudioDraft;

function buildBehaviorDefinitions(draft) {
  const { customerName, petName, product } = draft.scenario;
  const request = supportSubject(product);
  const pet = normalizedPetName(petName, draft.source?.material);
  const customer = customerReference(customerName);
  const possessive = customerPossessive(customerName);
  const address = isGenericCustomerName(customerName)
    ? ""
    : `${customerName}, `;
  return {
    issue_understanding: {
      definition: `identifies why ${customer} needs help with the ${request} and confirms the complete need`,
      observed: `Accurately restates ${possessive} ${request} and confirms the relevant customer details before moving forward.`,
      missed: `Moves ahead without confirming what ${customer} needs from Chewy about the ${request}.`,
      some: `Recognizes the main ${request} but leaves one relevant detail or confirmation incomplete.`,
      great: `Clearly confirms the complete ${request}, its impact on ${customer}, and the desired outcome before taking action.`,
      ideal: `${address}I understand you need help with the ${request}, and I want to make sure I have the complete request before we move forward.`,
      missedExample: `Let me check the account.`
    },
    emotional_acknowledgement: {
      definition: `recognizes how the ${request} affects ${customer}`,
      observed: `Acknowledges ${possessive} concern about the ${request} in a timely way before giving Chewy process details.`,
      missed: `Ignores ${possessive} concern about the ${request} and responds only with transactional information.`,
      some: `Offers a brief acknowledgment, but the wording is only partly connected to ${possessive} ${request}.`,
      great: `Names the specific ${request} concern and responds with timely reassurance that fits ${possessive} emotional context.`,
      ideal: `${address}I understand why the ${request} is concerning, and I will work through the approved Chewy next step with you.`,
      missedExample: `What account detail do you have for this ${request}?`
    },
    problem_ownership: {
      definition: `takes responsibility for moving ${possessive} ${request} toward an approved next step`,
      observed: `Explains what will be checked for the ${request}, narrates the next approved action, and closes the loop with ${customer}.`,
      missed: `Passes responsibility back to ${customer} or leaves the ${request} without a clear owner or next step.`,
      some: `Completes an appropriate action for the ${request} but uses limited ownership language or does not fully close the loop.`,
      great: `Uses clear ownership language, explains each approved ${request} action, and confirms the final next step with ${customer}.`,
      ideal: `${address}I will review the ${request} details with you and make sure the Chewy next step is clear before we finish.`,
      missedExample: `You will have to figure out the next step for this ${request} yourself.`
    },
    personalization: {
      definition: `uses the available customer, pet, and ${request} context naturally`,
      observed: `Uses the available customer, pet, and request context to tailor more than one part of the Chewy response.`,
      missed: `Handles the request as a generic transaction without using the available customer or pet context.`,
      some: `Uses one available personal detail once, but the rest of the ${request} response remains mostly generic.`,
      great: `Naturally connects the available customer, pet, and ${request} context across multiple appropriate moments.`,
      ideal: `${address}I will work through the ${request} with you so the next step for ${pet} is clear.`,
      missedExample: `Customer, the ${request} is being reviewed.`
    },
    expectation_setting: {
      definition: `sets a clear and supportable expectation for ${possessive} ${request}`,
      observed: `Explains the approved ${request} timing or next step, what ${customer} should expect, and what to do if the outcome changes.`,
      missed: `Gives ${customer} no usable ${request} expectation or makes an unsupported promise.`,
      some: `Provides a correct ${request} timeline or action but omits ownership, a condition, or the expected outcome.`,
      great: `Provides a complete ${request} expectation with timing or rationale, ownership, conditions, and the expected outcome.`,
      ideal: `${address}Here is what will happen next with the ${request}, when to expect it, and how Chewy will help if that expectation is not met.`,
      missedExample: `The ${request} will definitely be fixed today.`
    },
    pet_engagement: {
      definition: `connects the Chewy support to ${pet}'s needs in an authentic way`,
      observed: `Uses the available pet context and meaningfully connects the ${request} to the pet's well-being or routine.`,
      missed: `Ignores the available pet context and treats the request only as a generic transaction.`,
      some: `Mentions ${pet} once without connecting the pet to why the ${request} matters.`,
      great: `Uses ${pet}'s context naturally and connects the Chewy support to the pet's needs at an appropriate moment.`,
      ideal: `I want to help make sure the Chewy next step for the ${request} supports ${pet}, so let us review the relevant details together.`,
      missedExample: `Your item is connected to this request.`
    },
    communication_style: {
      definition: `keeps the conversation clear, respectful, concise, and easy for ${customer} to follow`,
      observed: `Uses organized explanations, professional customer-facing language, and a calm tone throughout the interaction.`,
      missed: `Uses confusing internal jargon, dismissive wording, or a ${request} explanation that is difficult for ${customer} to follow.`,
      some: `Remains professional and understandable, but one ${request} explanation is wordy, uneven, or less customer-friendly.`,
      great: `Communicates every approved ${request} step with consistently calm, concise, and respectful customer-facing language.`,
      ideal: `${address}I will explain what I found about the ${request}, then walk through the approved Chewy next step in plain language.`,
      missedExample: `The backend disposition means the ${request} is in an exception state.`
    }
  };
}

function buildBehaviorRubric(draft) {
  const definitions = buildBehaviorDefinitions(draft);
  return OFFICIAL_BEHAVIOR_IDS.map((id) => {
    const item = definitions[id];
    return {
      behavior_name: id,
      has_opportunity: true,
      scenario_definition: `In this Chewy customer-support practice, the learner ${item.definition}.`,
      opportunity_guidance: `The ${draft.scenario.title} conversation gives the learner a clear customer opportunity to ${item.definition}.`,
      observed_criteria: [item.observed],
      missed_criteria: [item.missed],
      to_some_extent_guidance: item.some,
      to_great_extent_guidance: item.great,
      missed_opportunity_guidance: item.missed,
      coaching_tip: `Coach the learner to demonstrate ${BEHAVIOR_LABELS[id]} while resolving ${customerPossessive(draft.scenario.customerName)} ${supportSubject(draft.scenario.product)}.`,
      ideal_agent_example: item.ideal,
      missed_opportunity_example: item.missedExample,
      evaluator_notes: `Evaluate only observable learner behavior in the customer transcript against these ${BEHAVIOR_LABELS[id]} criteria.`
    };
  });
}

function buildQualityChecklist(rubric) {
  return rubric.map((item) => ({
    category: BEHAVIOR_LABELS[item.behavior_name],
    behaviors: clone(item.observed_criteria)
  }));
}

function openingLineForChannel(draft, channel) {
  return cleanText(
    draft?.[channel]?.openingLine,
    draft.scenario.openingLine
  );
}

function guidanceForChannel(draft, channel) {
  const channelSections = draft.guidance?.channelSections?.[channel];
  return Array.isArray(channelSections) && channelSections.length
    ? channelSections
    : draft.guidance.sections;
}

const CHAT_MATCH_STOP_WORDS = new Set([
  "about",
  "accurately",
  "action",
  "after",
  "agent",
  "approved",
  "before",
  "chewy",
  "complete",
  "customer",
  "discussing",
  "explain",
  "handling",
  "learner",
  "provide",
  "relevant",
  "resolution",
  "response",
  "should",
  "state",
  "support",
  "their",
  "there",
  "these",
  "using",
  "what",
  "which",
  "while",
  "would"
]);

const CHAT_MATCH_INTENT_HINTS = [
  {
    pattern: /\b(acknowledge|apolog|concern|empath|frustrat|sorry|understand)\b/i,
    phrases: ["sorry", "understand", "concern", "empath", "frustrat"]
  },
  {
    pattern: /\b(ask|check|confirm|discover|clarif|status|tracking|verify)\b/i,
    phrases: ["already checked", "have you checked", "did you check", "tracking", "status", "confirm", "verify"]
  },
  {
    pattern: /\b(identify|reason|recap|state|summar)\b/i,
    phrases: ["reason for contact", "the issue is", "marked delivered", "says delivered", "cannot find", "can't find", "missing"]
  }
];

function buildChatMatchPhrases(step) {
  const source = cleanText(step);
  const phrases = [];
  CHAT_MATCH_INTENT_HINTS.forEach((hint) => {
    if (hint.pattern.test(source)) phrases.push(...hint.phrases);
  });
  const contentWords = source
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !CHAT_MATCH_STOP_WORDS.has(word));
  phrases.push(...contentWords);
  return [...new Set(phrases.map((phrase) => cleanText(phrase).toLowerCase()).filter(Boolean))].slice(0, 24);
}

function buildGroupedChatMatch(requirements, fallbackStep) {
  const all = normalizeChatAdvanceRequirements(requirements, "phase")
    .map((requirement) => ({ op: "contains_any", phrases: requirement.phrases }));
  return all.length
    ? { all, any: [] }
    : { all: [], any: [{ op: "contains_any", phrases: buildChatMatchPhrases(fallbackStep) }] };
}

function buildProgression(draft, channel) {
  return draft.handling.correct.map((step, index) => {
    const customerResponse =
      draft.handling.customerResponses[index] ||
      (index === draft.handling.correct.length - 1
        ? draft.facts.closingLine
        : "Thank you. What should I expect next?");
    if (channel === "chat") {
      return {
        id: index,
        label: `Handling step ${index + 1}`,
        match: buildGroupedChatMatch(draft.flow?.phases?.[index]?.chatAdvanceRequirements, step),
        customerResponse,
        scenarioPathHint: `chatConfig.stepProgression[${index}]`
      };
    }
    return {
      id: index,
      label: `Handling step ${index + 1}`,
      trigger: `Use after the learner completes this approved customer-support action: ${step}`,
      customerResponse
    };
  });
}

function strongLearnerResponseForPhase(draft, index) {
  return cleanText(
    draft.flow?.phases?.[index]?.strongLearnerResponse,
    draft.handling.correct[index]
  );
}

function buildApprovedTranscript(draft, channel) {
  const transcript = [
    {
      guidance: "Customer opening line.",
      idealAgentResponse: strongLearnerResponseForPhase(draft, 0),
      customer: openingLineForChannel(draft, channel)
    }
  ];
  draft.handling.correct.forEach((step, index) => {
    transcript.push({
      guidance: `Customer response after approved handling step ${index + 1}.`,
      idealAgentResponse:
        strongLearnerResponseForPhase(draft, index + 1) ||
        "Confirm the customer understands the approved Chewy next step and close warmly.",
      customer:
        draft.handling.customerResponses[index] ||
        (index === draft.handling.correct.length - 1
          ? draft.facts.closingLine
          : "Thank you. What should I expect next?")
    });
  });
  return transcript;
}

function approvedResponseInstructionsForPhase(draft, phaseId) {
  const assignments = Array.isArray(draft.chat?.approvedResponseAssignments)
    ? draft.chat.approvedResponseAssignments
    : [];
  return (Array.isArray(draft.chat?.standardText) ? draft.chat.standardText : [])
    .flatMap((response) => assignments
      .filter((assignment) =>
        assignment.responseId === response.id && assignment.phaseId === phaseId
      )
      .map((assignment) => assignment.instruction));
}

function buildGuideSections(draft, channel) {
  const sections = guidanceForChannel(draft, channel);
  return sections.map((section, index) => {
    const bullets = clone(Array.isArray(section.bullets) ? section.bullets : []);
    if (channel === "chat") {
      const phaseId = draft.flow?.phases?.[index]?.id;
      const existing = new Set((bullets || []).map((bullet) =>
        cleanText(isPlainObject(bullet) ? bullet.text || bullet.body : bullet).toLowerCase()
      ));
      approvedResponseInstructionsForPhase(draft, phaseId).forEach((instruction) => {
        const duplicateKey = cleanText(instruction).toLowerCase();
        if (!duplicateKey || existing.has(duplicateKey)) return;
        existing.add(duplicateKey);
        bullets.push(instruction);
      });
    }
    return {
      pauseAfter: index < sections.length - 1,
      sourceLabel: `Source: Conversation Builder step ${index + 1}`,
      channel,
      source: "manager_coaching_reminder",
      title: section.title,
      body: section.body,
      bullets
    };
  });
}

function buildEvaluationCriteria(draft) {
  if (draft.evaluation.mode === "focused_learning_objectives") {
    return draft.evaluation.objectives.flatMap((objective) => criterionTexts(objective.criteria));
  }
  return clone(draft.evaluation.criteria);
}

function buildCoaching(draft) {
  if (draft.evaluation.mode === "focused_learning_objectives") {
    return {
      summaryGuidance:
        "Evaluate only the authored learning-objective criteria that are observable in the customer conversation.",
      gradingModel: {
        mode: "focused_learning_objectives",
        evaluationMethod: "criteria_checklist",
        scoreAggregation: "average_objectives",
        passingScore: draft.evaluation.passingScore,
        objectives: draft.evaluation.objectives.map((objective) => ({
          ...clone(objective),
          criteria: criterionTexts(objective.criteria)
        }))
      }
    };
  }

  const importedRubric = Array.isArray(draft.evaluation.behaviorRubric)
    ? clone(draft.evaluation.behaviorRubric)
    : null;
  const completeImportedRubric =
    importedRubric &&
    OFFICIAL_BEHAVIOR_IDS.every((id) =>
      importedRubric.some(
        (item) => cleanText(item?.behavior_name || item?.category) === id
      )
    );
  const behaviorRubric = completeImportedRubric
    ? importedRubric
    : buildBehaviorRubric(draft);
  const qualityChecklist = Array.isArray(draft.evaluation.qualityChecklist)
    ? clone(draft.evaluation.qualityChecklist)
    : buildQualityChecklist(behaviorRubric);

  return {
    summaryGuidance:
      "Evaluate observable learner behavior in this customer conversation against all seven approved Customer Care behavior criteria.",
    qualityChecklist,
    behaviorRubric,
    gradingModel: {
      mode: "customer_care_behaviors"
    }
  };
}

function learnerBriefingAbout(draft, channel) {
  return draft.scenario.description.replace(
    /\b(?:chat\s+or\s+voice|voice\s+or\s+chat)\b/gi,
    channel
  );
}

function buildFrontend(draft, channel) {
  const customerCare = draft.scenario.teamAudience === "Customer Care";
  const partnerName = draft.partner.name;
  const evaluationFocus =
    draft.evaluation.mode === "focused_learning_objectives"
      ? draft.evaluation.objectives.map(
          (objective) => `${objective.label}: ${objective.description}`
        )
      : OFFICIAL_BEHAVIOR_IDS.map(
          (id) => `${BEHAVIOR_LABELS[id]}: Review the approved conversation-specific criteria.`
        );
  const frontend = {
    shared: {
      introInstructions: [
        `Review the conversation briefing, then respond to the ${customerCare ? "customer" : "Conversation Partner"} as you would in a real interaction.`,
        `Use Coach Chewy guidance without reading it aloud to the ${customerCare ? "customer" : "Conversation Partner"}.`,
        "End the experience to receive feedback."
      ],
      learnerBriefing: {
        about: learnerBriefingAbout(draft, channel),
        objectives: [
          ...draft.handling.correct,
          ...draft.handling.avoid.map((item) => `Avoid: ${item}`)
        ],
        evaluationFocus,
        goals: clone(draft.handling.correct)
      }
    }
  };
  const guideSections = buildGuideSections(draft, channel);

  if (channel === "chat") {
    const customerStarts = draft.chat.customerStarts !== false;
    frontend.chat = {
      customerStarts,
      initialTranscript: [
        {
          role: customerStarts ? "assistant" : "system",
          label: partnerName,
          scenarioPathHint: "frontend.chat.initialTranscript[0]",
          content: openingLineForChannel(draft, "chat"),
          meta: partnerName
        }
      ],
      guideTitle: "Coach Chewy Guidance",
      guideSections,
      standardText: clone(draft.chat.standardText),
      hotkeyProfile: draft.chat.hotkeyProfile
    };
  } else {
    frontend.voice = {
      customerStarts: draft.voice.customerStarts,
      customerDisplayName: partnerName,
      guideTitle: "Coach Chewy Guidance",
      guideTopNote:
        "Use the approved guidance to stay aligned with the conversation flow.",
      pacing: draft.voice.pacing,
      selectedVoice: draft.voice.selectedVoice,
      guideSections,
      verbalGuidance:
        "Use a natural delivery and wait for each completed learner response.",
      endNote:
        "After the Conversation Partner acknowledges the next step, end the experience to receive feedback.",
      spokenTone: draft.partner.mood
    };
  }
  return frontend;
}

function buildScenario(draft, channel) {
  const id = `${draft.scenario.baseId}_${channel}`;
  const chatProgression = channel === "chat" ? buildProgression(draft, "chat") : [];
  const voiceProgression = channel === "voice" ? buildProgression(draft, "voice") : [];
  const product = draft.scenario.product;
  const petName = draft.scenario.petName;
  const request = supportSubject(product);
  const customerCare = draft.scenario.teamAudience === "Customer Care";
  const partner = draft.partner;
  const authoringGrounding = publishableSourceGrounding(draft.sourceGrounding);
  const genericCustomer = isGenericCustomerName(partner.name);
  const customerSubject = genericCustomer
    ? "The customer"
    : partner.name;
  const customerRole = customerCare
    ? genericCustomer
      ? "Chewy Customer"
      : `${partner.name}, Chewy Customer`
    : partner.role;
  const scenario = {
    id,
    version: "1.0.0",
    status: "published",
    updatedAt: draft.updatedAt,
    channels: [channel],
    label: draft.scenario.title,
    title: draft.scenario.title,
    source: {
      type: draft.source.type,
      anonymized: draft.source.anonymized === true,
      generalized: draft.source.generalized === true
    },
    ...(authoringGrounding
      ? { authoringGrounding }
      : {}),
    owner: {
      name: "",
      team: "",
      email: ""
    },
    catalog: {
      scenarioType:
        draft.evaluation.mode === "focused_learning_objectives"
          ? "Learning Objective Evaluation"
          : "Full Conversation Evaluation",
      agentType: draft.scenario.agentType,
      primarySkillFocus: draft.scenario.primarySkillFocus,
      groupId: draft.scenario.baseId,
      description: draft.scenario.description,
      skillFocus: draft.scenario.primarySkillFocus,
      title: draft.scenario.title,
      practiceDescription: `Practice ${draft.scenario.primarySkillFocus.toLowerCase()} in a ${draft.scenario.topic.toLowerCase()} conversation.`,
      tags: [
        slugify(draft.scenario.primarySkillFocus),
        slugify(draft.scenario.topic),
        customerCare ? "customer_care" : "general_conversation",
        slugify(draft.scenario.agentType),
        channel,
        "manager_generated",
        "dynamic_customer_responder"
      ],
      teamAudience: draft.scenario.teamAudience,
      difficulty: draft.scenario.difficulty,
      skillId: slugify(draft.scenario.primarySkillFocus),
      qualityBehavior: draft.scenario.primarySkillFocus,
      domain: customerCare ? "customer_support" : "training",
      topic: draft.scenario.topic,
      customerEmotion: partner.mood,
      trainingTopic: customerCare ? "Customer Care" : draft.scenario.topic,
      subtopic: draft.scenario.subtopic,
      label: draft.scenario.title,
      searchDescription: draft.scenario.description,
      estimatedDurationMinutes: Math.max(4, Math.min(15, draft.handling.correct.length * 2))
    },
    simulation: {
      sourceTranscriptMetadata: {
        scenarioType:
          draft.evaluation.mode === "focused_learning_objectives"
            ? "Learning Objective Evaluation"
            : "Full Conversation Evaluation",
        sourceType: draft.source.type,
        qualityBehavior: draft.scenario.primarySkillFocus,
        topic: draft.scenario.topic,
        selectedChannels: [channel],
        customerEmotion: partner.mood,
        subtopic: draft.scenario.subtopic,
        sourceMaterial: [
          `Conversation situation: ${draft.scenario.description}`,
          `Correct learner process: ${draft.handling.correct.join(" ")}`,
          `Conversation Flow cautions: ${draft.handling.avoid.join(" ")}`
        ].join("\n")
      },
      managerOnlyIdealResponses: draft.handling.correct.map((step, index) => ({
        beat: index + 1,
        guidance: `Approved handling step ${index + 1}`,
        idealAgentResponse: strongLearnerResponseForPhase(draft, index)
      })),
      approvedTranscript: buildApprovedTranscript(draft, channel),
      stateModel: {
        chatStepProgression: chatProgression,
        voiceStepProgression: voiceProgression,
        behaviorTriggers: []
      }
    },
    evaluationCriteria: buildEvaluationCriteria(draft),
    runtime: {
      replyMode: "dynamic_customer_responder"
    },
    facts: {
      ...clone(draft.facts),
      customerName: partner.name,
      petName,
      medicationOrProduct: product
    },
    coaching: buildCoaching(draft),
    learnerGoal: draft.scenario.learnerGoal,
    conversationBetween: {
      aiPersonality:
        customerCare
          ? `${customerSubject} is a ${partner.mood.toLowerCase()} Chewy customer seeking help with a ${request}${petContext(petName)}. Remain only in the customer role, use approved facts, and wait after each customer response.`
          : `${partner.personality} Remain only in the ${partner.role} role, use authored information, and wait after each response.`,
      aiRole: customerRole,
      aiStart: openingLineForChannel(draft, channel),
      participantRole: "Learner"
    },
    frontend: buildFrontend(draft, channel),
    customer: {
      opening: {
        voice: channel === "voice" ? openingLineForChannel(draft, "voice") : "",
        chat: channel === "chat" ? openingLineForChannel(draft, "chat") : ""
      },
      persona: {
        name: partner.name,
        tone: partner.mood,
        goal: customerCare
          ? `Receive accurate help with the ${request} and understand the approved next step.`
          : "Respond authentically and reach the authored conversation outcome."
      },
      behavior: {
        rules: [
          ...partner.behaviorRules,
          customerCare
            ? genericCustomer
              ? "Remain in the Chewy customer role for every response and never act as the learner."
              : `Remain ${partner.name}, the customer, for every response and never act as the learner.`
            : `Remain in the ${partner.role} role for every response and never act as the learner.`,
          customerCare
            ? "Reveal only approved scenario facts and never invent account actions, policy, or a resolution."
            : "Reveal only authored conversation information and never invent facts or outcomes.",
          "After each response, stop and wait for the learner's next completed turn."
        ],
        conditionalFollowUps: cleanList(draft.facts.conditionalFollowUp),
        allowedObjections: clone(draft.facts.allowedObjections),
        softeningRule:
          customerCare
            ? "Become more cooperative after the learner acknowledges the concern and explains an approved Chewy next step."
            : "Respond naturally as the learner demonstrates the expected behaviors.",
        closingRule: `Use the approved closing line once: ${draft.facts.closingLine}`
      }
    },
    managerPreview: {
      testRevision: "",
      latestSuggestion:
        "Generated by Conversation Builder from the current reviewed draft.",
      updatedAt: draft.updatedAt
    }
  };

  if (channel === "chat") {
    scenario.chatConfig = {
      hotkeyProfile: draft.chat.hotkeyProfile,
      stepProgression: clone(chatProgression)
    };
  }

  const tuningOverride = {
    ...clone(draft.tuning),
    ...(channel === "voice"
      ? {
          voice: {
            id: draft.voice.selectedVoice,
            speed: draft.voice.speed
          }
        }
      : {})
  };
  return applyTuningToScenario(scenario, tuningOverride);
}

export function projectLegacyConversationFields(input = {}) {
  return normalizeStudioDraft(input);
}

export function composeStudioScenarios(input) {
  const draft = projectLegacyConversationFields(input);
  const scenarios = draft.scenario.channels.map((channel) =>
    buildScenario(draft, channel)
  );
  return {
    draft,
    scenarios,
    chatScenario: scenarios.find((scenario) => scenario.channels[0] === "chat") || null,
    voiceScenario: scenarios.find((scenario) => scenario.channels[0] === "voice") || null
  };
}

export function composeStudioScenariosFromFactoryDraft(
  factoryDraft,
  channels = ["chat", "voice"]
) {
  if (!isPlainObject(factoryDraft)) {
    throw new TypeError("factoryDraft must be one object.");
  }

  const customerName = cleanText(factoryDraft.customerName, "Chewy customer");
  const petName = normalizedPetName(
    factoryDraft.petName,
    factoryDraft.sourceMaterial || factoryDraft.title || factoryDraft.product,
  );
  const product = cleanText(factoryDraft.product, "Chewy order");
  const archetype = isPlainObject(factoryDraft.archetype)
    ? factoryDraft.archetype
    : {};
  const archetypeLabel = cleanText(archetype.label, "Order Support");
  const topic = cleanText(archetype.topic, archetypeLabel);
  const baseId = slugify(
    factoryDraft.baseId || factoryDraft.title,
    "factory_customer_support"
  );
  const title = cleanText(factoryDraft.title, titleCase(baseId));
  const verificationDetail = cleanText(
    factoryDraft.verificationDetail,
    "the relevant customer or order details"
  );
  const closeLine = cleanText(
    factoryDraft.closeLine,
    `Thank you for helping me with ${petName} and the order.`
  );
  const correct = cleanList(
    [
      factoryDraft.verifyAction,
      factoryDraft.explainAction,
      factoryDraft.resolutionAction,
      factoryDraft.expectationAction,
      factoryDraft.recapAction
    ],
    defaultCorrectHandling(customerName, product)
  );
  const avoid = cleanList(
    factoryDraft.forbidden,
    defaultAvoidHandling()
  );
  const learnerGoal = cleanText(
    factoryDraft.learnerGoal,
    `Practice helping ${customerName} with ${product} by completing the approved ${archetypeLabel.toLowerCase()} path and setting a clear Chewy expectation.`
  );
  const sourceMaterial = cleanMultiline(
    factoryDraft.sourceMaterial,
    `${customerName} needs help from Chewy with ${product}.`
  );
  const customerResponses = correct.map((_, index) => {
    if (index === 0) return `The relevant detail is ${verificationDetail}.`;
    if (index === correct.length - 1) return closeLine;
    if (index === correct.length - 2) {
      return "Thank you. What should I expect next with the order?";
    }
    return "Thank you. That explanation helps me understand the order.";
  });
  const guideTitles = [
    "1. Verify Before Explaining",
    "2. Explain the Order",
    "3. Use the Approved Resolution",
    "4. Set Expectations",
    "5. Recap and Close"
  ];

  const draft = normalizeStudioDraft({
    draftId: baseId,
    source: {
      type: "factory_brief",
      material: sourceMaterial
    },
    scenario: {
      baseId,
      title,
      description: sourceMaterial,
      channels,
      teamAudience: "Customer Care",
      agentType: "Core",
      difficulty: "intermediate",
      topic,
      subtopic: archetypeLabel,
      primarySkillFocus: archetypeLabel,
      customerEmotion: cleanText(factoryDraft.emotion, "Concerned"),
      customerName,
      petName,
      product,
      openingLine: cleanText(
        factoryDraft.openingLine,
        `Hi, this is ${customerName}. I need help with ${product}.`
      ),
      learnerGoal
    },
    handling: {
      correct,
      avoid,
      customerResponses
    },
    facts: {
      keyQuestion: `What should Chewy do to help ${customerName} with ${product}?`,
      shareOnlyIfAsked: [verificationDetail],
      address: cleanText(factoryDraft.address || verificationDetail),
      medication: "",
      rootCauseBelief: `${customerName} believes Chewy should resolve the concern involving ${product}.`,
      urgency: `${customerName} needs clear help from Chewy with ${product}.`,
      allowedObjections: avoid,
      closingLine: closeLine,
      clinic: "",
      conditionalFollowUp: cleanText(
        factoryDraft.expectationAction,
        "Explain the approved Chewy order follow-up expectation."
      )
    },
    evaluation: {
      mode: "customer_care_behaviors",
      criteria: [
        ...correct,
        ...avoid.map((item) => `Avoid: ${item}`)
      ]
    },
    guidance: {
      sections: correct.map((step, index) => ({
        title: guideTitles[index] || `${index + 1}. Approved Handling`,
        body: step,
        bullets: [step]
      }))
    }
  });

  return composeStudioScenarios(draft);
}

function parsePayload(payload) {
  if (typeof payload !== "string") return clone(payload);
  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error(`Imported content is not valid JSON: ${error.message}`);
  }
}

function explicitImportedChannel(scenario) {
  const channels = Array.isArray(scenario?.channels)
    ? scenario.channels.map((channel) => cleanText(channel).toLowerCase())
    : [];
  return channels.length === 1 && ["chat", "voice"].includes(channels[0])
    ? channels[0]
    : "";
}

function validateImportedScenarioSet(scenarios) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Import did not contain a conversation.");
  }
  if (scenarios.length > 2) {
    throw new Error("Import one conversation or one Chat and Voice sibling pair.");
  }

  const channels = scenarios.map(explicitImportedChannel);
  if (channels.some((channel) => !channel)) {
    throw new Error("Each imported conversation must contain exactly one Chat or Voice channel.");
  }
  if (new Set(channels).size !== channels.length) {
    throw new Error("A two-file import must contain one Chat and one Voice conversation.");
  }

  if (scenarios.length === 2) {
    const groupIds = scenarios.map((scenario) =>
      cleanText(scenario.catalog?.groupId)
    );
    const baseIds = scenarios.map((scenario, index) =>
      String(scenario.id || "")
        .trim()
        .toLowerCase()
        .replace(new RegExp(`_${channels[index]}$`, "u"), "")
    );
    const sharedBaseId = baseIds[0];
    const sharedGroupId = groupIds[0];
    const legacyCustomerCareGroupMatches = scenarios.every((scenario) =>
      sharedGroupId === `${sharedBaseId}_customer_care_${slugify(scenario.catalog?.agentType)}`
    );
    if (
      groupIds.some((groupId) => !groupId) ||
      new Set(groupIds).size !== 1 ||
      baseIds.some((baseId) => !baseId) ||
      new Set(baseIds).size !== 1 ||
      (sharedGroupId !== sharedBaseId && !legacyCustomerCareGroupMatches)
    ) {
      throw new Error(
        "Chat and Voice imports must be sibling conversations with matching ID bases and catalog.groupId."
      );
    }
  }

  return scenarios;
}

function extractImportedScenarios(payload) {
  const parsed = parsePayload(payload);
  if (isPlainObject(parsed) && parsed.studioVersion && parsed.scenario) {
    return { draft: normalizeStudioDraft(parsed), scenarios: [] };
  }
  if (
    isPlainObject(parsed) &&
    (isPlainObject(parsed.chatScenario) || isPlainObject(parsed.voiceScenario))
  ) {
    return {
      scenarios: validateImportedScenarioSet(
        [parsed.chatScenario, parsed.voiceScenario].filter(isPlainObject)
      )
    };
  }
  if (Array.isArray(parsed)) {
    const scenarios = parsed.filter(isPlainObject);
    if (scenarios.length) {
      return { scenarios: validateImportedScenarioSet(scenarios) };
    }
  }
  if (isPlainObject(parsed) && Array.isArray(parsed.scenarios)) {
    const scenarios = parsed.scenarios.filter(isPlainObject);
    if (scenarios.length) {
      return { scenarios: validateImportedScenarioSet(scenarios) };
    }
  }
  const platformScenario =
    parsed?.scenarioJson ||
    parsed?.simulation?.scenarioJson ||
    parsed?.draft?.simulation?.scenarioJson;
  if (isPlainObject(platformScenario)) {
    return { scenarios: validateImportedScenarioSet([platformScenario]) };
  }
  if (isPlainObject(parsed) && (parsed.id || parsed.channels)) {
    return { scenarios: validateImportedScenarioSet([parsed]) };
  }
  throw new Error(
    "Import must contain a conversation object, a two-conversation array, a Studio draft, or a {chatScenario, voiceScenario} wrapper."
  );
}

function scenarioChannel(scenario) {
  return normalizeChannels(scenario?.channels)[0];
}

function publishedScenarioBaseId(scenario) {
  const channel = scenarioChannel(scenario);
  return slugify(
    String(scenario?.id || "").replace(new RegExp(`_${channel}$`, "u"), ""),
    "imported_conversation"
  );
}

function stripAvoidPrefix(value) {
  return cleanText(value).replace(/^(avoid:\s*)/iu, "");
}

function draftFromScenarios(scenarios) {
  const chatScenario = scenarios.find((scenario) => scenarioChannel(scenario) === "chat");
  const voiceScenario = scenarios.find((scenario) => scenarioChannel(scenario) === "voice");
  const primary = chatScenario || voiceScenario || scenarios[0];
  const criteria = cleanList(primary.evaluationCriteria);
  const correct = cleanList(
    primary.simulation?.managerOnlyIdealResponses?.map(
      (item) => item?.idealAgentResponse
    ),
    criteria.filter((item) => !/^(avoid:|do not\b|never\b)/iu.test(item))
  );
  const avoid = criteria
    .filter((item) => /^(avoid:|do not\b|never\b)/iu.test(item))
    .map(stripAvoidPrefix);
  const approvedTranscript = Array.isArray(primary.simulation?.approvedTranscript)
    ? primary.simulation.approvedTranscript
    : [];
  const customerResponses = approvedTranscript
    .slice(1)
    .map((item) => cleanText(item?.customer))
    .filter(Boolean);
  const baseId = publishedScenarioBaseId(primary);
  const channelList = [
    ...(chatScenario ? ["chat"] : []),
    ...(voiceScenario ? ["voice"] : [])
  ];
  const primaryVoice = voiceScenario || primary;
  const chatOpening = cleanText(
    chatScenario?.customer?.opening?.chat ||
      chatScenario?.frontend?.chat?.initialTranscript?.[0]?.content ||
      chatScenario?.conversationBetween?.aiStart
  );
  const voiceOpening = cleanText(
    voiceScenario?.customer?.opening?.voice ||
      voiceScenario?.conversationBetween?.aiStart
  );
  const primaryOpening =
    scenarioChannel(primary) === "chat" ? chatOpening : voiceOpening;
  const chatGuide = Array.isArray(chatScenario?.frontend?.chat?.guideSections)
    ? chatScenario.frontend.chat.guideSections
    : [];
  const voiceGuide = Array.isArray(voiceScenario?.frontend?.voice?.guideSections)
    ? voiceScenario.frontend.voice.guideSections
    : [];
  const primaryGuide =
    scenarioChannel(primary) === "chat" ? chatGuide : voiceGuide;
  const channelSections = {
    ...(chatScenario
      ? {
          chat: chatGuide.map((section) => ({
            title: section.title,
            body: section.body,
            bullets: section.bullets
          }))
        }
      : {}),
    ...(voiceScenario
      ? {
          voice: voiceGuide.map((section) => ({
            title: section.title,
            body: section.body,
            bullets: section.bullets
          }))
        }
      : {})
  };

  const importedObjectives = clone(primary.coaching?.gradingModel?.objectives);
  const objectiveLabel = cleanText(
    primary.catalog?.primarySkillFocus || primary.catalog?.skillFocus,
    "Use the approved conversation path"
  );
  return normalizeStudioDraft({
    draftId: baseId,
    source: {
      type: primary.simulation?.sourceTranscriptMetadata?.sourceType || "json_import",
      anonymized: primary.source?.anonymized === true,
      generalized: primary.source?.generalized === true,
      material:
        primary.simulation?.sourceTranscriptMetadata?.sourceMaterial ||
        primary.catalog?.description ||
        primary.frontend?.shared?.learnerBriefing?.about
    },
    sourceGrounding: sourceGroundingFromPublished(primary.authoringGrounding),
    scenario: {
      baseId,
      title: primary.title || primary.label || primary.catalog?.title,
      description:
        primary.catalog?.description ||
        primary.frontend?.shared?.learnerBriefing?.about,
      channels: channelList.length ? channelList : primary.channels,
      teamAudience: primary.catalog?.teamAudience,
      agentType: primary.catalog?.agentType,
      difficulty: primary.catalog?.difficulty,
      topic: primary.catalog?.topic,
      subtopic: primary.catalog?.subtopic,
      primarySkillFocus:
        primary.catalog?.primarySkillFocus || primary.catalog?.skillFocus,
      customerEmotion:
        primary.catalog?.customerEmotion || primary.customer?.persona?.tone,
      customerName:
        primary.facts?.customerName || primary.customer?.persona?.name,
      petName: primary.facts?.petName,
      product: primary.facts?.medicationOrProduct,
      openingLine: primaryOpening,
      learnerGoal: primary.learnerGoal
    },
    handling: {
      correct,
      avoid,
      customerResponses
    },
    facts: clone(primary.facts),
    evaluation: {
      mode: "focused_learning_objectives",
      criteria,
      passingScore: primary.coaching?.gradingModel?.passingScore,
      objectives: Array.isArray(importedObjectives) && importedObjectives.length
        ? importedObjectives
        : [{
            id: slugify(objectiveLabel, "approved_conversation_path"),
            label: objectiveLabel,
            description: cleanText(primary.learnerGoal, objectiveLabel),
            criteria
          }],
      qualityChecklist: clone(primary.coaching?.qualityChecklist),
      behaviorRubric: clone(primary.coaching?.behaviorRubric)
    },
    voice: {
      selectedVoice:
        primaryVoice.runtime?.tuning?.voice?.id ||
        primaryVoice.voice ||
        primaryVoice.frontend?.voice?.selectedVoice,
      speed: primaryVoice.runtime?.tuning?.voice?.speed,
      customerStarts: primaryVoice.frontend?.voice?.customerStarts,
      openingLine: voiceOpening || primaryOpening,
      pacing: primaryVoice.frontend?.voice?.pacing
    },
    chat: {
      hotkeyProfile:
        chatScenario?.chatConfig?.hotkeyProfile ||
        chatScenario?.frontend?.chat?.hotkeyProfile,
      customerStarts:
        typeof chatScenario?.frontend?.chat?.customerStarts === "boolean"
          ? chatScenario.frontend.chat.customerStarts
          : chatScenario?.frontend?.chat?.initialTranscript?.[0]?.role !== "system",
      openingLine: chatOpening || primaryOpening,
      standardText: clone(chatScenario?.frontend?.chat?.standardText)
    },
    guidance: {
      sections: primaryGuide.map((section) => ({
        title: section.title,
        body: section.body,
        bullets: section.bullets
      })),
      channelSections
    },
    tuning:
      clone(primaryVoice.runtime?.tuning) ||
      clone(chatScenario?.runtime?.tuning)
  });
}

const CHANGE_FIELDS = [
  ["source.type", "Source type"],
  ["source.material", "Source material"],
  ["sourceGrounding", "Source grounding"],
  ["scenario.baseId", "Scenario ID"],
  ["scenario.title", "Title"],
  ["scenario.description", "Conversation situation"],
  ["scenario.channels", "Channels"],
  ["scenario.teamAudience", "Audience"],
  ["scenario.topic", "Topic"],
  ["scenario.subtopic", "Subtopic"],
  ["scenario.customerEmotion", "Conversation Partner mood"],
  ["scenario.customerName", "Conversation Partner name"],
  ["scenario.petName", "Pet name"],
  ["scenario.product", "Product or request"],
  ["scenario.openingLine", "Opening line"],
  ["scenario.learnerGoal", "Learner goal"],
  ["handling.correct", "Expected learner behavior"],
  ["handling.avoid", "Prohibited actions"],
  ["handling.customerResponses", "Conversation Partner responses"],
  ["facts", "Conversation facts"],
  ["evaluation.mode", "Evaluation mode"],
  ["evaluation.criteria", "Evaluation criteria"],
  ["evaluation.passingScore", "Passing score"],
  ["evaluation.objectives", "Learning objectives"],
  ["evaluation.qualityChecklist", "Quality checklist"],
  ["evaluation.behaviorRubric", "Behavior rubric"],
  ["voice.selectedVoice", "Voice"],
  ["voice.speed", "Voice speed"],
  ["voice.customerStarts", "Voice opening behavior"],
  ["voice.openingLine", "Voice opening line"],
  ["voice.pacing", "Voice pacing"],
  ["chat.hotkeyProfile", "Chat hotkey profile"],
  ["chat.customerStarts", "Chat opening behavior"],
  ["chat.openingLine", "Chat opening line"],
  ["chat.standardText", "Chat Standard Text"],
  ["guidance.sections", "Coach Chewy guidance"],
  ["guidance.channelSections", "Channel-specific Coach Chewy guidance"],
  ["tuning.voice", "Voice tuning"],
  ["tuning.customer", "Conversation Partner tuning"],
  ["tuning.conversation", "Conversation tuning"]
];

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function comparable(value) {
  return JSON.stringify(value ?? null);
}

export function summarizeDraftChanges(before, after) {
  const previous = normalizeStudioDraft(before || {});
  const next = normalizeStudioDraft(after || {});
  return CHANGE_FIELDS.flatMap(([path, label]) => {
    const oldValue = getPath(previous, path);
    const newValue = getPath(next, path);
    if (comparable(oldValue) === comparable(newValue)) return [];
    return [
      {
        path,
        label,
        before: clone(oldValue),
        after: clone(newValue)
      }
    ];
  });
}

export const summarizeStudioDraftChanges = summarizeDraftChanges;

const REVISION_DIFF_GROUPS = [
  {
    id: "scenario",
    label: "Conversation",
    fields: [
      ["scenario.title", "Conversation"],
      ["scenario.teamAudience", "Team"],
      ["scenario.topic", "Topic"],
      ["scenario.subtopic", "Subtopic"],
      ["scenario.description", "Conversation situation"],
      ["scenario.customerEmotion", "Conversation Partner mood"],
      ["scenario.customerName", "Conversation Partner name"],
      ["scenario.petName", "Pet name"],
      ["scenario.product", "Product or request"],
      ["scenario.openingLine", "Shared opening line"],
      ["scenario.learnerGoal", "Learner goal"],
      ["facts", "Conversation facts"],
      ["tuning.customer", "Conversation Partner behavior"],
      ["tuning.conversation", "Conversation behavior"]
    ]
  },
  {
    id: "handling",
    label: "Conversation Flow",
    fields: [
      ["handling.correct", "Expected learner behavior"],
      ["handling.avoid", "Action to avoid"],
      ["handling.customerResponses", "Conversation Partner response"]
    ]
  },
  {
    id: "evaluation",
    label: "Evaluation",
    fields: [
      ["evaluation.mode", "Evaluation type", formatEvaluationMode],
      ["evaluation.objectives", "Learning objective", formatObjectives],
      ["evaluation.criteria", "Evaluation criterion"],
      ["evaluation.passingScore", "Passing score"]
    ]
  },
  {
    id: "voice",
    label: "Voice Setup",
    fields: [
      ["voice.selectedVoice", "Conversation Partner voice"],
      ["voice.speed", "Voice speed", (value) => value === undefined ? [] : [`${value}×`]],
      ["voice.customerStarts", "Voice opening behavior", formatOpeningBehavior],
      ["voice.openingLine", "Voice opening line"],
      ["voice.pacing", "Voice pacing"],
      ["tuning.voice", "Voice tuning"]
    ]
  },
  {
    id: "chat",
    label: "Chat Setup",
    fields: [
      ["chat.customerStarts", "Chat opening behavior", formatOpeningBehavior],
      ["chat.openingLine", "Chat opening line"],
      ["chat.hotkeyProfile", "Standard Text library"],
      ["chat.standardText", "Standard Text response", formatStandardText]
    ]
  },
  {
    id: "guidance",
    label: "Coach Chewy Guidance",
    fields: [
      ["guidance.sections", "Shared guidance card", formatGuidance],
      ["guidance.channelSections.chat", "Chat guidance card", formatGuidance],
      ["guidance.channelSections.voice", "Voice guidance card", formatGuidance]
    ]
  }
];

function normalizeRevisionComparisonDraft(value) {
  const candidate = isPlainObject(value) ? clone(value) : {};
  const hasRichPhases = Array.isArray(candidate.flow?.phases) && candidate.flow.phases.length > 0;
  const normalized = normalizeStudioDraft(candidate);
  if (hasRichPhases && isPlainObject(normalized.guidance?.channelSections)) {
    const sharedChannelProjection = normalizeGuidance(
      normalized.guidance.sections,
      normalized.handling.correct
    );
    ["chat", "voice"].forEach((channel) => {
      const channelSections = normalized.guidance.channelSections[channel];
      if (
        Array.isArray(channelSections) &&
        comparable(formatGuidance(channelSections)) === comparable(formatGuidance(sharedChannelProjection))
      ) {
        delete normalized.guidance.channelSections[channel];
      }
    });
    if (!Object.keys(normalized.guidance.channelSections).length) {
      delete normalized.guidance.channelSections;
    }
  }
  return normalized;
}

export function buildRevisionDiff(before, after) {
  const previous = normalizeRevisionComparisonDraft(before);
  const next = normalizeRevisionComparisonDraft(after);
  return REVISION_DIFF_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    changes: group.fields.flatMap(([path, label, formatter]) =>
      diffReadableLines(
        label,
        readableLines(getPath(previous, path), formatter),
        readableLines(getPath(next, path), formatter)
      )
    )
  }));
}

function readableLines(value, formatter) {
  if (formatter) return formatter(value);
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap((item) => readableLines(item));
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const details = readableLines(item);
      const label = readableLabel(key);
      return details.length ? details.map((detail) => `${label}: ${detail}`) : [];
    });
  }
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  return [String(value).trim()].filter(Boolean);
}

function readableLabel(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatEvaluationMode(value) {
  if (!value) return [];
  return [value === "focused_learning_objectives" ? "Learning objectives only" : readableLabel(value)];
}

function formatOpeningBehavior(value) {
  if (value === undefined || value === null) return [];
  return [value === false ? "Learner starts" : "Customer starts"];
}

function formatObjectives(value) {
  return Array.isArray(value)
    ? value.map((objective, index) => {
        if (!isPlainObject(objective)) return String(objective || "").trim();
        const title = cleanText(objective.label || objective.description, `Objective ${index + 1}`);
        const description = cleanText(objective.description);
        const criteria = readableLines(objective.criteria);
        return [
          title,
          description && description !== title ? description : "",
          criteria.length ? `Criteria: ${criteria.join("; ")}` : ""
        ].filter(Boolean).join(" — ");
      }).filter(Boolean)
    : [];
}

function formatStandardText(value) {
  return Array.isArray(value)
    ? value.map((item) => {
        if (!isPlainObject(item)) return String(item || "").trim();
        const shortcut = cleanText(item.hotkey || item.label || item.category, "Approved response");
        const response = cleanText(item.template || item.text || item.response);
        return response ? `${shortcut}: ${response}` : shortcut;
      }).filter(Boolean)
    : [];
}

function formatGuidance(value) {
  return Array.isArray(value)
    ? value.map((section, index) => {
        if (!isPlainObject(section)) return String(section || "").trim();
        const title = cleanText(section.title, `Guidance ${index + 1}`);
        const body = cleanText(section.body);
        const bullets = readableLines(section.bullets);
        return [title, body, ...bullets].filter(Boolean).join(" — ");
      }).filter(Boolean)
    : [];
}

function diffReadableLines(label, before, after) {
  if (comparable(before) === comparable(after)) return [];
  const operations = lineDiffOperations(before, after);
  const changes = [];
  let pendingRemoved = [];
  let pendingAdded = [];
  const flush = () => {
    const paired = Math.min(pendingRemoved.length, pendingAdded.length);
    for (let index = 0; index < paired; index += 1) {
      changes.push({
        kind: "changed",
        label,
        before: pendingRemoved[index],
        after: pendingAdded[index]
      });
    }
    pendingRemoved.slice(paired).forEach((line) =>
      changes.push({ kind: "removed", label, before: line, after: "" })
    );
    pendingAdded.slice(paired).forEach((line) =>
      changes.push({ kind: "added", label, before: "", after: line })
    );
    pendingRemoved = [];
    pendingAdded = [];
  };
  operations.forEach((operation) => {
    if (operation.kind === "same") {
      flush();
    } else if (operation.kind === "removed") {
      pendingRemoved.push(operation.value);
    } else {
      pendingAdded.push(operation.value);
    }
  });
  flush();
  return changes;
}

function lineDiffOperations(before, after) {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const lengths = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = before[left] === after[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const operations = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      operations.push({ kind: "same", value: before[left] });
      left += 1;
      right += 1;
    } else if (lengths[left + 1][right] >= lengths[left][right + 1]) {
      operations.push({ kind: "removed", value: before[left] });
      left += 1;
    } else {
      operations.push({ kind: "added", value: after[right] });
      right += 1;
    }
  }
  while (left < before.length) operations.push({ kind: "removed", value: before[left++] });
  while (right < after.length) operations.push({ kind: "added", value: after[right++] });
  return operations;
}

export function importStudioPayload(payload, currentDraft = null) {
  const extracted = extractImportedScenarios(payload);
  const draft = extracted.draft || draftFromScenarios(extracted.scenarios);
  return {
    draft,
    scenarios: clone(extracted.scenarios || []),
    changes: currentDraft ? summarizeDraftChanges(currentDraft, draft) : []
  };
}

export const importStudioScenarios = importStudioPayload;

export function buildChatGptHandoffPrompt(input) {
  const draft = normalizeStudioDraft(input);
  const channelInstruction =
    draft.scenario.channels.length === 2
      ? "Return a JSON object with chatScenario and voiceScenario. Each value must be one standalone scenario object."
      : "Return one standalone scenario JSON object for the selected channel.";
  const evaluationInstruction =
    draft.evaluation.mode === "focused_learning_objectives"
      ? "Use coaching.gradingModel.mode focused_learning_objectives with criteria_checklist objectives. Omit coaching.qualityChecklist and coaching.behaviorRubric."
      : "Use customer_care_behaviors scoring with all seven complete coaching.behaviorRubric entries and a coaching.qualityChecklist.";
  const topLevelFields = SCENARIO_REQUIRED_TOP_LEVEL_FIELDS.join(", ");
  const behaviorIds = OFFICIAL_BEHAVIOR_IDS.join(", ");
  const rubricFields = BEHAVIOR_RUBRIC_REQUIRED_FIELDS.join(", ");

  return [
    "Create a Conversation Builder scenario draft from the reviewed source below.",
    "",
    "OUTPUT CONTRACT",
    `- ${channelInstruction}`,
    "- Each scenario must contain exactly one channel.",
    "- Use sibling IDs ending in _chat and _voice with the same catalog.groupId when both channels are selected.",
    "- Use runtime.replyMode dynamic_customer_responder.",
    `- ${evaluationInstruction}`,
    "- Preserve approved facts, correct handling, prohibited actions, and evaluation criteria.",
    "- When the reviewed source does not name a pet, use the draft's short fictional pet name consistently.",
    "- Do not include Markdown fences, commentary, credentials, API keys, or publishing instructions.",
    "- Do not copy raw transcript or policy source material into the scenario. Use only reviewed, reusable scenario content.",
    "",
    "CANONICAL REQUIRED TOP-LEVEL SHAPE",
    `- Required keys: ${topLevelFields}.`,
    "- Chat scenarios also require chatConfig.",
    '- channels must be exactly [\"chat\"] or [\"voice\"].',
    "- catalog must include: scenarioType, agentType, primarySkillFocus, groupId, description, skillFocus, title, practiceDescription, tags, teamAudience, difficulty, skillId, qualityBehavior, domain, topic, customerEmotion, trainingTopic, subtopic, label, searchDescription, estimatedDurationMinutes.",
    "- simulation must include: sourceTranscriptMetadata, managerOnlyIdealResponses, approvedTranscript, and stateModel. Chat stateModel must include chatStepProgression matching chatConfig.stepProgression.",
    "- runtime must include replyMode: dynamic_customer_responder. Optional runtime.tuning uses version, customer, conversation, and voice only for Voice.",
    "- facts must include: keyQuestion, shareOnlyIfAsked, address, medication, rootCauseBelief, customerName, petName, urgency, medicationOrProduct, allowedObjections, closingLine, clinic, conditionalFollowUp.",
    "- conversationBetween must include: aiPersonality, aiRole, aiStart, participantRole.",
    "- frontend.shared must include introInstructions and learnerBriefing. learnerBriefing must include about, objectives, evaluationFocus, goals.",
    "- frontend.chat must include guideTitle, guideSections, initialTranscript, hotkeyProfile, and an explicit standardText array.",
    "- frontend.voice must include guideTitle, guideSections, selectedVoice, pacing, customerStarts, and endNote.",
    "- customer must include opening, persona, and behavior. persona includes name, tone, goal; behavior includes rules, conditionalFollowUps, allowedObjections, softeningRule, closingRule.",
    "- managerPreview must include testRevision, latestSuggestion, updatedAt.",
    "",
    "CANONICAL EVALUATION SHAPES",
    `- Full conversation behavior IDs, exactly once each: ${behaviorIds}.`,
    `- Every behaviorRubric item must include: ${rubricFields}.`,
    "- Full conversation coaching includes summaryGuidance, qualityChecklist, behaviorRubric, and gradingModel.mode customer_care_behaviors.",
    "- Focused coaching includes summaryGuidance and gradingModel only. gradingModel includes mode focused_learning_objectives, evaluationMethod criteria_checklist, scoreAggregation average_objectives, passingScore, and objectives.",
    "- Every focused objective includes id, label, description, and an array of observable criteria. Focused output omits qualityChecklist and behaviorRubric entirely.",
    "",
    "CHANNEL-SPECIFIC SHAPE",
    "- Chat ID: <catalog.groupId>_chat; include frontend.chat and chatConfig; omit frontend.voice and runtime.tuning.voice.",
    "- Voice ID: <catalog.groupId>_voice; include frontend.voice and runtime.tuning.voice; omit frontend.chat and chatConfig.",
    "- Preserve channel-specific customer openings and Coach Chewy guide sections when returning siblings.",
    "",
    "CURRENT REVIEWED STUDIO DRAFT",
    JSON.stringify(draft, null, 2)
  ].join("\n");
}

export const buildStudioHandoffPrompt = buildChatGptHandoffPrompt;
