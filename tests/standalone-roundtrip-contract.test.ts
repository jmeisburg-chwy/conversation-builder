import assert from "node:assert/strict";
import test from "node:test";

import { composeScenarioFiles, importScenarioJson } from "../lib/scenario-contract";
import { objectiveFingerprint } from "../lib/objective-approval";
import { createValidateHandler } from "../lib/scenario-validation";
import { blockingPhaseEvaluationFindings } from "../public/builder-studio/app.js";
import { normalizeStudioDraft } from "../public/builder-studio/src/scenarioStudio.js";
import {
  authoringToStandaloneDraft,
  standaloneToAuthoringDraft,
} from "../public/builder-studio/src/standaloneAdapter.js";

test("records de-identification only after the creator explicitly confirms it", () => {
  assert.equal(standaloneToAuthoringDraft({}, {}).source.anonymized, false);
  assert.equal(standaloneToAuthoringDraft({}, { deidentificationConfirmed: false }).source.anonymized, false);
  assert.equal(standaloneToAuthoringDraft({}, { deidentificationConfirmed: true }).source.anonymized, true);
});

test("uses 100 when an authoring draft has no passing score", () => {
  const authoring = standaloneToAuthoringDraft({}, { deidentificationConfirmed: true });
  delete authoring.evaluation.passingScore;

  assert.equal(authoringToStandaloneDraft(authoring).evaluation.passingScore, 100);
});

test("preserves an unfinished Chat concept group until server validation rejects it", async () => {
  const standalone = {
    baseId: "refund_accuracy",
    title: "Refund accuracy",
    description: "Practice confirming and completing an approved refund.",
    learnerGoal: "Confirm the requested resolution and complete the refund accurately.",
    channels: ["chat"],
    agentType: "Core",
    topic: "Refunds",
    subtopic: "Damaged item",
    teamAudience: "Customer Care",
    customer: {
      name: "Jamie",
      petName: "Buddy",
      tone: "Disappointed",
      goal: "Receive the approved refund.",
      openingLine: "The dog food bag arrived torn.",
      facts: ["The bag is unusable."],
      revealOnlyWhenAsked: [],
      objections: [],
      behaviorRules: ["Remain disappointed until the learner confirms the refund."],
      conditionalFollowUps: [],
      closingLine: "Thank you.",
    },
    correctProcess: ["Confirm the refund request and complete the approved refund."],
    prohibitedActions: [],
    phases: [{
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: ["Confirm the refund request and complete the approved refund."],
      chatAdvanceRequirements: [
        { id: "refund_request", phrases: ["want a refund", "prefer a refund"] },
        { id: "refund_completion", phrases: [] },
      ],
      partnerResponse: "Thank you.",
      coachGuidance: ["Confirm the request, then complete the refund."],
    }],
    objectives: [{
      id: "refund_accuracy",
      label: "Refund accuracy",
      description: "Complete the approved refund.",
      criteria: ["Confirm the refund request and complete the approved refund."],
    }],
    objectiveApprovalRequired: false,
    compatibilityFacts: {
      address: "",
      medication: "",
      urgency: "The food is unusable.",
      medicationOrProduct: "Dog food",
      clinic: "",
    },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };

  const authoring = standaloneToAuthoringDraft(standalone);
  const normalized = normalizeStudioDraft(authoring);
  const downloadable = authoringToStandaloneDraft(normalized);
  const expectedRequirements = [
    { id: "refund_request", phrases: ["want a refund", "prefer a refund"] },
    { id: "refund_completion", phrases: [] },
  ];

  assert.deepEqual(authoring.flow.phases[0].chatAdvanceRequirements, expectedRequirements);
  assert.deepEqual(normalized.flow.phases[0].chatAdvanceRequirements, expectedRequirements);
  assert.deepEqual(downloadable.phases[0].chatAdvanceRequirements, expectedRequirements);

  const response = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadable,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadable.objectives),
      },
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string; path: string }) =>
    issue.code === "chat_advance_requirement_alternatives"
    && issue.path === "draft.phases[0].chatAdvanceRequirements[1]"
  ), true);
});

