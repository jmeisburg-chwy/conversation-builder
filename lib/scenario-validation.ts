import { BodyTooLargeError, readBodyBounded } from "./bounded-body";
import { objectiveFingerprint, type ObjectiveApprovalEvidence } from "./objective-approval";
import { findPrivacyIssues } from "./privacy";
import {
  composeScenarioFiles,
  SUPPORTED_VOICES,
  validateScenarioFiles,
  type StudioDraft,
  type ValidationIssue,
} from "./scenario-contract";
import {
  customerBehaviorRuleConflictsWithLearner,
  customerFollowUpContradictsRejectedOption,
  customerFollowUpConflictsWithLearner,
  findChatAdvanceRequirementQualityFindings,
  findNondeterministicResolutionStep,
  findOverlappingResolutionProhibitionGroups,
  findPreferenceResponseOrderConflicts,
  openingPreanswersRequiredPreference,
  operationalCriterionMatchingPhaseIndexes,
  repeatsOpening,
} from "./scenario-quality-guards";
import { approvedStandardTextPrivacySource } from "./standard-text-recommendations";

export function createValidateHandler() {
  return async function validate(request: Request): Promise<Response> {
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return errorResponse(415, "unsupported_media_type", "Send the builder draft as application/json.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readBodyBounded(request, 1_500_000)) as unknown;
    } catch (caught) {
      if (caught instanceof BodyTooLargeError) {
        return errorResponse(413, "request_too_large", "The builder draft is too large. Shorten it and try again.");
      }
      return errorResponse(400, "invalid_request", "Send a valid builder draft.");
    }

    const draft = extractDraft(payload);
    if (!draft) return errorResponse(400, "invalid_request", "Send a valid builder draft.");
    if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).deidentificationConfirmed !== true) {
      return errorResponse(400, "confirmation_required", "Confirm that the content is fictional or de-identified before validating downloads.");
    }

    const reviewedDraft = structuredClone(draft);
    delete reviewedDraft.sourceScenarios;
    delete reviewedDraft.chat.standardTextRecommendations;
    if (reviewedDraft.chat.standardTextDecision !== "approved") reviewedDraft.chat.standardText = [];
    const approvedPrivacySource = approvedStandardTextPrivacySource(draft.chat.standardText);
    const privacyAllowances = [
      { value: draft.sourceScenarios, codes: ["street_address", "service_identifier", "payment_last_four"], stringsOnly: true },
      { value: approvedPrivacySource },
    ];
    const privacyIssues: ValidationIssue[] = findPrivacyIssues({ draft: reviewedDraft }, { allowances: privacyAllowances }).map((issue) => ({
      code: `privacy_${issue.code}`,
      path: issue.path,
      message: "The draft contains personal or sensitive details.",
      fix: "Replace this value with fictional or de-identified information.",
    }));

    const draftIssues = validateDraftCompleteness(draft);
    const approvalIssues = validateObjectiveApproval(draft, extractObjectiveApproval(payload));
    const files = composeScenarioFiles(draft);
    const outputPrivacyIssues: ValidationIssue[] = findPrivacyIssues({ files }, { allowances: privacyAllowances }).map((issue) => ({
      code: `privacy_${issue.code}`,
      path: issue.path,
      message: "A downloadable file contains personal or sensitive details.",
      fix: "Replace the corresponding reviewed value with fictional or de-identified information.",
    }));
    const issues = [...privacyIssues, ...outputPrivacyIssues, ...draftIssues, ...approvalIssues, ...validateScenarioFiles(files)];
    if (issues.length > 0) {
      return Response.json(
        { ok: false, issues },
        { status: 422, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, issues: [], files },
      { headers: { "cache-control": "no-store" } },
    );
  };
}

function extractObjectiveApproval(payload: unknown): ObjectiveApprovalEvidence | null {
  if (!payload || typeof payload !== "object") return null;
  const evidence = (payload as Record<string, unknown>).objectiveApproval;
  if (!evidence || typeof evidence !== "object") return null;
  const value = evidence as Record<string, unknown>;
  if (typeof value.required !== "boolean" || typeof value.approved !== "boolean" || typeof value.fingerprint !== "string") return null;
  return value as unknown as ObjectiveApprovalEvidence;
}

function validateObjectiveApproval(draft: StudioDraft, evidence: ObjectiveApprovalEvidence | null): ValidationIssue[] {
  if (!evidence?.approved) {
    return [{
      code: "objective_approval_required",
      path: "draft.objectives",
      message: "Approve the current learning objectives before downloading.",
      fix: "Review every objective and select the approval checkbox.",
    }];
  }
  if (evidence.fingerprint !== objectiveFingerprint(draft.objectives)) {
    return [{
      code: "objective_approval_stale",
      path: "draft.objectives",
      message: "The learning objectives changed after approval.",
      fix: "Review the current objectives and approve them again.",
    }];
  }
  return [];
}

