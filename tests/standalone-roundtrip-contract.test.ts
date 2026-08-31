import assert from "node:assert/strict";
import test from "node:test";

import { composeScenarioFiles, importScenarioJson } from "../lib/scenario-contract";
import { blockingPhaseEvaluationFindings } from "../public/builder-studio/app.js";
import {
  authoringToStandaloneDraft,
  standaloneToAuthoringDraft,
} from "../public/builder-studio/src/standaloneAdapter.js";

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