test("preserves Review/Edit scoring, opening, phase evaluation, and approved-response behavior in downloadable files", () => {
  const authoring = {
    scenario: {
      baseId: "late_order_recovery",
      title: "Late Order Recovery",
      description: "Practice resolving a delayed order without overpromising.",
      learnerGoal: "Set accurate expectations and explain the next step.",
      channels: ["chat", "voice"],
      agentType: "Core",
      topic: "Delivery / Tracking",
      subtopic: "Late delivery",
      teamAudience: "Customer Care",
      petName: "Milo",
      product: "Dog food",
    },
    partner: {
      name: "Jordan",
      mood: "Concerned but cooperative",
      personality: "Wants an accurate delivery update.",
      knows: ["The order is expected tomorrow."],
      withholds: ["Milo has food for two more days."],
      behaviorRules: ["Do not invent delivery details."],
    },
    handling: {
      correct: ["Acknowledge the concern.", "Set accurate expectations."],
      avoid: ["Do not guarantee delivery."],
      customerResponses: ["Yes, it is Milo's food order.", "Thank you for explaining."],
    },
    flow: {
      phases: [
        {
          id: "acknowledge",
          title: "Acknowledge",
          partnerTurn: "Milo's food was supposed to arrive yesterday. Can you help?",
          strongLearnerResponse: "Acknowledge the customer's concern.",
          chatAdvanceRequirements: [
            { id: "acknowledgement", phrases: ["sorry", "understand", "concern"] },
            { id: "delivery_issue", phrases: ["late order", "delayed order"] },
          ],
          coachGuidance: {
            title: "Acknowledge",
            bullets: [{
              id: "acknowledge_guidance",
              text: "Recognize the concern.",
              children: [
                { id: "acknowledge_support", text: "Use Jordan's name naturally.", kind: "support" },
                { id: "acknowledge_caution", text: "Do not guarantee the delivery date.", kind: "caution" },
              ],
            }],
          },
          evaluationLinks: [{ objectiveId: "set_expectations", criterionIds: ["acknowledge_concern"] }],
        },
        {
          id: "set_expectations",
          title: "Set expectations",
          partnerTurn: "Yes, it is Milo's food order.",
          strongLearnerResponse: "State the expected delivery date without guaranteeing it.",
          chatAdvanceRequirements: [
            { id: "expected_date", phrases: ["expected tomorrow", "arrive tomorrow"] },
          ],
          coachGuidance: { title: "Set expectations", bullets: [{ text: "Use expected, not guaranteed." }] },
          evaluationLinks: [{ objectiveId: "set_expectations", criterionIds: ["state_expected_date"] }],
        },
      ],
      closingPartnerTurn: "Thank you for explaining.",
    },
    facts: {
      address: "",
      medication: "",
      urgency: "The food order is delayed.",
      keyQuestion: "When will the food arrive?",
      rootCauseBelief: "The order may be lost.",
      allowedObjections: ["Can you guarantee tomorrow?"],
      closingLine: "Thank you for explaining.",
      clinic: "",
      conditionalFollowUp: "Ask what happens if the order is late again.",
    },
    evaluation: {
      mode: "focused_learning_objectives",
      passingScore: 92,
      objectives: [{
        id: "set_expectations",
        label: "Set expectations",
        description: "Give an accurate delivery update.",
        criteria: [
          { id: "acknowledge_concern", text: "Acknowledge the customer's concern." },
          { id: "state_expected_date", text: "State the expected delivery date without guaranteeing it." },
        ],
      }],
    },
    chat: {
      hotkeyProfile: "core",
      customerStarts: false,
      standardText: [{
        id: "response_de6",
        hotkey: "de6",
        category: "Shipping",
        template: "Your order is expected tomorrow.",
        notes: ["Approved response."],
      }],
      approvedResponseAssignments: [{
        id: "assignment_de6_expectations",
        responseId: "response_de6",
        phaseId: "set_expectations",
        instruction: "Use DE6 after explaining the expected delivery date.",
      }],
    },
    voice: {
      selectedVoice: "marin",
      speed: 1,
      customerStarts: true,
      pacing: "Use calm, natural pacing.",
    },
  };

  const standalone = authoringToStandaloneDraft(authoring);

  assert.equal(standalone.evaluation.passingScore, 92);
  assert.equal(standalone.chat.customerStarts, false);
  assert.equal(standalone.voice.experience.customerStarts, true);
  assert.deepEqual(standalone.phases[0].chatAdvanceRequirements, authoring.flow.phases[0].chatAdvanceRequirements);
  assert.deepEqual(standalone.phases[1].evaluationLinks, [
    { objectiveId: "set_expectations", criterionIds: ["set_expectations_criterion_2"] },
  ]);
  assert.deepEqual(standalone.chat.approvedResponseAssignments, [{
    id: "assignment_de6_expectations",
    responseId: "response_de6",
    phaseId: "set_expectations",
    instruction: "Use DE6 after explaining the expected delivery date.",
  }]);

  const files = composeScenarioFiles(standalone, { now: "2026-08-31T12:00:00.000Z" });
  const chat = files.find(({ scenario }) => scenario.channels[0] === "chat")?.scenario;
  const voice = files.find(({ scenario }) => scenario.channels[0] === "voice")?.scenario;
  assert.ok(chat);
  assert.ok(voice);

  assert.equal(chat.coaching.gradingModel.passingScore, 92);
  assert.equal(voice.coaching.gradingModel.passingScore, 92);
  assert.equal(chat.frontend.chat?.customerStarts, false);
  assert.equal((chat.frontend.chat?.initialTranscript as Array<Record<string, unknown>>)[0].role, "system");
  assert.equal(voice.frontend.voice?.customerStarts, true);
  assert.deepEqual(chat.simulation.managerOnlyIdealResponses[1].evaluationLinks, [
    { objectiveId: "set_expectations", criterionIds: ["set_expectations_criterion_2"] },
  ]);
  assert.deepEqual(chat.frontend.chat?.approvedResponseAssignments, standalone.chat.approvedResponseAssignments);
  assert.equal(
    (chat.frontend.chat?.guideSections as Array<Record<string, unknown>>)[1].bullets instanceof Array
      && ((chat.frontend.chat?.guideSections as Array<Record<string, unknown>>)[1].bullets as unknown[])
        .includes("Use DE6 after explaining the expected delivery date."),
    true,
  );

  const imported = importScenarioJson(JSON.stringify(files.map(({ scenario }) => scenario)), "improve");
  assert.equal(imported.draft.evaluation?.passingScore, 92);
  assert.equal(imported.draft.chat.customerStarts, false);
  assert.equal(imported.draft.voice.experience?.customerStarts, true);
  assert.deepEqual(imported.draft.phases[1].evaluationLinks, [
    { objectiveId: "set_expectations", criterionIds: ["set_expectations_criterion_2"] },
  ]);
  assert.deepEqual(
    imported.draft.phases[0].chatAdvanceRequirements?.map((requirement) => requirement.phrases),
    (authoring.flow.phases[0].chatAdvanceRequirements as Array<{ phrases: string[] }>).map((requirement) => requirement.phrases),
  );
  assert.deepEqual(imported.draft.chat.approvedResponseAssignments, standalone.chat.approvedResponseAssignments);

  const reopenedAuthoring = standaloneToAuthoringDraft(imported.draft);
  for (const phase of reopenedAuthoring.flow.phases) {
    for (const link of phase.evaluationLinks) {
      const objective = reopenedAuthoring.evaluation.objectives.find(({ id }: { id: string }) => id === link.objectiveId);
      const criterionIds = new Set(objective?.criteria.map(({ id }: { id: string }) => id) ?? []);
      assert.equal(link.criterionIds.every((id: string) => criterionIds.has(id)), true);
    }
  }
  assert.deepEqual(blockingPhaseEvaluationFindings(reopenedAuthoring), []);
  assert.deepEqual(reopenedAuthoring.flow.phases[0].coachGuidance.bullets[0], {
    id: "acknowledge_guidance",
    text: "Recognize the concern.",
    children: [
      { id: "acknowledge_support", text: "Use Jordan's name naturally.", kind: "support" },
      { id: "acknowledge_caution", text: "Do not guarantee the delivery date.", kind: "caution" },
    ],
  });
});

