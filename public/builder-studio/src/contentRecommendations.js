import { normalizeStudioDraft } from "./scenarioStudio.js";
import { containsAnyCompleteApprovedResponseTemplate } from "./approvedResponseTemplates.js";

const AUTHORING_TEXT_MAX_LENGTH = 12_000;
const AUTHORING_ID_MAX_LENGTH = 96;
const AUTHORING_PHASE_MAX_ITEMS = 12;
const AUTHORING_GUIDANCE_MAX_ITEMS = 24;
const MAX_CRITERIA_PER_OBJECTIVE = 8;
const RECOMMENDATION_FAILURE_MESSAGE = "Coach Chewy couldn't recommend content this time.";
const RECOMMENDATION_TIMEOUT_MESSAGE = "The recommendation is taking longer than expected.";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw new DOMException("The operation was aborted.", "AbortError");
}

function waitForPoll(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const onAbort = () => {
      clearTimeout(timer);
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollContentRecommendation({
  start,
  status,
  wait = waitForPoll,
  signal,
  maxPolls = 180,
} = {}) {
  const jobId = String(start?.jobId || "").trim().toLowerCase();
  if (!jobId || start?.status !== "pending" || typeof status !== "function") {
    throw new Error(RECOMMENDATION_FAILURE_MESSAGE);
  }
  const pollCap = Number.isInteger(maxPolls) && maxPolls > 0 ? maxPolls : 180;
  let pollAfterMs = Number(start.pollAfterMs) > 0 ? Number(start.pollAfterMs) : 1000;
  for (let poll = 0; poll < pollCap; poll += 1) {
    throwIfAborted(signal);
    await wait(pollAfterMs, signal);
    throwIfAborted(signal);
    const result = await status({ jobId, signal });
    throwIfAborted(signal);
    if (String(result?.jobId || "").trim().toLowerCase() !== jobId) {
      throw new Error(RECOMMENDATION_FAILURE_MESSAGE);
    }
    if (result.status === "succeeded" && result.recommendation) return result;
    if (result.status === "failed") throw new Error(RECOMMENDATION_FAILURE_MESSAGE);
    if (result.status !== "pending") {
      throw new Error("The service returned an unsupported recommendation status.");
    }
    pollAfterMs = Number(result.pollAfterMs) > 0 ? Number(result.pollAfterMs) : 1000;
  }
  throw new Error(RECOMMENDATION_TIMEOUT_MESSAGE);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) throw new Error("Provide a supported content recommendation.");
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error("Provide only supported recommendation fields.");
  }
}

function visibleText(value, label, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length > AUTHORING_TEXT_MAX_LENGTH ||
    value.trim() !== value ||
    (!allowEmpty && !value) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code >= 0 && code <= 8) || code === 11 || code === 12 ||
        (code >= 14 && code <= 31) || code === 127;
    })
  ) {
    throw new Error(`Provide bounded visible ${label}.`);
  }
  return value;
}

function authoringId(value, label) {
  const id = visibleText(value, label);
  if (id.length > AUTHORING_ID_MAX_LENGTH || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(id)) {
    throw new Error(`Provide a stable ${label}.`);
  }
  return id;
}

function recommendationPhases(draft) {
  const phases = draft?.flow?.phases;
  if (!Array.isArray(phases) || !phases.length || phases.length > AUTHORING_PHASE_MAX_ITEMS) {
    throw new Error("Provide 1 to 12 current conversation phases.");
  }
  const shaped = phases.map((phase) => {
    const guidance = (Array.isArray(phase?.coachGuidance?.bullets)
      ? phase.coachGuidance.bullets
      : []).flatMap((bullet) => {
      const parent = isPlainObject(bullet) ? bullet.text : bullet;
      const children = isPlainObject(bullet) && Array.isArray(bullet.children)
        ? bullet.children.map((child) => isPlainObject(child) ? child.text : child)
        : [];
      return [parent, ...children];
    }).filter((item) => String(item ?? "").trim()).slice(0, AUTHORING_GUIDANCE_MAX_ITEMS)
      .map((item) => visibleText(String(item), "phase guidance"));
    return {
      id: authoringId(phase?.id, "phase ID"),
      title: visibleText(phase?.title, "phase title"),
      partnerTurn: visibleText(phase?.partnerTurn, "Conversation Partner turn"),
      guidance
    };
  });
  if (new Set(shaped.map((phase) => phase.id)).size !== shaped.length) {
    throw new Error("Provide unique current phase IDs.");
  }
  return shaped;
}

