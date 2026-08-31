import { customerFollowUpConflictsWithLearner } from "./scenarioQualityGuards.js";

export const STANDALONE_DRAFT_STORAGE_KEY = "conversation-builder.standalone-draft.v1";

const text = (value, fallback = "") => String(value ?? "").trim() || fallback;
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((item) => text(item)).filter(Boolean);
const slug = (value, fallback) => text(value, fallback).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || fallback;

function objectiveCriterion(objectiveId, criterion, index) {
  const value = typeof criterion === "object" && criterion ? criterion.text : criterion;
  return { id: slug(typeof criterion === "object" && criterion ? criterion.id : "", `${objectiveId}_criterion_${index + 1}`), text: text(value) };
}

function phaseEvaluationLinks(value) {
  return listOf(value).flatMap((link) => {
    const objectiveId = text(link?.objectiveId);
    const criterionIds = list(link?.criterionIds);
    return objectiveId && criterionIds.length ? [{ objectiveId, criterionIds }] : [];
  });
}

function chatAdvanceRequirements(value, phaseId) {
  return listOf(value).flatMap((requirement, index) => {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) return [];
    const phrases = [...new Set(list(requirement?.phrases).map((phrase) => phrase.toLowerCase()))];
    return [{
      id: slug(requirement?.id, `${phaseId}_requirement_${index + 1}`),
      phrases,
    }];
  });
}

function downloadablePhaseEvaluationLinks(value, sourceObjectives, standaloneObjectives) {
  return phaseEvaluationLinks(value).map((link) => {
    const sourceObjectiveIndex = sourceObjectives.findIndex((objective) =>
      text(objective?.id) === link.objectiveId || slug(objective?.id, "") === slug(link.objectiveId, "")
    );
    const sourceObjective = sourceObjectives[sourceObjectiveIndex];
    const standaloneObjective = standaloneObjectives[sourceObjectiveIndex];
    if (!sourceObjective || !standaloneObjective) return link;
    const criterionIdsBySourceId = new Map(
      listOf(sourceObjective?.criteria).map((criterion, index) => [
        text(typeof criterion === "object" && criterion ? criterion.id : ""),
        `${standaloneObjective.id}_criterion_${index + 1}`,
      ]).filter(([sourceId]) => sourceId)
    );
    return {
      objectiveId: standaloneObjective.id,
      criterionIds: link.criterionIds.map((criterionId) => criterionIdsBySourceId.get(criterionId) || criterionId),
    };
  });
}

function approvedResponseAssignments(value) {
  return listOf(value).flatMap((assignment, index) => {
    const responseId = text(assignment?.responseId);
    const phaseId = text(assignment?.phaseId);
    const instruction = text(assignment?.instruction);
    return responseId && phaseId && instruction ? [{
      id: slug(assignment?.id, `assignment_${index + 1}`),
      responseId,
      phaseId,
      instruction,
    }] : [];
  });
}

function guidanceHierarchy(value, phaseId) {
  return listOf(value).flatMap((bullet, bulletIndex) => {
    const candidate = typeof bullet === "object" && bullet ? bullet : { text: bullet };
    const bulletText = text(candidate.text ?? candidate.body);
    if (!bulletText) return [];
    const children = listOf(candidate.children).flatMap((child, childIndex) => {
      const childCandidate = typeof child === "object" && child ? child : { text: child };
      const childText = text(childCandidate.text);
      if (!childText) return [];
      return [{
        id: text(childCandidate.id, `${phaseId}_guidance_${bulletIndex + 1}_${childIndex + 1}`),
        text: childText,
        kind: childCandidate.kind === "caution" ? "caution" : "support",
        ...(childCandidate.kindOverride === true ? { kindOverride: true } : {}),
      }];
    });
    return [{
      id: text(candidate.id, `${phaseId}_guidance_${bulletIndex + 1}`),
      text: bulletText,
      ...(children.length ? { children } : {}),
      ...(candidate.systemReference && typeof candidate.systemReference === "object"
        ? { systemReference: structuredClone(candidate.systemReference) }
        : {}),
    }];
  });
}

function flattenedGuidance(hierarchy) {
  return hierarchy.flatMap((bullet) => [bullet.text, ...listOf(bullet.children).map((child) => text(child?.text))]).filter(Boolean);
}