test("assigns every generated objective criterion to a phase", () => {
  const standalone = {
    baseId: "refund_accuracy",
    title: "Refund accuracy",
    description: "Practice an accurate refund.",
    learnerGoal: "Complete and explain the approved refund.",
    channels: ["chat"],
    agentType: "Core",
    topic: "Refunds",
    subtopic: "Damaged item",
    teamAudience: "Customer Care",
    customer: {
      name: "Jamie", petName: "Buddy", tone: "Disappointed", goal: "Receive the approved refund.",
      openingLine: "The food bag arrived torn.", facts: ["The bag is unusable."], revealOnlyWhenAsked: [], objections: [],
      behaviorRules: ["Remain disappointed until the learner confirms the refund."], conditionalFollowUps: [], closingLine: "Thank you.",
    },
    correctProcess: ["Issue a $24.99 refund to the original payment card and state that it will post within 3–5 business days."],
    prohibitedActions: ["Do not offer store credit or a replacement."],
    phases: [
      { id: "acknowledge", title: "Acknowledge", learnerActions: ["Acknowledge the damaged bag."], chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["sorry", "damaged bag"] }], partnerResponse: "It is unusable.", coachGuidance: ["Acknowledge the concern."] },
      { id: "confirm", title: "Confirm", learnerActions: ["Confirm the refund preference."], chatAdvanceRequirements: [{ id: "refund_preference", phrases: ["confirm", "refund"] }], partnerResponse: "I want a refund.", coachGuidance: ["Confirm the requested refund."] },
      { id: "complete", title: "Complete", learnerActions: ["Complete and explain the refund."], chatAdvanceRequirements: [{ id: "refund_complete", phrases: ["refund has been issued", "completed the refund"] }], partnerResponse: "Thank you.", coachGuidance: ["State the amount, destination, and timeline."] },
    ],
    objectives: [{
      id: "refund_process_accuracy",
      label: "Refund Process Accuracy",
      description: "Complete and explain the approved refund.",
      criteria: [
        "Acknowledge the damaged bag.",
        "Confirm the customer wants a refund.",
        "Issue the $24.99 refund.",
        "Inform the customer that the refund returns to the original payment card.",
        "State the 3–5 business-day timeline.",
      ],
    }],
    objectiveApprovalRequired: false,
    compatibilityFacts: { address: "", medication: "", urgency: "The food is unusable.", medicationOrProduct: "Dog food", clinic: "" },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };

  const authoring = standaloneToAuthoringDraft(standalone);
  const normalizedAuthoring = normalizeStudioDraft(authoring);
  const downloadable = authoringToStandaloneDraft(normalizedAuthoring);
  const authoringPhases = authoring.flow.phases as Array<{
    evaluationLinks: Array<{ criterionIds: string[] }>;
  }>;
  const linked = authoringPhases.flatMap((phase) => phase.evaluationLinks)
    .flatMap((link) => link.criterionIds);

  assert.deepEqual(downloadable.prohibitedActions, ["Do not offer store credit or a replacement."]);
  assert.deepEqual(linked, [
    "refund_process_accuracy_criterion_1",
    "refund_process_accuracy_criterion_2",
    "refund_process_accuracy_criterion_3",
    "refund_process_accuracy_criterion_4",
    "refund_process_accuracy_criterion_5",
    "refund_process_accuracy_criterion_6",
  ]);
});