function objectiveForId(draft, objectiveId) {
  const id = authoringId(objectiveId, "objective ID");
  const objective = (draft?.evaluation?.objectives || []).find((item) => item?.id === id);
  if (!objective) throw new Error("Choose a current objective.");
  return objective;
}

function responseForId(draft, responseId) {
  const id = authoringId(responseId, "approved response ID");
  const response = (draft?.chat?.standardText || []).find((item) => item?.id === id);
  if (!response) throw new Error("Choose a current approved response.");
  return response;
}

function phaseForId(draft, phaseId) {
  const id = authoringId(phaseId, "phase ID");
  const phase = (draft?.flow?.phases || []).find((item) => item?.id === id);
  if (!phase) throw new Error("Choose a current phase.");
  return phase;
}

function deidentificationConfirmation(draft) {
  const confirmed = draft?.source?.anonymized === true;
  if (!confirmed) {
    throw new Error("Confirm that the conversation details are fictional or de-identified.");
  }
  return confirmed;
}

export function recommendationRequestForObjective(draft, objectiveId) {
  const deidentificationConfirmed = deidentificationConfirmation(draft);
  const objective = objectiveForId(draft, objectiveId);
  return {
    kind: "objective_alignment",
    deidentificationConfirmed,
    phases: recommendationPhases(draft),
    objective: {
      id: authoringId(objective.id, "objective ID"),
      label: visibleText(objective.label, "objective label")
    }
  };
}

export function recommendationRequestForApprovedResponse(draft, responseId) {
  const deidentificationConfirmed = deidentificationConfirmation(draft);
  const response = responseForId(draft, responseId);
  return {
    kind: "approved_response_alignment",
    deidentificationConfirmed,
    phases: recommendationPhases(draft),
    approvedResponse: {
      id: authoringId(response.id, "approved response ID"),
      shortcut: visibleText(String(response.hotkey || "").toUpperCase(), "approved response shortcut"),
      category: visibleText(response.category || "Standard Text", "approved response category"),
      template: visibleText(response.template, "approved response template")
    }
  };
}

function assertTextExcludesSelectedTemplates(draft, value) {
  const includesSelectedTemplate = containsAnyCompleteApprovedResponseTemplate(
    value,
    (draft?.chat?.standardText || []).map((response) => response?.template),
  );
  if (includesSelectedTemplate) {
    throw new Error("Keep the full approved response template out of Coach Chewy guidance.");
  }
}

export function validateContentRecommendation(draft, recommendation) {
  if (!isPlainObject(recommendation)) {
    throw new Error("Provide a supported content recommendation.");
  }
  phaseForId(draft, recommendation.phaseId);
  if (recommendation.kind === "objective_alignment") {
    exactKeys(recommendation, [
      "kind",
      "objective",
      "phaseId",
      "guidanceInstruction",
      "rationale"
    ]);
    exactKeys(recommendation.objective, ["id", "label", "criterion"]);
    const objective = objectiveForId(draft, recommendation.objective.id);
    const safe = {
      kind: "objective_alignment",
      objective: {
        id: authoringId(recommendation.objective.id, "objective ID"),
        label: visibleText(recommendation.objective.label, "objective label"),
        criterion: visibleText(recommendation.objective.criterion, "objective criterion")
      },
      phaseId: authoringId(recommendation.phaseId, "phase ID"),
      guidanceInstruction: visibleText(
        recommendation.guidanceInstruction,
        "Coach Chewy instruction",
      ),
      rationale: visibleText(recommendation.rationale, "recommendation rationale")
    };
    if (safe.objective.label !== String(objective.label || "")) {
      throw new Error("The recommendation no longer matches the current objective.");
    }
    assertTextExcludesSelectedTemplates(draft, safe.guidanceInstruction);
    assertTextExcludesSelectedTemplates(draft, safe.rationale);
    return safe;
  }
  if (recommendation.kind === "approved_response_alignment") {
    exactKeys(recommendation, [
      "kind",
      "responseId",
      "phaseId",
      "guidanceInstruction",
      "rationale"
    ]);
    responseForId(draft, recommendation.responseId);
    const safe = {
      kind: "approved_response_alignment",
      responseId: authoringId(recommendation.responseId, "approved response ID"),
      phaseId: authoringId(recommendation.phaseId, "phase ID"),
      guidanceInstruction: visibleText(
        recommendation.guidanceInstruction,
        "Coach Chewy instruction",
      ),
      rationale: visibleText(recommendation.rationale, "recommendation rationale")
    };
    assertTextExcludesSelectedTemplates(draft, safe.guidanceInstruction);
    assertTextExcludesSelectedTemplates(draft, safe.rationale);
    return safe;
  }
  throw new Error("Choose a supported content recommendation kind.");
}