function extractDraft(payload: unknown): StudioDraft | null {
  if (!payload || typeof payload !== "object") return null;
  const draft = (payload as Record<string, unknown>).draft;
  return parseStudioDraft(draft);
}

export function parseStudioDraft(draft: unknown): StudioDraft | null {
  if (!draft || typeof draft !== "object") return null;
  const value = draft as Partial<StudioDraft>;
  const customer = value.customer as Partial<StudioDraft["customer"]> | undefined;
  const compatibility = value.compatibilityFacts as Partial<StudioDraft["compatibilityFacts"]> | undefined;
  if (
    typeof value.baseId !== "string" || typeof value.title !== "string"
    || typeof value.description !== "string" || typeof value.learnerGoal !== "string"
    || !Array.isArray(value.channels) || (value.agentType !== "Core" && value.agentType !== "Rx")
    || typeof value.topic !== "string" || typeof value.subtopic !== "string" || typeof value.teamAudience !== "string"
    || !customer || typeof customer.name !== "string" || typeof customer.petName !== "string"
    || typeof customer.tone !== "string" || typeof customer.goal !== "string" || typeof customer.openingLine !== "string"
    || !isStringArray(customer.facts) || !isStringArray(customer.revealOnlyWhenAsked) || !isStringArray(customer.objections)
    || !isStringArray(customer.behaviorRules) || !isStringArray(customer.conditionalFollowUps) || typeof customer.closingLine !== "string"
    || !isStringArray(value.correctProcess) || !isStringArray(value.prohibitedActions)
    || !Array.isArray(value.phases) || !value.phases.every(isPhaseDraft)
    || !Array.isArray(value.objectives) || !value.objectives.every(isObjectiveDraft)
    || (value.evaluation !== undefined && (!value.evaluation || typeof value.evaluation !== "object"
      || typeof value.evaluation.passingScore !== "number" || !Number.isFinite(value.evaluation.passingScore)))
    || !value.chat || (value.chat.hotkeyProfile !== "core" && value.chat.hotkeyProfile !== "rx")
    || (value.chat.customerStarts !== undefined && typeof value.chat.customerStarts !== "boolean")
    || !Array.isArray(value.chat.standardText) || !value.chat.standardText.every(isStandardTextDraft) || !isStandardTextDecision(value.chat.standardTextDecision)
    || (value.chat.standardTextRecommendations !== undefined && (!Array.isArray(value.chat.standardTextRecommendations) || !value.chat.standardTextRecommendations.every(isStandardTextDraft)))
    || (value.chat.approvedResponseAssignments !== undefined && (!Array.isArray(value.chat.approvedResponseAssignments) || !value.chat.approvedResponseAssignments.every(isApprovedResponseAssignmentDraft)))
    || !value.voice || typeof value.voice.selectedVoice !== "string" || typeof value.voice.speed !== "number" || !Number.isFinite(value.voice.speed)
    || (value.voice.experience !== undefined && !isVoiceExperienceDraft(value.voice.experience))
    || (value.objectiveApprovalRequired !== undefined && typeof value.objectiveApprovalRequired !== "boolean")
    || (value.sourceOverlay !== undefined && typeof value.sourceOverlay !== "boolean")
    || (value.sourceScenarios !== undefined && !isSourceScenarioMap(value.sourceScenarios))
    || (compatibility && (
      typeof compatibility.address !== "string" || typeof compatibility.medication !== "string"
      || typeof compatibility.urgency !== "string" || typeof compatibility.medicationOrProduct !== "string"
      || typeof compatibility.clinic !== "string"
      || (compatibility.keyQuestion !== undefined && typeof compatibility.keyQuestion !== "string")
      || (compatibility.rootCauseBelief !== undefined && typeof compatibility.rootCauseBelief !== "string")
      || (compatibility.conditionalFollowUp !== undefined && typeof compatibility.conditionalFollowUp !== "string")
    ))
  ) return null;
  return {
    ...value,
    objectiveApprovalRequired: value.objectiveApprovalRequired === true,
    compatibilityFacts: (compatibility as StudioDraft["compatibilityFacts"] | undefined) ?? {
      address: "",
      medication: "",
      urgency: value.description,
      medicationOrProduct: "",
      clinic: "",
    },
  } as StudioDraft;
}