test("nests generated prohibitions once and makes them scored guidance boundaries", () => {
  const standalone = {
    baseId: "delivery_expectations",
    title: "Delivery expectations",
    description: "Practice setting accurate delivery expectations.",
    learnerGoal: "Explain the expected delivery date without overpromising.",
    channels: ["chat"],
    agentType: "Core",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    teamAudience: "Customer Care",
    customer: {
      name: "Jordan", petName: "Milo", tone: "Concerned", goal: "Understand when the order should arrive.",
      openingLine: "When will Milo's order arrive?", facts: ["The order is expected tomorrow."], revealOnlyWhenAsked: [], objections: [],
      behaviorRules: ["Remain concerned until the learner explains the expected date."], conditionalFollowUps: [], closingLine: "Thank you.",
    },
    correctProcess: ["Explain that the order is expected tomorrow."],
    prohibitedActions: ["Do not guarantee the delivery date."],
    phases: [{
      id: "set_expectations",
      title: "Set expectations",
      learnerActions: ["Explain that the order is expected tomorrow."],
      chatAdvanceRequirements: [{ id: "expected_date", phrases: ["expected tomorrow"] }],
      partnerResponse: "Thank you for explaining.",
      coachGuidance: ["Use expected timing.", "Avoid guaranteeing the delivery date."],
    }],
    objectives: [{
      id: "set_expectations",
      label: "Set expectations",
      description: "Give an accurate delivery update.",
      criteria: ["Explain that the order is expected tomorrow."],
    }],
    objectiveApprovalRequired: false,
    compatibilityFacts: { address: "", medication: "", urgency: "The order is late.", medicationOrProduct: "Dog food", clinic: "" },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };

  const authoring = standaloneToAuthoringDraft(standalone);
  const normalized = normalizeStudioDraft(authoring);
  const downloadable = authoringToStandaloneDraft(normalized);
  const bullets = authoring.flow.phases[0].coachGuidance.bullets as Array<{
    text: string;
    children?: Array<{ text: string; kind: string }>;
  }>;
  const cautionChildren = bullets.flatMap((bullet) => bullet.children ?? [])
    .filter((child) => child.kind === "caution");

  assert.equal(authoring.flow.cautionsAuthoritative, true);
  assert.deepEqual(bullets.map((bullet) => bullet.text), ["Use expected timing."]);
  assert.deepEqual(cautionChildren.map((child) => child.text), ["Do not guarantee the delivery date."]);
  assert.deepEqual(
    authoring.evaluation.objectives[0].criteria.map((criterion: { text: string }) => criterion.text),
    ["Explain that the order is expected tomorrow.", "Do not guarantee the delivery date."],
  );
  assert.deepEqual(authoring.flow.phases[0].evaluationLinks, [{
    objectiveId: "set_expectations",
    criterionIds: ["set_expectations_criterion_1", "set_expectations_criterion_2"],
  }]);
  assert.deepEqual(
    normalized.handling.correct,
    ["Explain that the order is expected tomorrow."],
    "a scored prohibition must not be projected into the positive handling path",
  );
  assert.deepEqual(downloadable.prohibitedActions, ["Do not guarantee the delivery date."]);
  assert.equal(
    downloadable.phases[0].coachGuidance.filter((item: string) => item === "Do not guarantee the delivery date.").length,
    1,
  );
});