const EXPLICIT_NEGATIVE_GUIDANCE_PATTERN = /^\s*(?:(?:(?:the|a)\s+)?(?:learner|agent|representative|chewy (?:agent|representative))\s+(?:(?:must|should|will|can)\s+(?:not|never)|cannot|never)|avoid|do not|don't|must not|never|refrain(?:\s+from)?)\b/iu;
const BOUNDARY_GUIDANCE_PATTERN = /\b(?:avoid|do not|don't|must not|never|refrain(?:\s+from)?|without|rather than|instead of)\b/iu;
const BOUNDARY_STOP_WORDS = new Set(["a", "an", "and", "avoid", "do", "for", "must", "never", "no", "not", "of", "or", "the", "to", "without"]);

function normalizedTextKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function boundaryTokens(value) {
  return text(value).toLowerCase().match(/[a-z0-9]+/g)
    ?.map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .filter((token) => token.length > 2 && !BOUNDARY_STOP_WORDS.has(token)) ?? [];
}

function relatedBoundaryToken(left, right) {
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.startsWith(right) || right.startsWith(left)));
}

function boundaryCoverageScore(action, candidate) {
  const actionTokens = boundaryTokens(action);
  const candidateTokens = boundaryTokens(candidate);
  if (!actionTokens.length || !candidateTokens.length) return 0;
  return actionTokens.filter((token) => candidateTokens.some((candidateToken) => relatedBoundaryToken(token, candidateToken))).length;
}

function coversBoundary(action, candidate) {
  const actionTokens = boundaryTokens(action);
  return BOUNDARY_GUIDANCE_PATTERN.test(text(candidate))
    && actionTokens.length > 0
    && boundaryCoverageScore(action, candidate) === actionTokens.length;
}

function equivalentBoundary(left, right) {
  return coversBoundary(left, right) || coversBoundary(right, left);
}

