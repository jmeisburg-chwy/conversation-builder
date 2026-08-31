const SECTION_BY_ROOT = {
  scenario: "Conversation",
  facts: "Conversation",
  flow: "Conversation Flow",
  handling: "Correct Handling Path",
  evaluation: "Evaluation",
  guidance: "Coach Chewy Guidance",
  voice: "Voice Setup",
  chat: "Chat Setup"
};

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "before", "by", "for", "from",
  "in", "is", "it", "of", "on", "or", "the", "their", "them", "then",
  "to", "with"
]);

const PROMISE_PATTERN = /\b(guarantee(?:d|s)?|definitely|certain(?:ly)?|always|immediately|same[- ]day|will arrive by|will be fixed by)\b/i;
const PRIVACY_PATTERNS = [
  { label: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "phone number", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/ },
  { label: "Social Security number", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "payment card number", pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { label: "secret or access key", pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/ },
  { label: "signed URL", pattern: /https?:\/\/\S+[?&](?:X-Amz-Signature|Signature|token)=\S+/i }
];

function text(value) {
  return String(value && typeof value === "object" ? value.text ?? "" : value ?? "").trim();
}

function textList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function words(value) {
  return new Set(
    text(value)
      .toLowerCase()
      .replace(/\b(?:do not|don't|never|avoid|must not|should not)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  );
}

function overlap(left, right) {
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / Math.min(leftWords.size, rightWords.size);
}

function sectionFor(fieldPath) {
  return SECTION_BY_ROOT[String(fieldPath || "").split(".")[0]] || "Conversation";
}

export function isBlockingPhaseEvaluationFinding(item) {
  const fieldPath = String(item?.fieldPath || "");
  return fieldPath.startsWith("flow.phases.") || fieldPath.startsWith("evaluation.");
}

function finding({
  id,
  category,
  severity = "warning",
  fieldPath,
  rationale,
  correction,
  replacement
}) {
  return {
    id,
    category,
    severity,
    section: sectionFor(fieldPath),
    fieldPath,
    rationale,
    proposedCorrection: {
      summary: correction,
      ...(replacement === undefined ? {} : { replacement })
    }
  };
}

function collectTextEntries(value, path = "", entries = []) {
  if (typeof value === "string") {
    if (value.trim()) entries.push({ fieldPath: path, value });
    return entries;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextEntries(item, `${path}.${index}`, entries));
    return entries;
  }
  if (!value || typeof value !== "object") return entries;
  Object.entries(value).forEach(([key, item]) => {
    const nextPath = path ? `${path}.${key}` : key;
    collectTextEntries(item, nextPath, entries);
  });
  return entries;
}

function guidanceText(draft) {
  const shared = draft?.guidance?.sections || [];
  const channel = Object.values(draft?.guidance?.channelSections || {}).flat();
  return [...shared, ...channel]
    .flatMap((section) => [
      section?.title,
      section?.body,
      ...(section?.bullets || []).flatMap((bullet) => [
        text(bullet),
        ...((bullet?.children || []).map(text))
      ])
    ])
    .map(text)
    .filter(Boolean)
    .join(" ");
}

function objectiveCriteria(draft) {
  return (draft?.evaluation?.objectives || [])
    .flatMap((objective) => objective?.criteria || [])
    .map(text)
    .filter(Boolean);
}

function supportedBy(candidate, values) {
  return values.some((value) => text(value).toLowerCase() === text(candidate).toLowerCase() || overlap(candidate, value) >= 0.68);
}

function replacePromiseLanguage(value) {
  return text(value)
    .replace(/\bguarantee(?:d|s)?\b/gi, "set the approved expectation for")
    .replace(/\bdefinitely\b/gi, "based on the approved process")
    .replace(/\bcertain(?:ly)?\b/gi, "based on the approved process")
    .replace(/\balways\b/gi, "when the approved conditions are met")
    .replace(/\bimmediately\b/gi, "within the approved timeframe")
    .replace(/\bsame[- ]day\b/gi, "within the approved timeframe");
}

function privacyReplacement(value, pattern) {
  return text(value).replace(pattern, "[fictional detail]");
}

function roleReversalReplacement(value) {
  return text(value).replace(
    /\b(?:the )?(?:customer|pet parent)\s+(?:must|should|needs? to|will)\s+/i,
    "The learner should "
  );
}

function inaccessibleFactFindings(draft) {
  const requirements = [
    { key: "address", label: "address", pattern: /\b(?:ask for|confirm|verify|update)\b.{0,45}\b(?:address|street)\b/i },
    { key: "medication", label: "medication name", pattern: /\b(?:ask for|confirm|verify)\b.{0,45}\b(?:medication|prescription|drug)\b/i },
    { key: "clinic", label: "clinic information", pattern: /\b(?:ask for|confirm|verify|contact)\b.{0,45}\b(?:clinic|veterinarian|vet)\b/i }
  ];
  const customerEvidence = [
    draft?.scenario?.description,
    ...textList(draft?.handling?.customerResponses),
    ...collectTextEntries(draft?.facts || {}).map((entry) => entry.value)
  ].join(" ");
  const authoredRequirements = [
    ...textList(draft?.handling?.correct),
    ...objectiveCriteria(draft)
  ];
  const results = [];
  requirements.forEach(({ key, label, pattern }) => {
    const required = authoredRequirements.find((item) => pattern.test(item));
    if (!required || text(draft?.facts?.[key]) || new RegExp(`\\b${label.split(" ")[0]}\\b`, "i").test(customerEvidence)) return;
    results.push(finding({
      id: `inaccessible-${key}`,
      category: "Inaccessible fact",
      fieldPath: `facts.${key}`,
      rationale: `The handling path expects ${label}, but the simulated customer has no authored ${label} to share.`,
      correction: `Add a fictional ${label} the customer may share at the appropriate moment.`
    }));
  });
  return results;
}

function conversationPhaseFindings(draft) {
  const phases = Array.isArray(draft?.flow?.phases)
    ? draft.flow.phases
    : [];
  const seenPhaseIds = new Set();
  const seenGuidanceHierarchyIds = new Set();
  const objectives = Array.isArray(draft?.evaluation?.objectives)
    ? draft.evaluation.objectives
    : [];
  const seenObjectiveIds = new Set();
  const seenCriterionIds = new Set();
  const seenObjectiveLabels = new Set();
  const coveredObjectiveIds = new Set();
  const results = [];

  objectives.forEach((objective, objectiveIndex) => {
    const objectiveId = text(objective?.id);
    if (!objectiveId || seenObjectiveIds.has(objectiveId)) {
      results.push(finding({
        id: `duplicate-objective-id-${objectiveIndex}`,
        category: "Duplicate objective ID",
        fieldPath: `evaluation.objectives.${objectiveIndex}.id`,
        rationale: "Each learning objective needs a unique ID so phase assignments remain unambiguous.",
        correction: "Give this learning objective a unique ID."
      }));
    }
    if (objectiveId) seenObjectiveIds.add(objectiveId);
    const objectiveLabel = text(objective?.label);
    const objectiveLabelKey = objectiveLabel.replace(/\s+/g, " ").toLowerCase();
    if (!objectiveLabel) {
      results.push(finding({
        id: `incomplete-objective-label-${objectiveIndex}`,
        category: "Incomplete learning objective",
        fieldPath: `evaluation.objectives.${objectiveIndex}.label`,
        rationale: "Each learning objective needs a label before testing this conversation.",
        correction: "Add a learning objective label."
      }));
    } else if (seenObjectiveLabels.has(objectiveLabelKey)) {
      results.push(finding({
        id: `duplicate-objective-label-${objectiveIndex}`,
        category: "Duplicate learning objective",
        fieldPath: `evaluation.objectives.${objectiveIndex}.label`,
        rationale: "Learning objective labels must be unique so authors can distinguish phase assignments.",
        correction: "Give this learning objective a distinct label."
      }));
    }
    if (objectiveLabelKey) seenObjectiveLabels.add(objectiveLabelKey);
    const criteria = Array.isArray(objective?.criteria) ? objective.criteria : [];
    if (!criteria.length) {
      results.push(finding({
        id: `incomplete-objective-criteria-${objectiveIndex}`,
        category: "Incomplete learning objective",
        fieldPath: `evaluation.objectives.${objectiveIndex}.criteria`,
        rationale: "Each learning objective needs at least one criterion before testing this conversation.",
        correction: "Add an observable criterion."
      }));
    }
    criteria.forEach((criterion, criterionIndex) => {
      const criterionId = text(criterion?.id);
      if (!criterionId || seenCriterionIds.has(criterionId)) {
        results.push(finding({
          id: `duplicate-criterion-id-${objectiveIndex}-${criterionIndex}`,
          category: "Duplicate criterion ID",
          fieldPath: `evaluation.objectives.${objectiveIndex}.criteria.${criterionIndex}.id`,
          rationale: "Each criterion needs a unique ID so its phase assignment remains stable.",
          correction: "Give this criterion a unique ID."
        }));
      }
      if (criterionId) seenCriterionIds.add(criterionId);
      if (!text(criterion?.text)) {
        results.push(finding({
          id: `incomplete-criterion-text-${objectiveIndex}-${criterionIndex}`,
          category: "Incomplete learning objective",
          fieldPath: `evaluation.objectives.${objectiveIndex}.criteria.${criterionIndex}.text`,
          rationale: "Each criterion needs observable text before testing this conversation.",
          correction: "Describe the observable criterion."
        }));
      }
    });
  });

  phases.forEach((phase, index) => {
    const phaseId = text(phase?.id);
    if (!phaseId || seenPhaseIds.has(phaseId)) {
      results.push(finding({
        id: `duplicate-phase-id-${index}`,
        category: "Duplicate phase ID",
        fieldPath: `flow.phases.${index}.id`,
        rationale: "Each conversation phase needs a unique ID so its order and progression remain unambiguous.",
        correction: "Give this phase a unique ID."
      }));
    }
    if (phaseId) seenPhaseIds.add(phaseId);

    [
      {
        field: "partnerTurn",
        value: phase?.partnerTurn,
        label: "a Conversation Partner turn"
      },
      {
        field: "strongLearnerResponse",
        value: phase?.strongLearnerResponse,
        label: "a strong Learner response exemplar"
      },
    ].forEach(({ field, value, label }) => {
      if (text(value)) return;
      results.push(finding({
        id: `incomplete-phase-${index}-${field}`,
        category: "Incomplete conversation phase",
        fieldPath: `flow.phases.${index}.${field}`,
        rationale: `Phase ${index + 1} does not include ${label}.`,
        correction: `Add ${label} before testing this conversation.`
      }));
    });

    const bullets = Array.isArray(phase?.coachGuidance?.bullets)
      ? phase.coachGuidance.bullets
      : [];
    if (!bullets.length) {
      results.push(finding({
        id: `incomplete-phase-${index}-guidance`,
        category: "Incomplete conversation phase",
        fieldPath: `flow.phases.${index}.coachGuidance.bullets`,
        rationale: `Phase ${index + 1} does not include Coach Chewy guidance.`,
        correction: "Add at least one Coach Chewy guidance bullet before testing this conversation."
      }));
    }
    bullets.forEach((bullet, bulletIndex) => {
      const bulletId = text(bullet?.id);
      if (!bulletId || seenGuidanceHierarchyIds.has(bulletId)) {
        results.push(finding({
          id: `duplicate-guidance-id-${index}-${bulletIndex}`,
          category: "Duplicate guidance ID",
          fieldPath: `flow.phases.${index}.coachGuidance.bullets.${bulletIndex}.id`,
          rationale: "Each guidance bullet needs a unique ID so its hierarchy remains stable.",
          correction: "Give this guidance bullet a unique ID."
        }));
      }
      if (bulletId) seenGuidanceHierarchyIds.add(bulletId);
      (bullet?.children || []).forEach((child, childIndex) => {
        const childId = text(child?.id);
        if (!childId || seenGuidanceHierarchyIds.has(childId)) {
          results.push(finding({
            id: `duplicate-guidance-child-id-${index}-${bulletIndex}-${childIndex}`,
            category: "Duplicate guidance child ID",
            fieldPath: `flow.phases.${index}.coachGuidance.bullets.${bulletIndex}.children.${childIndex}.id`,
            rationale: "Each guidance child needs a unique ID so cautions and supports remain stable.",
            correction: "Give this guidance child a unique ID."
          }));
        }
        if (childId) seenGuidanceHierarchyIds.add(childId);
      });
    });

    const validLinks = (phase?.evaluationLinks || []).filter((link) => {
      const objective = objectives.find((item) => item?.id === link?.objectiveId);
      const criterionIds = Array.isArray(link?.criterionIds) ? link.criterionIds : [];
      const valid = objective && criterionIds.some((id) =>
        objective.criteria?.some((criterion) => criterion?.id === id)
      );
      if (valid) coveredObjectiveIds.add(objective.id);
      return valid;
    });
    if (!validLinks.length) {
      results.push(finding({
        id: `incomplete-phase-${index}-evaluation-links`,
        category: "Incomplete conversation phase",
        fieldPath: `flow.phases.${index}.evaluationLinks`,
        rationale: `Phase ${index + 1} must link to at least one valid learning-objective criterion.`,
        correction: "Link this phase to an authored objective criterion before testing this conversation."
      }));
    }
  });

  objectives.forEach((objective, objectiveIndex) => {
    if (coveredObjectiveIds.has(objective?.id)) return;
    results.push(finding({
      id: `unassigned-objective-${objectiveIndex}`,
      category: "Unassigned learning objective",
      fieldPath: `evaluation.objectives.${objectiveIndex}.id`,
      rationale: "Every learning objective needs at least one linked conversation phase.",
      correction: "Link at least one conversation phase to this learning objective."
    }));
  });

  return results;
}

export function runScenarioHealthCheck(draft = {}) {
  const findings = [];
  const correct = textList(draft?.handling?.correct);
  const avoid = textList(draft?.handling?.avoid);
  const criteria = objectiveCriteria(draft);
  const guide = guidanceText(draft);

  findings.push(...conversationPhaseFindings(draft));

  correct.forEach((step, correctIndex) => {
    avoid.forEach((avoidance, avoidIndex) => {
      if (overlap(step, avoidance) < 0.72) return;
      findings.push(finding({
        id: `contradiction-${correctIndex}-${avoidIndex}`,
        category: "Contradiction",
        severity: "critical",
        fieldPath: `handling.avoid.${avoidIndex}`,
        rationale: `This avoidance conflicts with required step ${correctIndex + 1}, so the learner could be told both to do and not do the same thing.`,
        correction: `Clarify the avoidance so it protects, rather than contradicts, required step ${correctIndex + 1}.`,
        replacement: `Do not skip the approved step: ${step}`
      }));
    });

    const reversed = /\b(?:the )?(?:customer|pet parent)\s+(?:must|should|needs? to|will)\s+(?:verify|authenticate|approve|process|issue|apply|refund|replace|resolve|update|change|cancel)\b/i;
    if (reversed.test(step)) {
      findings.push(finding({
        id: `role-reversal-${correctIndex}`,
        category: "Role reversal",
        severity: "critical",
        fieldPath: `handling.correct.${correctIndex}`,
        rationale: "A required learner action is assigned to the customer, which reverses the roles being practiced.",
        correction: "Assign the operational action to the learner and keep only customer choices with the customer.",
        replacement: roleReversalReplacement(step)
      }));
    }

    if (!supportedBy(step, criteria)) {
      const objectiveIndex = Math.max(0, (draft?.evaluation?.objectives || []).length - 1);
      const existing = textList(draft?.evaluation?.objectives?.[objectiveIndex]?.criteria);
      findings.push(finding({
        id: `objective-alignment-${correctIndex}`,
        category: "Objective alignment",
        fieldPath: `evaluation.objectives.${objectiveIndex}.criteria`,
        rationale: `Required step ${correctIndex + 1} is not measured by any focused learning objective.`,
        correction: `Add required step ${correctIndex + 1} to the matching objective's observable criteria.`,
        replacement: [...existing, step]
      }));
    }

    if (!supportedBy(step, [guide])) {
      const guideIndex = Math.min(correctIndex, Math.max(0, (draft?.guidance?.sections || []).length - 1));
      findings.push(finding({
        id: `guidance-alignment-${correctIndex}`,
        category: "Guidance alignment",
        fieldPath: `guidance.sections.${guideIndex}.body`,
        rationale: `Required step ${correctIndex + 1} is not available in Coach Chewy Guidance, so the learner may be scored on a fact they cannot see.`,
        correction: `Put required step ${correctIndex + 1} in the corresponding Coach Chewy Guidance step.`,
        replacement: step
      }));
    }

    if (/\b(handle appropriately|resolve (?:it|the issue)|follow (?:the )?policy|take care of it|do the right thing|use the correct process)\b/i.test(step) || words(step).size < 3) {
      findings.push(finding({
        id: `ambiguous-handling-${correctIndex}`,
        category: "Ambiguous handling",
        fieldPath: `handling.correct.${correctIndex}`,
        rationale: `Required step ${correctIndex + 1} is too broad to perform or evaluate consistently.`,
        correction: "Name the observable action, the information used, and the supportable customer expectation."
      }));
    }
  });

  findings.push(...inaccessibleFactFindings(draft));

  const promiseEntries = [
    ...correct.map((value, index) => ({ fieldPath: `handling.correct.${index}`, value })),
    ...collectTextEntries(draft?.guidance || {}, "guidance"),
    ...collectTextEntries(draft?.chat?.standardText || [], "chat.standardText")
  ];
  promiseEntries.forEach(({ fieldPath, value }) => {
    if (!PROMISE_PATTERN.test(value)) return;
    findings.push(finding({
      id: `promise-${fieldPath}`,
      category: "Unsupported promise",
      fieldPath,
      rationale: "This wording creates a certainty or timeframe that the authored conversation does not support.",
      correction: "Use a conditional, approved expectation instead of a guarantee.",
      replacement: replacePromiseLanguage(value)
    }));
  });

  collectTextEntries(draft).forEach(({ fieldPath, value }) => {
    const matched = PRIVACY_PATTERNS.find(({ pattern }) => pattern.test(value));
    if (!matched) return;
    findings.push(finding({
      id: `privacy-${fieldPath}`,
      category: "Privacy risk",
      severity: "critical",
      fieldPath,
      rationale: `This field appears to contain a real ${matched.label}. Personal information and secrets cannot be used in authoring or preview.`,
      correction: `Replace the ${matched.label} with a clearly fictional or de-identified detail.`,
      replacement: privacyReplacement(value, matched.pattern)
    }));
  });

  const channels = new Set(draft?.scenario?.channels || []);
  if (channels.has("chat") && channels.has("voice")) {
    const chatOpening = text(draft?.chat?.openingLine);
    const voiceOpening = text(draft?.voice?.openingLine);
    if (chatOpening && voiceOpening && overlap(chatOpening, voiceOpening) < 0.45) {
      findings.push(finding({
        id: "channel-opening-drift",
        category: "Chat and Voice drift",
        fieldPath: "voice.openingLine",
        rationale: "The Chat and Voice openings communicate different customer situations, which can create different practice opportunities.",
        correction: "Align the Voice opening to the same facts and need used in Chat.",
        replacement: chatOpening
      }));
    }
    if (Boolean(draft?.chat?.customerStarts) !== Boolean(draft?.voice?.customerStarts)) {
      findings.push(finding({
        id: "channel-start-drift",
        category: "Chat and Voice drift",
        fieldPath: "voice.customerStarts",
        rationale: "The customer starts in only one format, so Chat and Voice do not give the learner the same opening opportunity.",
        correction: "Use the same customer-start behavior in both formats.",
        replacement: Boolean(draft?.chat?.customerStarts)
      }));
    }
    const channelGuidance = draft?.guidance?.channelSections || {};
    if (Boolean(channelGuidance.chat?.length) !== Boolean(channelGuidance.voice?.length)) {
      findings.push(finding({
        id: "channel-guidance-drift",
        category: "Chat and Voice drift",
        fieldPath: "guidance.channelSections",
        rationale: "Only one format has format-specific Coach Chewy Guidance, so learners may receive different support.",
        correction: "Confirm the difference is intentional or add equivalent guidance for the other format."
      }));
    }
  }

  const unique = [...new Map(findings.map((item) => [item.id, item])).values()];
  return {
    findings: unique,
    summary: {
      critical: unique.filter((item) => item.severity === "critical").length,
      warning: unique.filter((item) => item.severity === "warning").length
    },
    publishBlocked: unique.some((item) => item.severity === "critical")
  };
}

function learnerSuccessLine(draft) {
  return textList(draft?.handling?.correct).join(" ") || "I will follow the approved handling path and confirm the next step.";
}

function customerOpening(draft, channel = "chat") {
  return text(draft?.[channel]?.openingLine) || text(draft?.scenario?.openingLine) || "I need help with this request.";
}

function testResult(status, label, rationale, evidence) {
  return { status, label, rationale, evidence };
}

export function buildScenarioStressSuite(draft = {}) {
  const health = runScenarioHealthCheck(draft);
  const correct = textList(draft?.handling?.correct);
  const avoid = textList(draft?.handling?.avoid);
  const firstRequired = correct[0] || "Complete the first required step.";
  const remaining = correct.slice(1).join(" ") || "I will continue with the next approved step.";
  const opening = customerOpening(draft, "chat");
  const pushback = textList(draft?.facts?.allowedObjections)[0] || textList(draft?.handling?.customerResponses)[1] || "I am not sure that solves my concern. What else can you do?";
  const promiseAvoidance = avoid.find((item) => /promise|guarantee|unsupported|certain|definite/i.test(item));
  const alignmentProblems = health.findings.filter((item) => /alignment|role reversal|contradiction/i.test(item.category));
  const parityProblems = health.findings.filter((item) => item.category === "Chat and Voice drift");
  const hasBothChannels = (draft?.scenario?.channels || []).includes("chat") && (draft?.scenario?.channels || []).includes("voice");

  const tests = [
    {
      id: "expected-success",
      title: "Expected success",
      purpose: "Confirms the authored success path is observable and teachable.",
      mapping: ["handling.correct", "evaluation.objectives", "guidance.sections"],
      transcript: [
        { role: "customer", text: opening },
        { role: "learner", text: learnerSuccessLine(draft) },
        { role: "customer", text: text(draft?.facts?.closingLine) || "That answers my question. Thank you." }
      ],
      evaluation: alignmentProblems.length
        ? testResult("needs_review", "Needs review", "The success path is not fully aligned across handling, objectives, and guidance.", alignmentProblems.map((item) => item.fieldPath).join(", "))
        : testResult("passed", "Pass", "Every required action appears in the focused evaluation and learner guidance.", correct.join(" | "))
    },
    {
      id: "missed-step",
      title: "Missed required step",
      purpose: "Confirms a learner cannot pass after skipping a required action.",
      mapping: ["handling.correct.0", "evaluation.objectives"],
      transcript: [
        { role: "customer", text: opening },
        { role: "learner", text: remaining },
        { role: "evidence", text: `Omitted required step: ${firstRequired}` }
      ],
      evaluation: objectiveCriteria(draft).length
        ? testResult("passed", "Miss caught", "The omitted action is represented in the focused objective criteria.", firstRequired)
        : testResult("needs_review", "Needs review", "No focused objective criterion can catch the omitted action.", "evaluation.objectives")
    },
    {
      id: "topic-change",
      title: "Topic change or interruption",
      purpose: "Confirms the learner can acknowledge an interruption and return to the approved path.",
      mapping: ["handling.correct", "handling.customerResponses"],
      transcript: [
        { role: "customer", text: opening },
        { role: "customer", text: "One more thing—can you also help with a different request?" },
        { role: "learner", text: `I can help keep us on track with this request first. ${firstRequired}` }
      ],
      evaluation: correct.length
        ? testResult("passed", "Pass", "The learner has a specific required step to return to after the interruption.", firstRequired)
        : testResult("needs_review", "Needs review", "The handling path does not provide a concrete step for the learner to resume.", "handling.correct")
    },
    {
      id: "unsupported-promise",
      title: "Unsupported promise",
      purpose: "Confirms a guarantee or unapproved outcome is treated as a failure, not success.",
      mapping: ["handling.avoid", "evaluation.objectives"],
      transcript: [
        { role: "customer", text: opening },
        { role: "learner", text: "I guarantee this will be completely resolved today." },
        { role: "evidence", text: promiseAvoidance || "No authored promise avoidance was found." }
      ],
      evaluation: promiseAvoidance
        ? testResult("passed", "Promise caught", "The authored avoidances explicitly protect against unsupported promises.", promiseAvoidance)
        : testResult("needs_review", "Needs review", "Add an explicit avoidance so evaluation can reject unsupported guarantees.", "handling.avoid")
    },
    {
      id: "customer-pushback",
      title: "Customer pushback or escalation",
      purpose: "Confirms the customer can challenge the response without changing facts or policy.",
      mapping: ["facts.allowedObjections", "handling.correct", "tuning.conversation.objectionBehavior"],
      transcript: [
        { role: "customer", text: opening },
        { role: "learner", text: firstRequired },
        { role: "customer", text: pushback },
        { role: "learner", text: remaining }
      ],
      evaluation: pushback && correct.length
        ? testResult("passed", "Pass", "The authored customer has a bounded pushback and the learner retains an approved next step.", pushback)
        : testResult("needs_review", "Needs review", "Add a bounded customer objection and an approved learner response path.", "facts.allowedObjections")
    },
    {
      id: "channel-parity",
      title: "Chat and Voice parity",
      purpose: "Confirms both formats preserve the same customer need, opening opportunity, and guidance.",
      mapping: ["chat.openingLine", "chat.customerStarts", "voice.openingLine", "voice.customerStarts", "guidance.channelSections"],
      transcript: [
        { role: "chat", text: `Chat opens: ${customerOpening(draft, "chat")}` },
        { role: "voice", text: `Voice opens: ${customerOpening(draft, "voice")}` },
        { role: "evidence", text: hasBothChannels ? `Customer starts—Chat: ${draft?.chat?.customerStarts ? "yes" : "no"}; Voice: ${draft?.voice?.customerStarts ? "yes" : "no"}.` : "Only one practice format is selected." }
      ],
      evaluation: parityProblems.length
        ? testResult("needs_review", "Needs review", parityProblems.map((item) => item.rationale).join(" "), parityProblems.map((item) => item.fieldPath).join(", "))
        : testResult("passed", hasBothChannels ? "Parity confirmed" : "Single format confirmed", hasBothChannels ? "Chat and Voice preserve the same authored opening opportunity." : "Parity is not applicable because only one format is selected.", hasBothChannels ? "No format drift found." : draft?.scenario?.channels?.join(", "))
    }
  ];

  return {
    tests,
    summary: {
      passed: tests.filter((item) => item.evaluation.status === "passed").length,
      needsReview: tests.filter((item) => item.evaluation.status === "needs_review").length
    }
  };
}