test("does not duplicate equivalent option and alternative boundary wording", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_boundaries",
    prohibitedActions: ["Avoid offering store credit or replacements as alternatives."],
    phases: [{
      id: "confirm_refund",
      title: "Confirm refund",
      learnerActions: ["Confirm the customer wants a refund."],
      chatAdvanceRequirements: [{ id: "refund", phrases: ["want a refund", "prefer a refund"] }],
      partnerResponse: "Yes, I want a refund.",
      coachGuidance: ["Avoid offering store credit or replacement options."],
    }],
    objectives: [{
      id: "refund_resolution",
      label: "Refund resolution",
      description: "Complete the approved refund without offering alternatives.",
      criteria: ["Avoid offering or mentioning replacement or store credit options."],
    }],
  });
  const criteria = authoring.evaluation.objectives.flatMap((objective: { criteria: Array<{ text: string }> }) =>
    objective.criteria.map((criterion) => criterion.text)
  );
  const cautions = authoring.flow.phases.flatMap((phase: { coachGuidance: { bullets: Array<{ children?: Array<{ text: string; kind: string }> }> } }) =>
    phase.coachGuidance.bullets.flatMap((bullet) => bullet.children ?? [])
  ).filter((child: { kind: string }) => child.kind === "caution");

  assert.deepEqual(criteria, ["Avoid offering store credit or replacements as alternatives."]);
  assert.equal(cautions.length, 1);
  assert.match(cautions[0].text, /store credit/i);
  assert.match(cautions[0].text, /replacement/i);
});