function mergedPhaseGuidance(phase, phaseId) {
  const hierarchy = guidanceHierarchy(phase?.coachGuidanceHierarchy, phaseId);
  const represented = new Set(flattenedGuidance(hierarchy).map(normalizedTextKey));
  const usedIds = new Set(hierarchy.flatMap((bullet) => [bullet.id, ...listOf(bullet.children).map((child) => child?.id)]));
  list(phase?.coachGuidance).forEach((guidance, index) => {
    const key = normalizedTextKey(guidance);
    if (!key || represented.has(key)) return;
    represented.add(key);
    let id = `${phaseId}_guidance_${hierarchy.length + 1}`;
    let suffix = index + 2;
    while (usedIds.has(id)) {
      id = `${phaseId}_guidance_${hierarchy.length + 1}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    hierarchy.push({ id, text: guidance });
  });
  return hierarchy;
}

function canonicalPhaseGuidance(items, phaseId, fallbackParentText) {
  const bullets = [];
  const pendingCautions = [];
  const seenCautions = new Set();
  const addChild = (parent, child) => {
    const childText = text(child?.text);
    if (!childText) return;
    const caution = child?.kind === "caution" || (child?.kindOverride !== true && EXPLICIT_NEGATIVE_GUIDANCE_PATTERN.test(childText));
    if (caution) {
      const key = normalizedTextKey(childText);
      if (seenCautions.has(key)) return;
      seenCautions.add(key);
    }
    parent.children ||= [];
    parent.children.push({
      id: text(child?.id, `${phaseId}_guidance_${bullets.length + 1}_${parent.children.length + 1}`),
      text: childText,
      kind: caution ? "caution" : "support",
      ...(child?.kindOverride === true ? { kindOverride: true } : {}),
    });
  };
  const addCaution = (parent, item) => {
    addChild(parent, { id: item.id, text: item.text, kind: "caution" });
    listOf(item.children).forEach((child) => addChild(parent, child));
  };

  listOf(items).forEach((item) => {
    if (EXPLICIT_NEGATIVE_GUIDANCE_PATTERN.test(text(item?.text))) {
      if (bullets.length) addCaution(bullets.at(-1), item);
      else pendingCautions.push(item);
      return;
    }
    const bullet = { id: text(item?.id, `${phaseId}_guidance_${bullets.length + 1}`), text: text(item?.text) };
    listOf(item?.children).forEach((child) => addChild(bullet, child));
    bullets.push(bullet);
    if (pendingCautions.length) {
      pendingCautions.splice(0).forEach((caution) => addCaution(bullet, caution));
    }
  });

  if (!bullets.length && pendingCautions.length) {
    const parent = {
      id: `${phaseId}_guidance_1`,
      text: text(fallbackParentText, "Follow the approved process for this phase."),
    };
    pendingCautions.splice(0).forEach((caution) => addCaution(parent, caution));
    bullets.push(parent);
  }
  return bullets;
}

function bestPhaseIndex(phases, action) {
  let bestIndex = Math.max(0, phases.length - 1);
  let bestScore = 0;
  phases.forEach((phase, index) => {
    const searchable = [
      phase.title,
      phase.purpose,
      phase.strongLearnerResponse,
      ...flattenedGuidance(phase.coachGuidance?.bullets ?? []),
    ].join(" ");
    const score = boundaryCoverageScore(action, searchable);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function ensurePhaseCaution(phases, action, prohibitedIndex) {
  for (const [phaseIndex, phase] of phases.entries()) {
    for (const bullet of listOf(phase.coachGuidance?.bullets)) {
      const caution = listOf(bullet?.children).find((child) =>
        child?.kind === "caution" && normalizedTextKey(child?.text) === normalizedTextKey(action)
      );
      if (caution) return phaseIndex;
    }
  }
  for (const [phaseIndex, phase] of phases.entries()) {
    for (const bullet of listOf(phase.coachGuidance?.bullets)) {
      const caution = listOf(bullet?.children).find((child) =>
        child?.kind === "caution" && equivalentBoundary(action, text(child?.text))
      );
      if (!caution) continue;
      caution.text = action;
      return phaseIndex;
    }
  }
  if (!phases.length) return -1;
  const phaseIndex = bestPhaseIndex(phases, action);
  const phase = phases[phaseIndex];
  phase.coachGuidance ||= { title: text(phase.title, `Phase ${phaseIndex + 1}`), bullets: [] };
  phase.coachGuidance.bullets ||= [];
  if (!phase.coachGuidance.bullets.length) {
    phase.coachGuidance.bullets.push({
      id: `${phase.id}_guidance_1`,
      text: text(phase.strongLearnerResponse, "Follow the approved process for this phase."),
    });
  }
  const parent = phase.coachGuidance.bullets.reduce((best, candidate) =>
    boundaryCoverageScore(action, candidate.text) > boundaryCoverageScore(action, best.text) ? candidate : best
  );
  parent.children ||= [];
  const childIds = new Set(parent.children.map((child) => text(child?.id)));
  let id = `${phase.id}_prohibited_${prohibitedIndex + 1}`;
  let suffix = 2;
  while (childIds.has(id)) {
    id = `${phase.id}_prohibited_${prohibitedIndex + 1}_${suffix}`;
    suffix += 1;
  }
  parent.children.push({ id, text: action, kind: "caution" });
  return phaseIndex;
}

function criterionTextForBoundary(action) {
  const value = text(action);
  if (/^(?:avoid|do not|never)\b/iu.test(value)) return value;
  if (/^(?:explain|keep|offer|provide|remain|state|use)\b/iu.test(value) && BOUNDARY_GUIDANCE_PATTERN.test(value)) return value;
  if (/^don't\b/iu.test(value)) return `Do not${value.slice(value.match(/^don't/iu)[0].length)}`;
  if (/^must not\b/iu.test(value)) return `Avoid${value.slice(value.match(/^must not/iu)[0].length)}`;
  if (/^refrain\s+from\b/iu.test(value)) return `Avoid${value.slice(value.match(/^refrain\s+from/iu)[0].length)}`;
  if (/^no\s+/iu.test(value)) return `Avoid ${value.replace(/^no\s+/iu, "")}`;
  return `Avoid ${value.replace(/^./, (character) => character.toLowerCase())}`;
}

function addCriterionLink(phase, objectiveId, criterionId) {
  const link = phase.evaluationLinks.find((candidate) => candidate.objectiveId === objectiveId);
  if (link) {
    if (!link.criterionIds.includes(criterionId)) link.criterionIds.push(criterionId);
    return;
  }
  phase.evaluationLinks.push({ objectiveId, criterionIds: [criterionId] });
}

function ensureProhibitedCoverage(objectives, phases, prohibitedActions) {
  if (!objectives.length && prohibitedActions.length) {
    objectives.push({
      id: "approved_boundaries",
      label: "Approved boundaries",
      description: "Follow the approved boundaries for this conversation.",
      criteria: [],
    });
  }
  prohibitedActions.forEach((action, prohibitedIndex) => {
    const phaseIndex = ensurePhaseCaution(phases, action, prohibitedIndex);
    let objectiveIndex = -1;
    let criterion = null;
    objectives.some((objective, index) => {
      const match = objective.criteria.find((candidate) => coversBoundary(action, candidate.text));
      if (!match) return false;
      objectiveIndex = index;
      criterion = match;
      return true;
    });
    if (!criterion) {
      objectiveIndex = objectives.reduce((bestIndex, objective, index) => {
        const score = boundaryCoverageScore(action, [objective.label, objective.description, ...objective.criteria.map((candidate) => candidate.text)].join(" "));
        const best = objectives[bestIndex];
        const bestScore = boundaryCoverageScore(action, [best.label, best.description, ...best.criteria.map((candidate) => candidate.text)].join(" "));
        return score > bestScore ? index : bestIndex;
      }, 0);
      const objective = objectives[objectiveIndex];
      const usedIds = new Set(objective.criteria.map((candidate) => candidate.id));
      let criterionId = `${objective.id}_criterion_${objective.criteria.length + 1}`;
      let suffix = 2;
      while (usedIds.has(criterionId)) {
        criterionId = `${objective.id}_criterion_${objective.criteria.length + 1}_${suffix}`;
        suffix += 1;
      }
      criterion = { id: criterionId, text: criterionTextForBoundary(action) };
      objective.criteria.push(criterion);
    }
    const alreadyLinked = phases.some((phase) => phase.evaluationLinks.some((link) =>
      link.objectiveId === objectives[objectiveIndex].id && link.criterionIds.includes(criterion.id)
    ));
    if (!alreadyLinked && phaseIndex >= 0) {
      addCriterionLink(phases[phaseIndex], objectives[objectiveIndex].id, criterion.id);
    }
  });
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
  const lastPhaseIndex = Math.max(0, sourcePhases.length - 1);
  const phases = sourcePhases.map((phase, index) => {
    const phaseId = slug(phase?.id, `phase_${index + 1}`);
    const hierarchy = canonicalPhaseGuidance(
      mergedPhaseGuidance(phase, phaseId),
      phaseId,
      list(phase?.learnerActions).join(" "),
    );
    return {
      id: phaseId,
      title: text(phase?.title, `Phase ${index + 1}`),
      purpose: list(phase?.learnerActions).join(" "),
      partnerTurn: index === 0
        ? text(draft?.customer?.openingLine, phase?.partnerResponse)
        : text(sourcePhases[index - 1]?.partnerResponse),
      strongLearnerResponse: list(phase?.learnerActions).join(" "),
      chatAdvanceRequirements: chatAdvanceRequirements(phase?.chatAdvanceRequirements, phaseId),
      coachGuidance: {
        title: text(phase?.guideTitle, phase?.title),
        bullets: hierarchy,
      },
      advanceWhen: list(phase?.learnerActions).join(" "),
      evaluationLinks: phaseEvaluationLinks(phase?.evaluationLinks).length
        ? phaseEvaluationLinks(phase?.evaluationLinks)
        : objectives.flatMap((objective) => {
            const criterionIds = objective.criteria
              .filter((_criterion, criterionIndex) => Math.min(criterionIndex, lastPhaseIndex) === index)
              .map((criterion) => criterion.id);
            return criterionIds.length ? [{ objectiveId: objective.id, criterionIds }] : [];
          }),
    };
  });
  const guidanceCautions = phases.flatMap((phase) => listOf(phase.coachGuidance?.bullets).flatMap((bullet) =>
    listOf(bullet?.children).filter((child) => child?.kind === "caution").map((child) => text(child?.text))
  ));
  const explicitProhibitedActions = [...new Map(list(draft?.prohibitedActions)
    .map((action) => [normalizedTextKey(action), action])).values()];
  const prohibitedActions = [...explicitProhibitedActions];
  guidanceCautions.forEach((action) => {
    if (prohibitedActions.some((candidate) =>
      normalizedTextKey(candidate) === normalizedTextKey(action) || equivalentBoundary(candidate, action)
    )) return;
    prohibitedActions.push(action);
  });
  ensureProhibitedCoverage(objectives, phases, prohibitedActions);
  const material = [
    `What the conversation is about:\n${text(creatorInput.conversationAbout, draft?.description)}`,
    `How the Learner should handle the conversation:\n${text(creatorInput.learnerApproach, draft?.learnerGoal)}`,
  ].join("\n\n");
  return {
    studioVersion: 2,
    draftId: slug(draft?.baseId, "conversation_practice"),
    updatedAt: new Date().toISOString(),
    source: { type: "rough_idea", material, anonymized: creatorInput.deidentificationConfirmed === true, generalized: false },
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
      avoid: prohibitedActions,
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
      passingScore: Number.isFinite(draft?.evaluation?.passingScore) ? draft.evaluation.passingScore : 100,
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
      customerStarts: draft?.chat?.customerStarts !== false,
      openingLine: text(draft?.customer?.openingLine),
      standardText: listOf(draft?.chat?.standardText).map((item, index) => ({
        id: slug(item?.id, `response_${slug(item?.hotkey, String(index + 1))}`),
        hotkey: text(item?.hotkey),
        category: text(item?.category),
        template: text(item?.template),
        notes: list(item?.notes),
      })),
      approvedResponseAssignments: approvedResponseAssignments(draft?.chat?.approvedResponseAssignments),
    },
  };
}

export function authoringToStandaloneDraft(draft) {
  const phases = listOf(draft?.flow?.phases);
  const sourceObjectives = listOf(draft?.evaluation?.objectives);
  const learnerDiscoveryActions = [
    ...phases.map((phase) => text(phase?.strongLearnerResponse)),
    ...sourceObjectives.flatMap((objective) => listOf(objective?.criteria)
      .map((criterion) => text(typeof criterion === "object" && criterion ? criterion.text : criterion))),
  ].filter(Boolean);
  const conditionalFollowUps = list(draft?.facts?.conditionalFollowUp)
    .filter((followUp) => !customerFollowUpConflictsWithLearner(followUp, learnerDiscoveryActions));
  const objectives = sourceObjectives.map((objective, index) => ({
    id: slug(objective?.id, `objective_${index + 1}`),
    label: text(objective?.label, `Objective ${index + 1}`),
    description: text(objective?.description, draft?.scenario?.learnerGoal),
    criteria: listOf(objective?.criteria).map((criterion) => text(typeof criterion === "object" && criterion ? criterion.text : criterion)).filter(Boolean),
  }));
  const cautions = [...new Map(phases.flatMap((phase) => listOf(phase?.coachGuidance?.bullets).flatMap((bullet) =>
    listOf(bullet?.children).filter((child) => child?.kind === "caution").map((child) => text(child?.text))
  )).filter(Boolean).map((caution) => [normalizedTextKey(caution), caution])).values()];
  const standardText = listOf(draft?.chat?.standardText).map((item) => ({
    id: slug(item?.id, `response_${slug(item?.hotkey, "standard_text")}`),
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
      conditionalFollowUps,
      closingLine: text(draft?.flow?.closingPartnerTurn, draft?.facts?.closingLine),
    },
    correctProcess: phases.map((phase) => text(phase?.strongLearnerResponse)).filter(Boolean),
    prohibitedActions: cautions,
    phases: phases.map((phase, index) => {
      const phaseId = slug(phase?.id, `phase_${index + 1}`);
      const hierarchy = guidanceHierarchy(phase?.coachGuidance?.bullets, phaseId);
      return {
        id: phaseId,
        title: text(phase?.title, `Phase ${index + 1}`),
        learnerActions: [text(phase?.strongLearnerResponse)].filter(Boolean),
        chatAdvanceRequirements: chatAdvanceRequirements(phase?.chatAdvanceRequirements, phaseId),
        partnerResponse: text(phases[index + 1]?.partnerTurn, draft?.flow?.closingPartnerTurn),
        coachGuidance: flattenedGuidance(hierarchy),
        coachGuidanceHierarchy: hierarchy,
        guideTitle: text(phase?.coachGuidance?.title, phase?.title),
        guideBody: text(phase?.purpose, phase?.strongLearnerResponse),
        customerRemainsSilent: index === phases.length - 1 && !text(draft?.flow?.closingPartnerTurn),
        evaluationLinks: downloadablePhaseEvaluationLinks(phase?.evaluationLinks, sourceObjectives, objectives),
      };
    }),
    objectives,
    objectiveApprovalRequired: false,
    evaluation: {
      passingScore: Number.isFinite(draft?.evaluation?.passingScore) ? draft.evaluation.passingScore : 100,
    },
    compatibilityFacts: {
      address: text(draft?.facts?.address),
      medication: text(draft?.facts?.medication),
      urgency: text(draft?.facts?.urgency, draft?.scenario?.description),
      medicationOrProduct: text(draft?.scenario?.product),
      clinic: text(draft?.facts?.clinic),
      keyQuestion: text(draft?.facts?.keyQuestion),
      rootCauseBelief: text(draft?.facts?.rootCauseBelief),
      conditionalFollowUp: text(conditionalFollowUps[0]),
    },
    chat: {
      hotkeyProfile: draft?.chat?.hotkeyProfile === "rx" ? "rx" : "core",
      customerStarts: draft?.chat?.customerStarts !== false,
      standardText,
      standardTextDecision: standardText.length ? "approved" : "none",
      approvedResponseAssignments: approvedResponseAssignments(draft?.chat?.approvedResponseAssignments),
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
