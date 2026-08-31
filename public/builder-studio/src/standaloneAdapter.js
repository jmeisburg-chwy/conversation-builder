export const STANDALONE_DRAFT_STORAGE_KEY = "conversation-builder.standalone-draft.v1";

const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((item) => text(item)).filter(Boolean);
const slug = (value, fallback) => text(value, fallback).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;

function objectiveCriterion(objectiveId, criterion, index) {
  const value = typeof criterion === "object" && criterion ? criterion.text : criterion;
  return { id: slug(typeof criterion === "object" && criterion ? criterion.id : "", `${objectiveId}_criterion_${index + 1}`), text: text(value) };
}

export function standaloneToAuthoringDraft(draft, creatorInput = {}) {
  const objectives = listOf(draft?.objectives).map((objective, objectiveIndex) => {
    const id = slug(objective?.id, `objective_${objectiveIndex + 1}`);
    return {
      id,
      label: text(objective?.label, `Objective ${objectiveIndex + 1}`),
      description: text(objective?.description, draft?.learnerGoal),
      criteria: listOf(objective?.criteria).map((criterion, index) => objectiveCriterion(id, criterion, index)),
    };
  });
  const sourcePhases = listOf(draft?.phases);
  const phases = sourcePhases.map((phase, index) => ({
    id: slug(phase?.id, `phase_${index + 1}`),
    title: text(phase?.title, `Phase ${index + 1}`),
    purpose: list(phase?.learnerActions).join(" "),
    partnerTurn: index === 0
      ? text(draft?.customer?.openingLine, phase?.partnerResponse)
      : text(sourcePhases[index - 1]?.partnerResponse),
    strongLearnerResponse: list(phase?.learnerActions).join(" "),
    coachGuidance: {
      title: text(phase?.guideTitle, phase?.title),
      bullets: list(phase?.coachGuidance).map((guidance, guidanceIndex) => ({
        id: `${slug(phase?.id, `phase_${index + 1}`)}_guidance_${guidanceIndex + 1}`,
        text: guidance,
      })),
    },
    advanceWhen: list(phase?.learnerActions).join(" "),
    evaluationLinks: objectives.flatMap((objective) => {
      const criterion = objective.criteria[index] || objective.criteria[0];
      return criterion ? [{ objectiveId: objective.id, criterionIds: [criterion.id] }] : [];
    }),
  }));
  const material = [
    `What the conversation is about:\n${text(creatorInput.conversationAbout, draft?.description)}`,
    `How the Learner should handle the conversation:\n${text(creatorInput.learnerApproach, draft?.learnerGoal)}`,
  ].join("\n\n");
  return {
    studioVersion: 2,
    draftId: slug(draft?.baseId, "conversation_practice"),
    updatedAt: new Date().toISOString(),
    source: { type: "rough_idea", material, anonymized: true, generalized: false },
    scenario: {
      baseId: slug(draft?.baseId, "conversation_practice"),
      title: text(draft?.title, "Conversation Practice"),
      description: text(draft?.description),
      channels: list(draft?.channels).filter((channel) => ["chat", "voice"].includes(channel)),
      teamAudience: text(draft?.teamAudience, "Customer Care"),
      agentType: draft?.agentType === "Rx" ? "Rx" : "Core",
      difficulty: "beginner",
      topic: text(draft?.topic, "Conversation Practice"),
      subtopic: text(draft?.subtopic, "Practice"),
      primarySkillFocus: text(objectives[0]?.label, "Conversation Skills"),
      customerEmotion: text(draft?.customer?.tone, "Concerned"),
      customerName: text(draft?.customer?.name, "Customer"),
      petName: text(draft?.customer?.petName),
      product: text(draft?.compatibilityFacts?.medicationOrProduct),
      openingLine: text(draft?.customer?.openingLine),
      learnerGoal: text(draft?.learnerGoal),
    },
    partner: {
      name: text(draft?.customer?.name, "Customer"),
      role: "Customer",
      mood: text(draft?.customer?.tone, "Concerned"),
      personality: text(draft?.customer?.goal, "Wants accurate help and a clear next step."),
      knows: list(draft?.customer?.facts),
      withholds: list(draft?.customer?.revealOnlyWhenAsked),
      behaviorRules: list(draft?.customer?.behaviorRules),
    },
    handling: {
      correct: sourcePhases.flatMap((phase) => list(phase?.learnerActions)),
      avoid: list(draft?.prohibitedActions),
      customerResponses: sourcePhases.map((phase) => text(phase?.partnerResponse)).filter(Boolean),
    },
    flow: {
      phases,
      closingPartnerTurn: text(sourcePhases.at(-1)?.partnerResponse, draft?.customer?.closingLine),
      cautionsAuthoritative: true,
    },
    facts: {
      keyQuestion: text(draft?.compatibilityFacts?.keyQuestion, draft?.description),
      shareOnlyIfAsked: list(draft?.customer?.revealOnlyWhenAsked),
      address: text(draft?.compatibilityFacts?.address),
      medication: text(draft?.compatibilityFacts?.medication),
      rootCauseBelief: text(draft?.compatibilityFacts?.rootCauseBelief, draft?.customer?.goal),
      urgency: text(draft?.compatibilityFacts?.urgency, draft?.description),
      allowedObjections: list(draft?.customer?.objections),
      closingLine: text(draft?.customer?.closingLine),
      clinic: text(draft?.compatibilityFacts?.clinic),
      conditionalFollowUp: text(draft?.compatibilityFacts?.conditionalFollowUp, list(draft?.customer?.conditionalFollowUps).join(" ")),
    },
    evaluation: {
      mode: "focused_learning_objectives",
      criteria: objectives.flatMap((objective) => objective.criteria.map((criterion) => criterion.text)),
      passingScore: 80,
      objectives,
    },
    voice: {
      selectedVoice: text(draft?.voice?.selectedVoice, "marin"),
      speed: Number.isFinite(draft?.voice?.speed) ? draft.voice.speed : 1,
      customerStarts: draft?.voice?.experience?.customerStarts !== false,
      openingLine: text(draft?.customer?.openingLine),
      pacing: text(draft?.voice?.experience?.pacing, "Use calm, natural pacing and wait for each completed learner response."),
    },
    chat: {
      hotkeyProfile: draft?.chat?.hotkeyProfile === "rx" ? "rx" : "core",
      customerStarts: true,
      openingLine: text(draft?.customer?.openingLine),
      standardText: listOf(draft?.chat?.standardText).map((item, index) => ({
        id: slug(item?.hotkey, `response_${index + 1}`),
        hotkey: text(item?.hotkey),
        category: text(item?.category),
        template: text(item?.template),
        notes: list(item?.notes),
      })),
      approvedResponseAssignments: [],
    },
  };
}