test("keeps an equivalent prohibited boundary once in scoring and once in each relevant phase", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_boundary_deduplication",
    prohibitedActions: ["Avoid offering store credit or replacements as alternatives."],
    phases: [
      {
        id: "confirm_refund",
        title: "Confirm the refund preference",
        learnerActions: ["Confirm that the customer wants a refund."],
        partnerResponse: "Yes, I want a refund.",
        coachGuidance: [
          "Confirm the requested refund.",
          "Avoid offering store credit or replacement alternatives.",
          "Do not suggest a replacement product or store credit option.",
        ],
      },
      {
        id: "complete_refund",
        title: "Complete the refund",
        learnerActions: ["Complete the approved refund."],
        partnerResponse: "Thank you.",
        coachGuidance: [
          "Complete only the approved resolution.",
          "Do not offer replacement items or store credit.",
          "Avoid suggesting store credit or a replacement option.",
        ],
      },
    ],
    objectives: [
      {
        id: "refund_resolution",
        label: "Refund resolution",
        description: "Complete the requested refund.",
        criteria: [
          "Confirm that the customer wants a refund.",
          "Avoid offering store credit or replacement products.",
        ],
      },
      {
        id: "approved_boundary",
        label: "Approved boundary",
        description: "Stay within the approved resolution.",
        criteria: ["Do not suggest replacement items or store credit options."],
      },
    ],
  });

  const prohibitedCriteria = authoring.evaluation.objectives
    .flatMap((objective: { criteria: Array<{ text: string }> }) => objective.criteria)
    .filter((criterion: { text: string }) => /^(?:avoid|do not)\b/i.test(criterion.text));
  const phaseCautions = authoring.flow.phases.map((phase: {
    coachGuidance: { bullets: Array<{ children?: Array<{ text: string; kind: string }> }> };
  }) => phase.coachGuidance.bullets
    .flatMap((bullet) => bullet.children ?? [])
    .filter((child) => child.kind === "caution"));

  assert.equal(prohibitedCriteria.length, 1);
  assert.match(prohibitedCriteria[0].text, /store credit/i);
  assert.match(prohibitedCriteria[0].text, /replacement/i);
  assert.deepEqual(phaseCautions.map((cautions: Array<{ text: string }>) => cautions.length), [1, 1]);
  phaseCautions.flat().forEach((caution: { text: string }) => {
    assert.match(caution.text, /store credit/i);
    assert.match(caution.text, /replacement/i);
  });
});

test("replaces split boundary criteria and cautions with one authoritative compound action", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_split_boundary",
    prohibitedActions: ["Do not offer store credit or a replacement."],
    phases: [{
      id: "confirm_refund",
      title: "Confirm the refund",
      learnerActions: ["Confirm that the customer wants a refund."],
      partnerResponse: "Yes, I want a refund.",
      coachGuidance: [
        "Confirm the customer's requested outcome.",
        "Do not offer store credit.",
        "Do not offer a replacement.",
      ],
    }],
    objectives: [{
      id: "refund_resolution",
      label: "Refund resolution",
      description: "Complete only the approved refund.",
      criteria: [
        "Confirm that the customer wants a refund.",
        "Do not offer store credit.",
        "Do not offer a replacement.",
      ],
    }],
  });

  const negativeCriteria = authoring.evaluation.objectives
    .flatMap((objective: { criteria: Array<{ text: string }> }) => objective.criteria)
    .filter((criterion: { text: string }) => /^(?:avoid|do not)\b/i.test(criterion.text));
  const cautions = authoring.flow.phases[0].coachGuidance.bullets
    .flatMap((bullet: { children?: Array<{ text: string; kind: string }> }) => bullet.children ?? [])
    .filter((child: { kind: string }) => child.kind === "caution");

  assert.deepEqual(negativeCriteria.map((criterion: { text: string }) => criterion.text), [
    "Do not offer store credit or a replacement.",
  ]);
  assert.deepEqual(cautions.map((caution: { text: string }) => caution.text), [
    "Do not offer store credit or a replacement.",
  ]);
});