function validateDraftCompleteness(draft: StudioDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (draft.sourceScenarios && draft.sourceOverlay !== true) {
    issues.push({ code: "source_review_required", path: "draft.sourceOverlay", message: "Imported scenarios must be regenerated into the reviewed Builder draft before download.", fix: "Return to Build and create the draft from the uploaded JSON." });
  }
  const requireText = (path: string, value: unknown, label: string) => {
    if (typeof value !== "string" || !value.trim()) {
      issues.push({ code: "required_value", path, message: `${label} is required.`, fix: `Add the ${label.toLowerCase()} before downloading.` });
    }
  };
  const requireLines = (path: string, value: unknown, label: string) => {
    if (!Array.isArray(value) || value.every((entry) => typeof entry !== "string" || !entry.trim())) {
      issues.push({ code: "required_list", path, message: `${label} needs at least one complete item.`, fix: `Add one ${label.toLowerCase()} item before downloading.` });
    }
  };

  requireText("draft.baseId", draft.baseId, "File base ID");
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(draft.baseId)) {
    issues.push({ code: "invalid_base_id", path: "draft.baseId", message: "The file base ID must use lower_snake_case.", fix: "Use lowercase letters, numbers, and underscores only." });
  }
  requireText("draft.title", draft.title, "Scenario title");
  requireText("draft.description", draft.description, "Description");
  requireText("draft.learnerGoal", draft.learnerGoal, "Learner goal");
  requireText("draft.topic", draft.topic, "Topic");
  requireText("draft.subtopic", draft.subtopic, "Subtopic");
  requireText("draft.teamAudience", draft.teamAudience, "Team audience");
  requireText("draft.customer.name", draft.customer.name, "Customer name");
  requireText("draft.customer.tone", draft.customer.tone, "Customer tone");
  requireText("draft.customer.goal", draft.customer.goal, "Customer goal");
  requireText("draft.customer.openingLine", draft.customer.openingLine, "Opening line");
  requireText("draft.customer.closingLine", draft.customer.closingLine, "Closing line");
  requireLines("draft.correctProcess", draft.correctProcess, "Correct process");
  const nondeterministicResolutionIndex = findNondeterministicResolutionStep(draft.correctProcess);
  if (nondeterministicResolutionIndex >= 0) {
    issues.push({
      code: "nondeterministic_resolution",
      path: `draft.correctProcess[${nondeterministicResolutionIndex}]`,
      message: "The correct process does not define one approved outcome.",
      fix: "Replace general options or next steps with the exact authorized action and expected result.",
    });
  }
  draft.correctProcess.forEach((action, index) => {
    if (!VAGUE_PROCESS_REFERENCE_PATTERN.test(action)) return;
    issues.push({
      code: "vague_process_reference",
      path: `draft.correctProcess[${index}]`,
      message: "The learner action refers to a process or policy without stating the approved action.",
      fix: "Replace the placeholder with the exact approved action, amount, destination, and timing that apply.",
    });
  });
  if (draft.evaluation && (draft.evaluation.passingScore < 1 || draft.evaluation.passingScore > 100)) {
    issues.push({
      code: "invalid_passing_score",
      path: "draft.evaluation.passingScore",
      message: "Passing score must be between 1 and 100.",
      fix: "Choose a passing score from 1 through 100.",
    });
  }
  if (draft.channels.length === 0 || draft.channels.some((channel) => channel !== "chat" && channel !== "voice")) {
    issues.push({ code: "channel_required", path: "draft.channels", message: "Choose at least one valid practice format.", fix: "Choose Chat, Voice, or both." });
  }

  if (draft.phases.length === 0) requireLines("draft.phases", draft.phases, "Conversation phase");
  const preferenceResponseOrderConflicts = new Set(
    findPreferenceResponseOrderConflicts(draft.customer.openingLine, draft.phases),
  );
  draft.phases.forEach((phase, index) => {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(phase.id)) {
      issues.push({ code: "invalid_phase_id", path: `draft.phases[${index}].id`, message: "Phase IDs must use lower_snake_case.", fix: "Use lowercase letters, numbers, and underscores only." });
    }
    requireText(`draft.phases[${index}].title`, phase?.title, "Phase title");
    if (phase.customerRemainsSilent) {
      if (index !== draft.phases.length - 1) {
        issues.push({ code: "silent_phase_must_be_final", path: `draft.phases[${index}].customerRemainsSilent`, message: "Only the final phase can end with the Conversation Partner remaining silent.", fix: "Move the silent learner-only action to the final phase or add the expected partner response." });
      }
      if (phase.partnerResponse.trim()) {
        issues.push({ code: "silent_phase_has_response", path: `draft.phases[${index}].partnerResponse`, message: "A silent final phase cannot also contain a Conversation Partner response.", fix: "Clear the response or turn off the remains-silent option." });
      }
    } else {
      requireText(`draft.phases[${index}].partnerResponse`, phase?.partnerResponse, "Conversation Partner response");
    }
    if (index === 0 && repeatsOpening(draft.customer.openingLine, phase.partnerResponse)) {
      issues.push({
        code: "repeated_customer_opening",
        path: "draft.phases[0].partnerResponse",
        message: "The first Conversation Partner response repeats the opening line.",
        fix: "Write what the Conversation Partner says after the Learner completes Phase 1.",
      });
    }
    if (openingPreanswersRequiredPreference(draft.customer.openingLine, phase.learnerActions)) {
      issues.push({
        code: "opening_preanswers_phase",
        path: "draft.customer.openingLine",
        message: "The opening reveals a customer preference that this phase requires the Learner to ask or confirm.",
        fix: "Remove that preference from the opening and reveal it in the Conversation Partner response after the Learner asks.",
      });
    }
    if (preferenceResponseOrderConflicts.has(index)) {
      issues.push({
        code: "phase_preempts_partner_preference",
        path: `draft.phases[${index}].learnerActions`,
        message: "This phase asks for an unearned customer preference and also requires an outcome action or recap before the Conversation Partner can answer.",
        fix: "Keep the preference question in this phase, let the Conversation Partner answer, and move outcome execution or recap into the next phase.",
      });
    }
    requireLines(`draft.phases[${index}].learnerActions`, phase?.learnerActions, "Learner action");
    phase.learnerActions.forEach((action, actionIndex) => {
      if (!VAGUE_PROCESS_REFERENCE_PATTERN.test(action)) return;
      issues.push({
        code: "vague_process_reference",
        path: `draft.phases[${index}].learnerActions[${actionIndex}]`,
        message: "The learner action refers to a process or policy without stating the approved action.",
        fix: "Replace the placeholder with the exact approved action, amount, destination, and timing that apply.",
      });
    });
    requireLines(`draft.phases[${index}].coachGuidance`, phase?.coachGuidance, "Coach Chewy guidance");
    if (draft.channels.includes("chat") && !phase.customerRemainsSilent) {
      const requirements = phase.chatAdvanceRequirements ?? [];
      if (!requirements.length) {
        issues.push({
          code: "chat_advance_requirements_required",
          path: `draft.phases[${index}].chatAdvanceRequirements`,
          message: "Each Chat phase needs explicit positive evidence before it can advance.",
          fix: "Regenerate the phase with one required phrase group for each independent learner concept.",
        });
      }
      const requirementIds = new Set<string>();
      requirements.forEach((requirement, requirementIndex) => {
        if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(requirement.id) || requirementIds.has(requirement.id)) {
          issues.push({
            code: "invalid_chat_advance_requirement",
            path: `draft.phases[${index}].chatAdvanceRequirements[${requirementIndex}].id`,
            message: "Every Chat advance requirement needs a unique lower_snake_case ID.",
            fix: "Regenerate the phase with unique requirement IDs.",
          });
        }
        requirementIds.add(requirement.id);
      });
      findChatAdvanceRequirementQualityFindings(requirements, draft.prohibitedActions).forEach((finding) => {
        const path = `draft.phases[${index}].chatAdvanceRequirements[${finding.requirementIndex}]${finding.phraseIndex === undefined ? "" : `.phrases[${finding.phraseIndex}]`}`;
        const details: Record<typeof finding.code, { message: string; fix: string }> = {
          chat_advance_requirement_alternatives: {
            message: "Each required Chat concept needs at least two nonblank natural phrase alternatives.",
            fix: "Add a second distinct way the Learner can express this same positive concept.",
          },
          blank_chat_advance_phrase: {
            message: "A Chat advance phrase cannot be blank.",
            fix: "Replace the blank entry with a natural positive learner phrase.",
          },
          brittle_chat_advance_phrase: {
            message: "This Chat advance phrase is a near-exact learner turn and is too brittle for Rise substring matching.",
            fix: "Replace it with a compact 2-6 word concept anchor; numeric anchors may be shorter.",
          },
          chat_advance_phrase_concept_mismatch: {
            message: "This Chat phrase does not express the semantic concept named by its required-concept ID.",
            fix: "Replace it with a compact phrase that expresses this requirement's amount, destination, timeline, preference, completion, closing, or empathy concept.",
          },
          generic_chat_advance_phrase: {
            message: "This Chat advance phrase is too generic or incidental to prove the required behavior.",
            fix: "Use a specific positive phrase tied to the required learner concept.",
          },
          overlapping_chat_advance_phrase: {
            message: "One learner phrase can satisfy more than one required Chat concept.",
            fix: "Use non-overlapping evidence so each required concept must be demonstrated separately.",
          },
          prohibited_chat_advance_phrase: {
            message: "A prohibited action or option cannot count as positive Chat evidence.",
            fix: "Replace it with evidence of the approved learner behavior.",
          },
        };
        issues.push({ code: finding.code, path, ...details[finding.code] });
      });
    }
  });
  const phaseIds = draft.phases.map((phase) => phase.id);
  phaseIds.forEach((id, index) => {
    if (phaseIds.indexOf(id) !== index) {
      issues.push({ code: "duplicate_phase_id", path: `draft.phases[${index}].id`, message: "Each phase needs a unique ID.", fix: "Give this phase a different lower_snake_case ID." });
    }
  });

  draft.objectives.forEach((objective, index) => {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(objective.id)) {
      issues.push({ code: "invalid_objective_id", path: `draft.objectives[${index}].id`, message: "Objective IDs must use lower_snake_case.", fix: "Use lowercase letters, numbers, and underscores only." });
    }
    requireText(`draft.objectives[${index}].label`, objective?.label, "Objective label");
    requireText(`draft.objectives[${index}].description`, objective?.description, "Objective description");
    requireLines(`draft.objectives[${index}].criteria`, objective?.criteria, "Observable criterion");
    objective.criteria.forEach((criterion, criterionIndex) => {
      if (/^\s*(?:you|your|yours|you(?:'|’)re|you(?:'|’)ll|you(?:'|’)ve)\b/i.test(criterion)) {
        issues.push({ code: "second_person_criterion", path: `draft.objectives[${index}].criteria[${criterionIndex}]`, message: "Observable criteria must use neutral imperative wording, not You or Your.", fix: "Start with an observable action such as Explain, Confirm, Ask, or Avoid." });
      }
      if (!startsWithImperativeAction(criterion)) {
        issues.push({ code: "non_imperative_criterion", path: `draft.objectives[${index}].criteria[${criterionIndex}]`, message: "Observable criteria must begin with an imperative action.", fix: "Start with an action such as Explain, Confirm, Ask, or Avoid." });
      }
    });
  });
  const objectiveIds = draft.objectives.map((objective) => objective.id);
  objectiveIds.forEach((id, index) => {
    if (objectiveIds.indexOf(id) !== index) {
      issues.push({ code: "duplicate_objective_id", path: `draft.objectives[${index}].id`, message: "Each objective needs a unique ID.", fix: "Give this objective a different lower_snake_case ID." });
    }
  });
  const linkedCriterionIds = new Set(
    draft.phases.flatMap((phase) => phase.evaluationLinks ?? []).flatMap((link) => link.criterionIds),
  );
  draft.objectives.forEach((objective, objectiveIndex) => {
    objective.criteria.forEach((_criterion, criterionIndex) => {
      const criterionId = `${objective.id}_criterion_${criterionIndex + 1}`;
      if (linkedCriterionIds.has(criterionId)) return;
      issues.push({
        code: "unlinked_objective_criterion",
        path: `draft.objectives[${objectiveIndex}].criteria[${criterionIndex}]`,
        message: "This observable criterion is not linked to a Conversation Phase.",
        fix: "Link the criterion to the phase where the Learner demonstrates it.",
      });
    });
  });
  draft.objectives.forEach((objective, objectiveIndex) => {
    objective.criteria.forEach((criterion, criterionIndex) => {
      const matchingPhaseIndexes = operationalCriterionMatchingPhaseIndexes(criterion, draft.phases);
      if (matchingPhaseIndexes === undefined) return;
      const criterionId = `${objective.id}_criterion_${criterionIndex + 1}`;
      const linkedPhaseIndexes = draft.phases.flatMap((phase, phaseIndex) =>
        (phase.evaluationLinks ?? []).some((link) => link.criterionIds.includes(criterionId)) ? [phaseIndex] : []
      );
      if (!linkedPhaseIndexes.length) return;
      if (matchingPhaseIndexes.length === 1
        && linkedPhaseIndexes.length === 1
        && matchingPhaseIndexes[0] === linkedPhaseIndexes[0]) return;
      issues.push({
        code: "linked_criterion_action_missing",
        path: `draft.objectives[${objectiveIndex}].criteria[${criterionIndex}]`,
        message: "This operational criterion must map to exactly one phase whose Learner action performs that outcome.",
        fix: "Keep the outcome action in one phase and link the criterion only to that phase.",
      });
    });
  });
  const objectiveBoundarySegments = draft.objectives.flatMap((objective, objectiveIndex) =>
    objective.criteria.map((value, criterionIndex) => ({
      value,
      path: `draft.objectives[${objectiveIndex}].criteria[${criterionIndex}]`,
    }))
  );
  const guideBoundarySegments = draft.phases.flatMap((phase, phaseIndex) => [
    ...(phase.guideBody ? [{ value: phase.guideBody, path: `draft.phases[${phaseIndex}].guideBody` }] : []),
    ...phase.learnerActions.map((value, actionIndex) => ({
      value,
      path: `draft.phases[${phaseIndex}].learnerActions[${actionIndex}]`,
    })),
    ...phase.coachGuidance.map((value, guidanceIndex) => ({
      value,
      path: `draft.phases[${phaseIndex}].coachGuidance[${guidanceIndex}]`,
    })),
  ]);
  const objectiveCoverage = objectiveBoundarySegments.map(({ value }) => value);
  const guideCoverage = guideBoundarySegments.map(({ value }) => value);
  findOverlappingResolutionProhibitionGroups(draft.prohibitedActions).forEach((group) => {
    issues.push({
      code: "overlapping_resolution_prohibitions",
      path: `draft.prohibitedActions[${group[1]}]`,
      message: "These prohibited resolution alternatives overlap and can create duplicate or conflicting boundaries.",
      fix: "Combine store credit, replacement, exchange, and other options outside the full refund into one composite boundary. Keep partial-refund and incorrect-amount constraints separate.",
    });
  });
  draft.prohibitedActions.forEach((action, index) => {
    if (!PROHIBITED_ACTION_NEGATIVE_POLARITY_PATTERN.test(action)) {
      issues.push({
        code: "positive_prohibited_action",
        path: `draft.prohibitedActions[${index}]`,
        message: "A prohibited action must use explicit negative wording.",
        fix: "Start with Do not, Avoid, or Never so the boundary cannot be interpreted as an approved action.",
      });
      return;
    }
    [...objectiveBoundarySegments, ...guideBoundarySegments].forEach(({ value, path }) => {
      if (PROHIBITED_ACTION_NEGATIVE_POLARITY_PATTERN.test(value)
        || prohibitedActionBodyKey(value) !== prohibitedActionBodyKey(action)) return;
      issues.push({
        code: "positive_prohibited_reference",
        path,
        message: "An approved learner action cannot positively instruct a prohibited action.",
        fix: `Replace this line with the explicit boundary: ${action}`,
      });
    });
    if (!isBoundaryCovered(action, objectiveCoverage) || !isBoundaryCovered(action, guideCoverage)) {
      issues.push({ code: "unmapped_prohibited_action", path: `draft.prohibitedActions[${index}]`, message: "Every prohibited action must appear in both the objective criteria and Coach Chewy guidance.", fix: "Add this boundary to an observable criterion and to the relevant guide section." });
    }
  });
  const learnerDiscoveryActions = [
    ...draft.phases.flatMap((phase) => phase.learnerActions),
    ...draft.objectives.flatMap((objective) => objective.criteria),
  ];
  const customerIntentSources = [
    draft.customer.openingLine,
    draft.customer.goal,
    ...draft.customer.objections,
  ];
  draft.customer.conditionalFollowUps.forEach((followUp, index) => {
    if (customerFollowUpConflictsWithLearner(followUp, learnerDiscoveryActions)) {
      issues.push({
        code: "customer_role_conflict",
        path: `draft.customer.conditionalFollowUps[${index}]`,
        message: "This follow-up assigns the Learner's discovery question to the Conversation Partner.",
        fix: "Rewrite it as the Conversation Partner's reaction or answer after the Learner asks the question.",
      });
    }
    if (customerFollowUpContradictsRejectedOption(followUp, customerIntentSources)) {
      issues.push({
        code: "contradictory_customer_follow_up",
        path: `draft.customer.conditionalFollowUps[${index}]`,
        message: "This follow-up requests an option the Conversation Partner already rejected.",
        fix: "Remove the follow-up or replace it with a question consistent with the Conversation Partner's stated choice.",
      });
    }
  });
  if (draft.compatibilityFacts.conditionalFollowUp
    && customerFollowUpContradictsRejectedOption(
      draft.compatibilityFacts.conditionalFollowUp,
      customerIntentSources,
    )) {
    issues.push({
      code: "contradictory_customer_follow_up",
      path: "draft.compatibilityFacts.conditionalFollowUp",
      message: "This follow-up requests an option the Conversation Partner already rejected.",
      fix: "Clear the follow-up or replace it with a question consistent with the Conversation Partner's stated choice.",
    });
  }
  draft.customer.behaviorRules.forEach((rule, index) => {
    if (!customerBehaviorRuleConflictsWithLearner(rule)) return;
    issues.push({
      code: "customer_role_conflict",
      path: `draft.customer.behaviorRules[${index}]`,
      message: "This rule assigns a Chewy-agent action to the Conversation Partner.",
      fix: "Rewrite it as the Conversation Partner's reaction, disclosure boundary, or emotional response.",
    });
  });
  if (draft.channels.includes("chat")) {
    if (draft.chat.standardTextDecision === "unreviewed") {
      issues.push({ code: "standard_text_decision_required", path: "draft.chat.standardTextDecision", message: "Choose whether this chat scenario uses Standard Text.", fix: "Select approved Standard Text or explicitly choose none." });
    }
    if (draft.chat.standardTextDecision === "approved" && draft.chat.standardText.length === 0) {
      issues.push({ code: "standard_text_required", path: "draft.chat.standardText", message: "Approved Standard Text needs at least one item.", fix: "Add an approved hotkey and template, or choose no Standard Text." });
    }
    if (draft.chat.standardTextDecision === "approved") {
      draft.chat.standardText.forEach((item, index) => {
        if (![item.hotkey, item.category, item.template, item.insertionMoment, item.customization].every((entry) => entry.trim())) {
          issues.push({ code: "invalid_standard_text", path: `draft.chat.standardText[${index}]`, message: "Each Standard Text item needs a hotkey, category, template, insertion moment, and customization guidance.", fix: "Complete every Standard Text field or remove the item." });
        }
      });
    }
  }
  if (draft.channels.includes("voice")) {
    requireText("draft.voice.selectedVoice", draft.voice.selectedVoice, "Selected voice");
    if (!SUPPORTED_VOICES.includes(draft.voice.selectedVoice as typeof SUPPORTED_VOICES[number])) {
      issues.push({ code: "invalid_voice", path: "draft.voice.selectedVoice", message: "Choose a voice supported by the Rise simulator.", fix: `Choose one of: ${SUPPORTED_VOICES.join(", ")}.` });
    }
    if (draft.voice.speed < 0.75 || draft.voice.speed > 1.25) {
      issues.push({ code: "invalid_voice_speed", path: "draft.voice.speed", message: "Voice speed must be between 0.75 and 1.25.", fix: "Choose a voice speed from 0.75 through 1.25." });
    }
    const completion = draft.voice.experience?.completion;
    if (completion && (completion.endDelayMs < 0 || completion.endDelayMs > 5000)) {
      issues.push({ code: "invalid_completion_delay", path: "draft.voice.experience.completion.endDelayMs", message: "Completion delay must be between 0 and 5000 milliseconds.", fix: "Choose a completion delay from 0 through 5000 milliseconds." });
    }
  }
  return issues;
}

function isPhaseDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const phase = value as Record<string, unknown>;
  return typeof phase.id === "string" && typeof phase.title === "string" && isStringArray(phase.learnerActions)
    && typeof phase.partnerResponse === "string" && isStringArray(phase.coachGuidance)
    && ["guideSourceLabel", "guideSource", "guideTitle", "guideBody", "managerGuidance"]
      .every((key) => phase[key] === undefined || typeof phase[key] === "string")
    && (phase.chatAdvanceRequirements === undefined || (
      Array.isArray(phase.chatAdvanceRequirements)
      && phase.chatAdvanceRequirements.every(isChatAdvanceRequirementDraft)
    ))
    && (phase.evaluationLinks === undefined || (Array.isArray(phase.evaluationLinks) && phase.evaluationLinks.every(isEvaluationLinkDraft)))
    && (phase.coachGuidanceHierarchy === undefined || (
      Array.isArray(phase.coachGuidanceHierarchy)
      && phase.coachGuidanceHierarchy.every(isGuidanceBulletDraft)
    ))
    && (phase.customerRemainsSilent === undefined || typeof phase.customerRemainsSilent === "boolean");
}

function isChatAdvanceRequirementDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const requirement = value as Record<string, unknown>;
  return typeof requirement.id === "string"
    && Array.isArray(requirement.phrases)
    && isStringArray(requirement.phrases);
}

function isGuidanceBulletDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bullet = value as Record<string, unknown>;
  return typeof bullet.id === "string"
    && typeof bullet.text === "string"
    && (bullet.children === undefined || (
      Array.isArray(bullet.children)
      && bullet.children.length > 0
      && bullet.children.every(isGuidanceChildDraft)
    ))
    && (bullet.systemReference === undefined || (
      Boolean(bullet.systemReference)
      && typeof bullet.systemReference === "object"
      && !Array.isArray(bullet.systemReference)
    ));
}

function isGuidanceChildDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const child = value as Record<string, unknown>;
  return typeof child.id === "string"
    && typeof child.text === "string"
    && (child.kind === "support" || child.kind === "caution")
    && (child.kindOverride === undefined || typeof child.kindOverride === "boolean");
}

function isEvaluationLinkDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return typeof link.objectiveId === "string" && isStringArray(link.criterionIds);
}

function isObjectiveDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const objective = value as Record<string, unknown>;
  return typeof objective.id === "string" && typeof objective.label === "string" && typeof objective.description === "string" && isStringArray(objective.criteria);
}

function isStandardTextDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (item.id === undefined || typeof item.id === "string")
    && typeof item.hotkey === "string" && typeof item.category === "string" && typeof item.template === "string"
    && typeof item.insertionMoment === "string" && typeof item.customization === "string"
    && isStringArray(item.notes) && typeof item.approvedGuidance === "string"
    && (item.recommendationReason === undefined || typeof item.recommendationReason === "string");
}

function isApprovedResponseAssignmentDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const assignment = value as Record<string, unknown>;
  return ["id", "responseId", "phaseId", "instruction"].every((key) => typeof assignment[key] === "string");
}

function isVoiceExperienceDraft(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const experience = value as Record<string, unknown>;
  if (typeof experience.customerStarts !== "boolean"
    || !["guideTitle", "guideTopNote", "pacing", "verbalGuidance", "endNote", "spokenTone"].every((key) => typeof experience[key] === "string")) return false;
  if (experience.completion === undefined) return true;
  if (!experience.completion || typeof experience.completion !== "object") return false;
  const completion = experience.completion as Record<string, unknown>;
  return typeof completion.enabled === "boolean" && typeof completion.autoEnd === "boolean"
    && typeof completion.endDelayMs === "number" && Number.isFinite(completion.endDelayMs)
    && typeof completion.endStatus === "string"
    && (completion.terminalCustomerPhrases === undefined || isStringArray(completion.terminalCustomerPhrases))
    && (completion.terminalAgentPhrases === undefined || isStringArray(completion.terminalAgentPhrases));
}

function isSourceScenarioMap(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([channel]) => channel !== "chat" && channel !== "voice")) return false;
  return entries.every(([channel, scenario]) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return false;
    const record = scenario as Record<string, unknown>;
    return typeof record.id === "string"
      && Array.isArray(record.channels) && record.channels.length === 1 && record.channels[0] === channel
      && ["catalog", "simulation", "runtime", "facts", "coaching", "conversationBetween", "frontend", "customer", "managerPreview"]
        .every((key) => Boolean(record[key]) && typeof record[key] === "object" && !Array.isArray(record[key]));
  });
}