export function authoringToStandaloneDraft(draft) {
  const phases = listOf(draft?.flow?.phases);
  const objectives = listOf(draft?.evaluation?.objectives).map((objective, index) => ({
    id: slug(objective?.id, `objective_${index + 1}`),
    label: text(objective?.label, `Objective ${index + 1}`),
    description: text(objective?.description, draft?.scenario?.learnerGoal),
    criteria: listOf(objective?.criteria).map((criterion) => text(typeof criterion === "object" && criterion ? criterion.text : criterion)).filter(Boolean),
  }));
  const cautions = phases.flatMap((phase) => listOf(phase?.coachGuidance?.bullets).flatMap((bullet) =>
    listOf(bullet?.children).filter((child) => child?.kind === "caution").map((child) => text(child?.text))
  )).filter(Boolean);
  const standardText = listOf(draft?.chat?.standardText).map((item) => ({
    hotkey: text(item?.hotkey),
    category: text(item?.category, "Approved response"),
    template: text(item?.template),
    insertionMoment: text(item?.insertionMoment, "Use in the assigned conversation phase."),
    customization: text(item?.customization, "Adapt only the fictional scenario details."),
    notes: list(item?.notes),
    approvedGuidance: text(item?.approvedGuidance, "Use the approved response when it supports the learner action."),
  }));
  return {
    baseId: slug(draft?.scenario?.baseId, "conversation_practice"),
    title: text(draft?.scenario?.title, "Conversation Practice"),
    description: text(draft?.scenario?.description),
    learnerGoal: text(draft?.scenario?.learnerGoal),
    channels: list(draft?.scenario?.channels).filter((channel) => ["chat", "voice"].includes(channel)),
    agentType: draft?.scenario?.agentType === "Rx" ? "Rx" : "Core",
    topic: text(draft?.scenario?.topic, "Conversation Practice"),
    subtopic: text(draft?.scenario?.subtopic, "Practice"),
    teamAudience: text(draft?.scenario?.teamAudience, "Customer Care"),
    customer: {
      name: text(draft?.partner?.name, "Customer"),
      petName: text(draft?.scenario?.petName),
      tone: text(draft?.partner?.mood, "Concerned"),
      goal: text(draft?.partner?.personality, "Wants accurate help and a clear next step."),
      openingLine: text(phases[0]?.partnerTurn, draft?.scenario?.openingLine),
      facts: list(draft?.partner?.knows),
      revealOnlyWhenAsked: [...new Set([...list(draft?.partner?.withholds), ...list(draft?.facts?.shareOnlyIfAsked)])],
      objections: list(draft?.facts?.allowedObjections),
      behaviorRules: list(draft?.partner?.behaviorRules),
      conditionalFollowUps: list(draft?.facts?.conditionalFollowUp),
      closingLine: text(draft?.flow?.closingPartnerTurn, draft?.facts?.closingLine),
    },
    correctProcess: phases.map((phase) => text(phase?.strongLearnerResponse)).filter(Boolean),
    prohibitedActions: cautions,
    phases: phases.map((phase, index) => ({
      id: slug(phase?.id, `phase_${index + 1}`),
      title: text(phase?.title, `Phase ${index + 1}`),
      learnerActions: [text(phase?.strongLearnerResponse)].filter(Boolean),
      partnerResponse: text(phases[index + 1]?.partnerTurn, draft?.flow?.closingPartnerTurn),
      coachGuidance: listOf(phase?.coachGuidance?.bullets).flatMap((bullet) => [text(bullet?.text), ...listOf(bullet?.children).map((child) => text(child?.text))]).filter(Boolean),
      guideTitle: text(phase?.coachGuidance?.title, phase?.title),
      guideBody: text(phase?.coachGuidance?.bullets?.[0]?.text, phase?.strongLearnerResponse),
      customerRemainsSilent: index === phases.length - 1 && !text(draft?.flow?.closingPartnerTurn),
    })),
    objectives,
    objectiveApprovalRequired: false,
    compatibilityFacts: {
      address: text(draft?.facts?.address),
      medication: text(draft?.facts?.medication),
      urgency: text(draft?.facts?.urgency, draft?.scenario?.description),
      medicationOrProduct: text(draft?.scenario?.product),
      clinic: text(draft?.facts?.clinic),
      keyQuestion: text(draft?.facts?.keyQuestion),
      rootCauseBelief: text(draft?.facts?.rootCauseBelief),
      conditionalFollowUp: text(draft?.facts?.conditionalFollowUp),
    },
    chat: {
      hotkeyProfile: draft?.chat?.hotkeyProfile === "rx" ? "rx" : "core",
      standardText,
      standardTextDecision: standardText.length ? "approved" : "none",
    },
    voice: {
      selectedVoice: text(draft?.voice?.selectedVoice, "marin"),
      speed: Number.isFinite(draft?.voice?.speed) ? draft.voice.speed : 1,
      experience: {
        customerStarts: draft?.voice?.customerStarts !== false,
        guideTitle: "Coach Chewy Guidance",
        guideTopNote: "This activity evaluates only the approved learning objectives.",
        pacing: text(draft?.voice?.pacing, "Use warm, natural pacing and wait for completed learner thoughts."),
        verbalGuidance: "",
        endNote: "After the conversation is complete, click End to receive feedback.",
        spokenTone: text(draft?.partner?.mood),
      },
    },
  };
}

export function objectiveFingerprint(objectives) {
  const input = JSON.stringify(objectives);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `objectives-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function saveStandaloneDraft(storage, draft) {
  const envelope = { version: 1, savedAt: new Date().toISOString(), draft };
  storage.setItem(STANDALONE_DRAFT_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
}

export function loadStandaloneDraft(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STANDALONE_DRAFT_STORAGE_KEY) || "null");
    return parsed?.version === 1 && parsed?.draft && typeof parsed.draft === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}