test("maps every generated criterion exactly once to the phase with matching learner behavior", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_semantic_phase_links",
    phases: [
      {
        id: "acknowledge_and_confirm",
        title: "Acknowledge and confirm the refund",
        learnerActions: [
          "Acknowledge the torn bag, express empathy, and confirm that the customer wants a refund.",
        ],
        partnerResponse: "Yes, I want a refund.",
        coachGuidance: ["Recognize the damaged bag, show understanding, and confirm the requested resolution."],
      },
      {
        id: "complete_refund",
        title: "Complete and explain the refund",
        learnerActions: [
          "Issue the $32.49 refund to the original payment card and state the 3–5 business-day timeline.",
        ],
        partnerResponse: "Thank you.",
        coachGuidance: ["State the exact refund amount, payment destination, and posting timeline."],
      },
    ],
    objectives: [
      {
        id: "acknowledge_damage",
        label: "Acknowledge damage",
        description: "Recognize the customer's experience.",
        criteria: ["Acknowledge the torn bag.", "Express understanding of the customer's frustration."],
      },
      {
        id: "confirm_resolution",
        label: "Confirm resolution",
        description: "Confirm the requested outcome.",
        criteria: ["Ask whether the customer wants a refund."],
      },
      {
        id: "refund_accuracy",
        label: "Refund accuracy",
        description: "Complete and explain the approved refund.",
        criteria: [
          "Issue the $32.49 refund.",
          "State that the refund returns to the original payment card.",
          "State the 3–5 business-day timeline.",
        ],
      },
    ],
    prohibitedActions: [],
  });

  const linkedByPhase = authoring.flow.phases.map((phase: {
    evaluationLinks: Array<{ criterionIds: string[] }>;
  }) => phase.evaluationLinks.flatMap((link) => link.criterionIds));
  const allLinked = linkedByPhase.flat();

  assert.deepEqual(linkedByPhase, [
    [
      "acknowledge_damage_criterion_1",
      "acknowledge_damage_criterion_2",
      "confirm_resolution_criterion_1",
    ],
    [
      "refund_accuracy_criterion_1",
      "refund_accuracy_criterion_2",
      "refund_accuracy_criterion_3",
    ],
  ]);
  assert.equal(new Set(allLinked).size, allLinked.length);
});

test("keeps positive guidance with contrast wording as positive guidance", () => {
  for (const guidance of [
    "Process the refund without changing the destination.",
    "Use the original payment card rather than store credit.",
    "Issue the approved refund instead of store credit.",
  ]) {
    const authoring = standaloneToAuthoringDraft({
      baseId: "refund_accuracy",
      title: "Refund accuracy",
      description: "Practice an accurate refund.",
      learnerGoal: "Complete and explain the approved refund.",
      channels: ["chat"],
      customer: {
        name: "Jamie",
        tone: "Disappointed",
        openingLine: "The food bag arrived torn.",
        behaviorRules: ["Remain disappointed until the learner confirms the refund."],
      },
      correctProcess: ["Issue the approved refund to the original payment card."],
      prohibitedActions: [],
      phases: [{
        id: "complete_refund",
        title: "Complete the refund",
        learnerActions: [guidance],
        chatAdvanceRequirements: [{ id: "refund_complete", phrases: ["refund issued", "refund completed"] }],
        partnerResponse: "Thank you.",
        coachGuidance: [guidance],
      }],
      objectives: [{
        id: "refund_accuracy",
        label: "Refund accuracy",
        description: "Complete the approved refund.",
        criteria: [guidance],
      }],
    });
    const bullets = authoring.flow.phases[0].coachGuidance.bullets as Array<{
      text: string;
      children?: Array<{ text: string; kind: string }>;
    }>;

    assert.deepEqual(bullets.map((bullet) => bullet.text), [guidance], guidance);
    assert.deepEqual(bullets.flatMap((bullet) => bullet.children ?? []), [], guidance);
    assert.deepEqual(authoring.handling.avoid, [], guidance);
  }
});

test("does not count positive contrast wording as prohibited-action coverage", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_boundary",
    title: "Refund boundary",
    description: "Practice an accurate refund.",
    learnerGoal: "Complete and explain the approved refund.",
    channels: ["chat"],
    customer: {
      name: "Jamie",
      tone: "Disappointed",
      openingLine: "The food bag arrived torn.",
      behaviorRules: ["Remain disappointed until the learner confirms the refund."],
    },
    correctProcess: ["Issue the approved refund to the original payment card."],
    prohibitedActions: ["Do not offer store credit instead of refund."],
    phases: [{
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: ["Issue the approved refund to the original payment card."],
      chatAdvanceRequirements: [{ id: "refund_complete", phrases: ["refund issued", "refund completed"] }],
      partnerResponse: "Thank you.",
      coachGuidance: ["Offer store credit instead of refund."],
    }],
    objectives: [{
      id: "refund_accuracy",
      label: "Refund accuracy",
      description: "Complete the approved refund.",
      criteria: ["Offer store credit instead of refund."],
    }],
  });

  const criteria = authoring.evaluation.objectives.flatMap((objective) =>
    objective.criteria.map((criterion) => criterion.text)
  );
  const cautions = authoring.flow.phases.flatMap((phase) =>
    phase.coachGuidance.bullets.flatMap((bullet) => bullet.children ?? [])
  ).filter((child) => child.kind === "caution");

  assert.equal(criteria.includes("Do not offer store credit instead of refund."), true);
  assert.equal(cautions.some((child) => child.text === "Do not offer store credit instead of refund."), true);
});