function startsWithImperativeAction(value: string): boolean {
  const first = value.trim().toLowerCase().match(/^[a-z]+(?:-[a-z]+)?/)?.[0] || "";
  return IMPERATIVE_ACTIONS.has(first);
}

function isBoundaryCovered(action: string, segments: string[]): boolean {
  const tokens = meaningfulTokens(
    prohibitedActionBodyKey(action).replace(/\s+(?:instead\s+of|rather\s+than)\b.*$/iu, ""),
  );
  if (tokens.length === 0) return false;
  return segments.some((segment) => {
    const coverage = meaningfulTokens(segment);
    return PROHIBITED_ACTION_NEGATIVE_POLARITY_PATTERN.test(segment)
      && tokens.every((token) => coverage.some((candidate) => relatedToken(token, candidate)));
  });
}

function prohibitedActionBodyKey(value: string): string {
  return value
    .trim()
    .replace(/^\s*(?:avoid|do\s+not|don['’]t|must\s+not|never|no|refrain(?:\s+from)?)\s+/iu, "")
    .replace(PROHIBITED_ACTION_SUBJECT_NEGATIVE_PREFIX_PATTERN, "")
    .replace(PROHIBITED_ACTION_POSITIVE_SUBJECT_PREFIX_PATTERN, "")
    .replace(/\brather\s+than\b/giu, "instead of")
    .toLowerCase()
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set(["a", "an", "alternative", "and", "avoid", "do", "for", "must", "never", "no", "not", "of", "option", "or", "the", "to", "without"]);
  return value.toLowerCase().match(/[a-z0-9]+/g)?.map((token) => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token).filter((token) => token.length > 2 && !stopWords.has(token)) ?? [];
}

function relatedToken(left: string, right: string): boolean {
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.startsWith(right) || right.startsWith(left)));
}

const PROHIBITED_ACTION_SUBJECT_SOURCE = String.raw`(?:(?:the|a)\s+)?(?:learner|agent|representative|chewy (?:agent|representative))`;
const PROHIBITED_ACTION_SUBJECT_NEGATIVE_OPERATOR_SOURCE = String.raw`(?:(?:(?:must|should|will|can|could|would|may|shall|does?)\s+(?:not|never))|cannot|can['’]t|doesn['’]t|won['’]t|(?:could|would|should|must|shall)n['’]t|never|(?:(?:must|should|will|can|could|would|may|shall)\s+)?avoid(?:s|ing)?)`;
const PROHIBITED_ACTION_SUBJECT_NEGATIVE_PREFIX_PATTERN = new RegExp(
  String.raw`^\s*${PROHIBITED_ACTION_SUBJECT_SOURCE}\s+${PROHIBITED_ACTION_SUBJECT_NEGATIVE_OPERATOR_SOURCE}\s+`,
  "iu",
);
const PROHIBITED_ACTION_POSITIVE_SUBJECT_PREFIX_PATTERN = new RegExp(
  String.raw`^\s*${PROHIBITED_ACTION_SUBJECT_SOURCE}\s+(?:(?:must|should|will|can|could|would|may|shall)\s+)?`,
  "iu",
);
const PROHIBITED_ACTION_NEGATIVE_POLARITY_PATTERN = new RegExp(
  String.raw`^\s*(?:(?:avoid|do\s+not|don['’]t|must\s+not|never|no|refrain(?:\s+from)?)\b|${PROHIBITED_ACTION_SUBJECT_SOURCE}\s+${PROHIBITED_ACTION_SUBJECT_NEGATIVE_OPERATOR_SOURCE}\b)`,
  "iu",
);
const VAGUE_PROCESS_REFERENCE_PATTERN = /\b(?:as\s+per|per|according\s+to)\s+(?:(?:the|an)\s+)?(?:(?:correct|approved)\s+)?(?:process|policy|procedure|guidance)\b/i;
const IMPERATIVE_ACTIONS = new Set([
  "acknowledge", "ask", "avoid", "check", "clarify", "communicate", "complete", "confirm", "connect", "continue",
  "describe", "determine", "direct", "distinguish", "do", "end", "explain", "express", "focus", "give", "highlight", "identify",
  "include", "introduce", "keep", "maintain", "mention", "never", "obtain", "offer", "pause", "personalize", "position",
  "present", "process", "protect", "provide", "read", "reassure", "recap", "recognize", "remain", "request", "require", "respond",
  "restate", "review", "select", "share", "show", "state", "stop", "take", "thank", "update", "use", "verify", "wait",
  "inform", "issue",
  "warm-transfer",
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStandardTextDecision(value: unknown): boolean {
  return value === "unreviewed" || value === "approved" || value === "none";
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() || "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