function normalizeEntityId(value, fallback = "item") {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "item";
  return normalized.slice(0, AUTHORING_ID_MAX_LENGTH).replace(/_+$/gu, "");
}

function uniqueEntityId(existingIds, requested, fallback) {
  const used = new Set(existingIds);
  const base = normalizeEntityId(requested, fallback);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base.slice(0, AUTHORING_ID_MAX_LENGTH - String(suffix).length - 1)}_${suffix}`)) {
    suffix += 1;
  }
  return `${base.slice(0, AUTHORING_ID_MAX_LENGTH - String(suffix).length - 1)}_${suffix}`;
}

function criterionId(criterion) {
  return isPlainObject(criterion) ? String(criterion.id || "") : "";
}

function linkCriterionToPhase(phase, objectiveId, targetCriterionId) {
  phase.evaluationLinks = clone(Array.isArray(phase.evaluationLinks) ? phase.evaluationLinks : []);
  const linkIndex = phase.evaluationLinks.findIndex((link) => link.objectiveId === objectiveId);
  if (linkIndex < 0) {
    phase.evaluationLinks.push({ objectiveId, criterionIds: [targetCriterionId] });
    return;
  }
  const link = phase.evaluationLinks[linkIndex];
  phase.evaluationLinks[linkIndex] = {
    ...link,
    criterionIds: [...new Set([...(link.criterionIds || []), targetCriterionId])]
  };
}

function instructionKey(value) {
  return String(value || "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function addObjectiveGuidance(phase, objectiveId, instruction) {
  phase.coachGuidance ||= { title: phase.title || "Coach Chewy Guidance", bullets: [] };
  phase.coachGuidance.bullets = clone(
    Array.isArray(phase.coachGuidance.bullets) ? phase.coachGuidance.bullets : [],
  );
  const existing = new Set(phase.coachGuidance.bullets.flatMap((bullet) => {
    if (!isPlainObject(bullet)) return [instructionKey(bullet)];
    return [
      instructionKey(bullet.text || bullet.body),
      ...(Array.isArray(bullet.children)
        ? bullet.children.map((child) => instructionKey(isPlainObject(child) ? child.text : child))
        : [])
    ];
  }));
  if (existing.has(instructionKey(instruction))) return;
  const ids = phase.coachGuidance.bullets.map((bullet) => bullet?.id).filter(Boolean);
  phase.coachGuidance.bullets.push({
    id: uniqueEntityId(
      ids,
      `guidance_${objectiveId}_${phase.id}`,
      "guidance_recommendation",
    ),
    text: instruction
  });
}

function assignmentId(assignments, responseId, phaseId) {
  return uniqueEntityId(
    assignments.map((assignment) => assignment?.id).filter(Boolean),
    `assignment_${responseId}_${phaseId}`,
    "approved_response_assignment",
  );
}

function assignApprovedResponse(draft, responseId, phaseId, instruction) {
  draft.chat ||= {};
  const remaining = clone(
    Array.isArray(draft.chat.approvedResponseAssignments)
      ? draft.chat.approvedResponseAssignments.filter((assignment) => assignment.responseId !== responseId)
      : [],
  );
  draft.chat.approvedResponseAssignments = [
    ...remaining,
    {
      id: assignmentId(remaining, responseId, phaseId),
      responseId,
      phaseId,
      instruction
    }
  ];
}

function selectedPhaseId(recommendation, options) {
  exactKeys(options, Object.hasOwn(options, "phaseId") ? ["phaseId"] : []);
  return Object.hasOwn(options, "phaseId") ? options.phaseId : recommendation.phaseId;
}

function normalizeAppliedDraft(draft) {
  const normalized = normalizeStudioDraft(draft);
  normalized.flow = clone(draft.flow);
  normalized.evaluation.objectives = clone(draft.evaluation?.objectives || []);
  return normalized;
}

export function applyContentRecommendation(draft, recommendation, options = {}) {
  const candidate = {
    ...recommendation,
    phaseId: selectedPhaseId(recommendation, options)
  };
  const safe = validateContentRecommendation(draft, candidate);
  const next = clone(draft);
  const phase = phaseForId(next, safe.phaseId);

  if (safe.kind === "approved_response_alignment") {
    assignApprovedResponse(
      next,
      safe.responseId,
      safe.phaseId,
      safe.guidanceInstruction,
    );
    return normalizeAppliedDraft(next);
  }

  const objective = objectiveForId(next, safe.objective.id);
  objective.criteria = clone(Array.isArray(objective.criteria) ? objective.criteria : []);
  let criterion = objective.criteria.find((item) =>
    isPlainObject(item) && !String(item.text || "").trim()
  );
  if (criterion) {
    criterion.text = safe.objective.criterion;
  } else {
    criterion = objective.criteria.find((item) =>
      instructionKey(isPlainObject(item) ? item.text : item) === instructionKey(safe.objective.criterion)
    );
  }
  if (!criterion) {
    if (objective.criteria.length >= MAX_CRITERIA_PER_OBJECTIVE) {
      throw new Error("This objective already has the maximum number of criteria.");
    }
    const allCriterionIds = (next.evaluation?.objectives || []).flatMap((item) =>
      (item.criteria || []).map(criterionId).filter(Boolean)
    );
    criterion = {
      id: uniqueEntityId(
        allCriterionIds,
        `${objective.id}_criterion_${objective.criteria.length + 1}`,
        `${objective.id}_criterion`,
      ),
      text: safe.objective.criterion
    };
    objective.criteria.push(criterion);
  }
  const targetCriterionId = authoringId(criterionId(criterion), "criterion ID");
  linkCriterionToPhase(phase, objective.id, targetCriterionId);
  addObjectiveGuidance(phase, objective.id, safe.guidanceInstruction);
  return normalizeAppliedDraft(next);
}

export function manualContentRecommendation(draft, options = {}) {
  exactKeys(options, ["kind", "sourceId", "phaseId"]);
  const phaseId = authoringId(options.phaseId, "phase ID");
  const sourceId = authoringId(options.sourceId, "recommendation source ID");
  phaseForId(draft, phaseId);
  const next = clone(draft);
  const phase = phaseForId(next, phaseId);

  if (options.kind === "objective_alignment") {
    const objective = objectiveForId(next, sourceId);
    const criterion = (objective.criteria || [])[0];
    const targetCriterionId = authoringId(criterionId(criterion), "criterion ID");
    linkCriterionToPhase(phase, objective.id, targetCriterionId);
    return next;
  }
  if (options.kind === "approved_response_alignment") {
    const response = responseForId(next, sourceId);
    const shortcut = visibleText(
      String(response.hotkey || "").toUpperCase(),
      "approved response shortcut",
    );
    const category = String(response.category || "").trim();
    const instruction = category
      ? `Use the approved ${shortcut} — ${category} response now.`
      : `Use the approved ${shortcut} response now.`;
    assignApprovedResponse(next, response.id, phase.id, instruction);
    return next;
  }
  throw new Error("Choose a supported content recommendation kind.");
}