test("recognizes subject-led negative guidance without adding a duplicate caution", () => {
  const authoring = standaloneToAuthoringDraft({
    baseId: "delivery_boundary",
    title: "Delivery boundary",
    description: "Practice setting an accurate expectation.",
    learnerGoal: "Explain the expected delivery window without a promise.",
    channels: ["chat"],
    customer: {
      name: "Jamie",
      tone: "Concerned",
      openingLine: "When will my order arrive?",
      behaviorRules: ["Remain concerned until the learner explains the expected window."],
    },
    correctProcess: ["Explain the expected delivery window."],
    prohibitedActions: ["Do not promise a delivery timeline."],
    phases: [{
      id: "set_expectation",
      title: "Set the expectation",
      learnerActions: ["Explain the expected delivery window."],
      chatAdvanceRequirements: [{ id: "expected_window", phrases: ["expected window", "expected by"] }],
      partnerResponse: "Thank you for explaining.",
      coachGuidance: [
        "Explain the expected delivery window.",
        "The representative doesn't promise a delivery timeline.",
      ],
    }],
    objectives: [{
      id: "expectation_accuracy",
      label: "Expectation accuracy",
      description: "Set an accurate delivery expectation.",
      criteria: ["Do not promise a delivery timeline."],
    }],
  });

  const cautions = authoring.flow.phases.flatMap((phase) =>
    phase.coachGuidance.bullets.flatMap((bullet) => bullet.children ?? [])
  ).filter((child) => child.kind === "caution");

  assert.deepEqual(cautions.map((child) => child.text), ["Do not promise a delivery timeline."]);
  assert.equal(
    authoring.flow.phases[0].coachGuidance.bullets.some((bullet) =>
      bullet.text === "The representative doesn't promise a delivery timeline."
    ),
    false,
  );
});

test("removes a hidden customer-role inversion before validation and download", () => {
  const authoring = {
    scenario: {
      baseId: "missing_package",
      title: "Missing package",
      description: "Practice helping with a missing package.",
      learnerGoal: "Ask what the customer checked, then submit a replacement order.",
      channels: ["chat"],
      agentType: "Core",
      topic: "Delivery / Tracking",
      subtopic: "Missing package",
      teamAudience: "Customer Care",
    },
    partner: { name: "Alex", mood: "Concerned", personality: "Wants help." },
    flow: {
      phases: [{
        id: "discover",
        title: "Discover",
        partnerTurn: "My package says delivered, but I cannot find it.",
        strongLearnerResponse: "Ask what the customer has already checked for the package.",
        coachGuidance: { title: "Discover", bullets: [{ text: "Ask what they checked." }] },
      }],
      closingPartnerTurn: "Thank you.",
    },
    facts: { conditionalFollowUp: "Can you confirm which delivery spots you checked?" },
    evaluation: { objectives: [], passingScore: 80 },
    chat: { hotkeyProfile: "core", standardText: [] },
    voice: {},
  };

  const sanitized = authoringToStandaloneDraft(authoring);
  assert.deepEqual(sanitized.customer.conditionalFollowUps, []);
  assert.equal(sanitized.compatibilityFacts.conditionalFollowUp, "");

  const legitimate = authoringToStandaloneDraft({
    ...authoring,
    facts: { conditionalFollowUp: "Have you checked whether the refund posted?" },
  });
  assert.deepEqual(legitimate.customer.conditionalFollowUps, ["Have you checked whether the refund posted?"]);
  assert.equal(legitimate.compatibilityFacts.conditionalFollowUp, "Have you checked whether the refund posted?");
});
