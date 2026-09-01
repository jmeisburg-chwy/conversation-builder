import assert from "node:assert/strict";
import test from "node:test";

import {
  composeScenarioFiles,
  importScenarioJson,
  validateScenarioFiles,
  type StudioDraft,
} from "../lib/scenario-contract";

const expectedEmpathyPhrases = [
  "i'm sorry", "i’m sorry", "i am sorry",
  "i'm really sorry", "i’m really sorry", "i am really sorry",
  "sorry your", "sorry the", "sorry about",
  "i understand", "we understand", "i see your", "i see the", "i see how", "i see why",
  "i see that", "that sounds frustrating", "sounds frustrating",
];
const expectedQuestionIntentPhrases = [
  "would you like", "do you want", "would you prefer", "can i process", "can i issue",
  "can i provide", "can i complete", "can i send", "may i process", "may i issue",
  "may i provide", "may i complete", "may i send",
];
const expectedRefundAmountPhrases = [
  "$32.49 refund", "full refund of $32.49 has", "full refund of $32.49 was",
  "refund amount is $32.49.",
  "refund amount is $32.49,", "refund is $32.49.", "refund is $32.49,",
];
const expectedRefundCompletionPhrases = [
  "refund was issued", "refund has been issued", "issued your refund", "issued the refund",
  "refund was processed", "refund has been processed", "processed your refund", "processed the refund",
  "refund was completed", "refund has been completed", "completed your refund", "completed the refund",
  "refund was sent", "refund has been sent", "sent your refund", "sent the refund",
  "i've refunded", "i’ve refunded", "i have refunded", "i refunded", "we refunded",
  "of $32.49 has been sent", "of $32.49 was sent",
];

function focusedDraft(): StudioDraft {
  return {
    baseId: "late_order_recovery",
    title: "Late Order Recovery",
    description: "Practice resolving a delayed order without overpromising.",
    learnerGoal: "Confirm the delay, offer the approved resolution, and set expectations.",
    channels: ["chat", "voice"],
    agentType: "Core",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    teamAudience: "Customer Care",
    customer: {
      name: "Jordan",
      petName: "Milo",
      tone: "Concerned but cooperative",
      goal: "Understand when Milo's food will arrive and what Chewy can do.",
      openingLine: "Milo's food should have arrived yesterday. Can you help?",
      facts: ["The order is expected tomorrow by end of day."],
      revealOnlyWhenAsked: ["Milo has food for two more days."],
      objections: ["Can you guarantee it will arrive tomorrow?"],
      behaviorRules: ["Never guarantee the delivery date."],
      conditionalFollowUps: ["After the learner explains the expected date, ask what happens if it is late again."],
      closingLine: "That answers my question. Thank you.",
    },
    correctProcess: ["Acknowledge the delay.", "Explain the expected delivery window."],
    prohibitedActions: ["Do not guarantee delivery."],
    phases: [
      {
        id: "acknowledge_delay",
        title: "Acknowledge and clarify",
        learnerActions: ["Acknowledge Jordan's concern and confirm which order is delayed."],
        chatAdvanceRequirements: [
          { id: "acknowledgement", phrases: ["sorry", "understand", "concern"] },
          { id: "delayed_order", phrases: ["delayed order", "late order", "order is delayed"] },
        ],
        partnerResponse: "Yes, it's Milo's food order.",
        coachGuidance: ["Use Jordan's and Milo's names naturally."],
        evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_1"] }],
      },
      {
        id: "set_expectations",
        title: "Set expectations",
        learnerActions: ["Explain that the order is expected tomorrow by end of day without guaranteeing it."],
        chatAdvanceRequirements: [
          { id: "expected_date", phrases: ["expected tomorrow", "arrive tomorrow"] },
          { id: "end_of_day", phrases: ["end of day"] },
        ],
        partnerResponse: "Okay, I can wait until tomorrow.",
        coachGuidance: ["Use expected rather than guaranteed timing."],
        evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_2"] }],
      },
    ],
    objectives: [
      {
        id: "set_clear_expectations",
        label: "Set clear expectations",
        description: "Explain the delivery status and next step accurately.",
        criteria: [
          "Explain that the order is expected tomorrow by end of day.",
          "Avoid guaranteeing the delivery date.",
        ],
      },
    ],
    objectiveApprovalRequired: false,
    compatibilityFacts: {
      address: "",
      medication: "",
      urgency: "Milo's food order is delayed.",
      medicationOrProduct: "Dog food",
      clinic: "",
    },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };
}

test("composes separate focused-objective chat and voice files without legacy behavior scoring", () => {
  const files = composeScenarioFiles(focusedDraft(), { now: "2026-08-28T18:00:00.000Z" });

  assert.deepEqual(files.map(({ filename }) => filename), [
    "late_order_recovery_chat.json",
    "late_order_recovery_voice.json",
  ]);
  assert.deepEqual(files.map(({ scenario }) => scenario.channels), [["chat"], ["voice"]]);

  for (const { scenario } of files) {
    assert.equal(scenario.coaching.gradingModel.mode, "focused_learning_objectives");
    assert.equal(scenario.coaching.qualityChecklist, undefined);
    assert.equal(scenario.coaching.behaviorRubric, undefined);
    assert.equal(scenario.runtime.replyMode, "dynamic_customer_responder");
    assert.equal(scenario.catalog.groupId, "late_order_recovery");
    assert.deepEqual(scenario.facts.knownFacts, ["The order is expected tomorrow by end of day."]);
    assert.deepEqual(scenario.customer.behavior.conditionalFollowUps, [
      "After the learner explains the expected date, ask what happens if it is late again.",
    ]);
    assert.doesNotMatch(JSON.stringify(scenario), /pauseAfter/);
  }

  const chat = files[0].scenario;
  const voice = files[1].scenario;
  assert.deepEqual(chat.chatConfig.stepProgression, chat.simulation.stateModel.chatStepProgression);
  assert.deepEqual(chat.frontend.chat.initialTranscript, [
    {
      role: "assistant",
      label: "Jordan",
      scenarioPathHint: "frontend.chat.initialTranscript[0]",
      content: "Milo's food should have arrived yesterday. Can you help?",
      meta: "Jordan",
    },
  ]);
  assert.equal(voice.frontend.voice.selectedVoice, "marin");
  assert.equal(voice.voice, "marin");
  assert.match(String(voice.conversationBetween.aiPersonality), /Remain Jordan, the customer/);
  assert.match(JSON.stringify(voice.customer.behavior.rules), /Never perform, narrate, or claim any Chewy-agent action/);
  assert.match(JSON.stringify(voice.customer.behavior.rules), /completed learner thought/);
  assert.equal(chat.frontend.chat.standardTextGuidance, "No approved Standard Text is required for this scenario.");
});

test("composes Rise-compatible Chat step match conditions", () => {
  const [chat] = composeScenarioFiles({ ...focusedDraft(), channels: ["chat"] });
  const step = chat.scenario.chatConfig?.stepProgression[0];
  const match = step?.match as {
    all?: Array<{ op: string; phrases: string[] }>;
    any?: Array<{ op: string; phrases: string[] }>;
  };

  assert.equal(Array.isArray(step?.match), false);
  assert.deepEqual(match.all, [
    { op: "contains_any", phrases: expectedEmpathyPhrases },
    { op: "contains_any", phrases: ["delayed order", "late order", "order is delayed"] },
  ]);
  assert.deepEqual(match.any, []);
  assert.equal(step?.label, "Acknowledge and clarify");
  assert.equal(step?.scenarioPathHint, "chatConfig.stepProgression[0]");
});

type RiseMatchCondition = { op: string; phrases: string[] };
type RiseStep = { match?: { all?: RiseMatchCondition[]; any?: RiseMatchCondition[] } };

function riseStepMatches(message: string, step: RiseStep): boolean {
  const normalized = message.toLowerCase();
  const conditionMatches = (condition: RiseMatchCondition) =>
    condition.op === "contains_any"
      && condition.phrases.some((phrase: string) => normalized.includes(phrase.toLowerCase()));
  const all = Array.isArray(step.match?.all) ? step.match.all : [];
  const any = Array.isArray(step.match?.any) ? step.match.any : [];
  return (!all.length || all.every(conditionMatches))
    && (!any.length || any.some(conditionMatches));
}

test("requires every positive concept before advancing a Chat phase", () => {
  const draft = focusedDraft();
  draft.baseId = "refund_for_torn_dog_food_bag";
  draft.channels = ["chat"];
  draft.phases = [
    {
      id: "acknowledge_and_empathize",
      title: "Acknowledge and empathize",
      learnerActions: ["Acknowledge the torn bag and express empathy."],
      chatAdvanceRequirements: [
        { id: "empathy", phrases: ["sorry", "understand how frustrating", "apologize"] },
        { id: "damaged_item", phrases: ["torn bag", "ripped bag", "damaged bag"] },
      ],
      partnerResponse: "The bag is torn and unusable.",
      coachGuidance: ["Recognize the damaged bag and empathize."],
      evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_1"] }],
    },
    {
      id: "confirm_refund_preference",
      title: "Confirm the refund preference",
      learnerActions: ["Confirm that the customer wants a refund."],
      chatAdvanceRequirements: [
        { id: "confirmation", phrases: ["just to confirm", "do you want", "you prefer"] },
        { id: "refund", phrases: ["refund", "money back"] },
      ],
      partnerResponse: "Yes, I want a refund.",
      coachGuidance: ["Confirm the customer's preferred resolution."],
      evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_1"] }],
    },
    {
      id: "complete_refund",
      title: "Complete the refund and set expectations",
      learnerActions: ["Confirm the $24.99 refund to the original payment card and the 3–5 business-day timeline."],
      chatAdvanceRequirements: [
        { id: "completion", phrases: ["refund has been issued", "completed the refund"] },
        { id: "amount", phrases: ["$24.99", "24.99"] },
        { id: "destination", phrases: ["original payment card", "original card"] },
        { id: "timeline", phrases: ["3–5 business days", "3-5 business days", "3 to 5 business days"] },
      ],
      partnerResponse: "Thank you for resolving this.",
      coachGuidance: ["State the exact amount, destination, and timeline."],
      evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_2"] }],
    },
  ];

  const [file] = composeScenarioFiles(draft);
  const steps = file.scenario.chatConfig!.stepProgression;

  assert.equal(riseStepMatches("I'm sorry about the torn bag.", steps[0]), true);
  assert.equal(riseStepMatches("What issue caused this?", steps[0]), false);
  assert.equal(riseStepMatches("Just to confirm, you want a refund?", steps[1]), true);
  assert.equal(riseStepMatches("I can offer store credit.", steps[1]), false);
  assert.equal(riseStepMatches("I've completed the refund. The $24.99 refund will return to your original payment card in 3–5 business days.", steps[2]), true);
  assert.equal(riseStepMatches("Thank you.", steps[2]), false);
});

test("keeps prohibited refund alternatives in scoring without exporting unsupported Chat gates", () => {
  const refundDraft = focusedDraft();
  refundDraft.channels = ["chat"];
  refundDraft.prohibitedActions = [
    "Do not offer store credit, a replacement, or an exchange.",
    "Do not issue a refund for an amount other than $24.99.",
    "Do not state a timeline other than 3-5 business days.",
  ];
  refundDraft.objectives = [{
    ...refundDraft.objectives[0],
    criteria: [
      "Acknowledge the torn bag and complete the approved refund.",
      ...refundDraft.prohibitedActions,
    ],
  }];
  refundDraft.phases = [{
    id: "complete_refund",
    title: "Complete the refund",
    learnerActions: [
      "Acknowledge the torn bag, issue the $24.99 refund to the original payment card, and explain the 3-5 business-day timeline.",
    ],
    chatAdvanceRequirements: [
      { id: "acknowledge_empathy", phrases: ["sorry the", "sorry about", "understand the"] },
      { id: "refund_destination", phrases: ["original card", "original payment card"] },
      { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days"] },
      { id: "refund_completion", phrases: ["issued the $24.99 refund", "processed the $24.99 refund", "refunded $24.99"] },
    ],
    partnerResponse: "Thank you for resolving this.",
    coachGuidance: ["Complete only the approved full refund."],
  }];

  const [file] = composeScenarioFiles(refundDraft);
  const step = file.scenario.chatConfig!.stepProgression[0] as RiseStep;

  assert.deepEqual(file.scenario.evaluationCriteria, refundDraft.objectives[0].criteria);
  assert.deepEqual(file.scenario.coaching.gradingModel.objectives[0].criteria, refundDraft.objectives[0].criteria);
  assert.deepEqual(Object.keys(step.match ?? {}).sort(), ["all", "any"]);
  assert.equal(riseStepMatches(
    "I understand the frustration. I've processed the $24.99 refund to your original card. It should appear in 3 to 5 business days.",
    step,
  ), true);
  assert.equal(riseStepMatches(
    "I'm sorry about the torn bag. The $24.99 refund was processed to your original payment card and should post in 3–5 business days.",
    step,
  ), true);
  for (const prohibitedAddition of [
    " I can also offer store credit.",
    " I can also send a replacement.",
    " I can arrange an exchange instead.",
  ]) {
    assert.equal(riseStepMatches(
      `I understand the frustration. I've processed the $24.99 refund to your original card. It should appear in 3 to 5 business days.${prohibitedAddition}`,
      step,
    ), true);
  }
});

test("accepts complete refund paraphrases, rejects incomplete turns, and leaves prohibitions to scoring", () => {
  const refundDraft = focusedDraft();
  refundDraft.channels = ["chat"];
  refundDraft.customer.facts = [
    "The order was for dry dog food.",
    "The exact refund amount is $32.49.",
    "The refund should go to the original payment card.",
    "The refund timeline is 3-5 business days.",
  ];
  refundDraft.prohibitedActions = [
    "Do not offer store credit, a replacement, or an exchange.",
  ];
  refundDraft.phases = [
    {
      id: "acknowledge_and_confirm_refund",
      title: "Acknowledge and confirm refund preference",
      learnerActions: [
        "Acknowledge the damaged bag and ask whether the customer wants a full refund.",
      ],
      chatAdvanceRequirements: [
        { id: "acknowledge_empathy", phrases: ["sorry the", "sorry about", "understand the"] },
        { id: "refund_preference", phrases: ["like a refund", "want a refund", "prefer a full refund"] },
      ],
      partnerResponse: "Yes, I want a full refund.",
      coachGuidance: ["Acknowledge the damage and confirm the refund preference."],
    },
    {
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: [
        "Complete the $32.49 refund to the original payment card and explain the 3-5 business-day timeline.",
      ],
      chatAdvanceRequirements: [
        { id: "refund_destination", phrases: ["original card", "original payment card"] },
        { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days"] },
        { id: "refund_completion", phrases: ["issued the $32.49 refund", "processed the $32.49 refund", "refunded $32.49"] },
      ],
      partnerResponse: "Thank you for resolving this.",
      coachGuidance: ["Complete the exact approved refund and set the posting expectation."],
    },
  ];

  const [file] = composeScenarioFiles(refundDraft);
  const steps = file.scenario.chatConfig!.stepProgression as RiseStep[];

  assert.equal(steps[0].match?.all?.length, 3);
  assert.equal(steps[1].match?.all?.length, 4);

  for (const message of [
    "I see your bag arrived damaged. Would you prefer a full refund?",
    "That sounds frustrating. Can I process a full refund for you?",
    "I'm sorry your dog food arrived damaged. Would you like me to refund it?",
  ]) {
    assert.equal(riseStepMatches(message, steps[0]), true, message);
  }
  for (const message of [
    "Your full refund of $32.49 has been sent to your original card. Allow 3 to 5 business days.",
    "A $32.49 refund was processed to your original payment card and should post within three to five business days.",
  ]) {
    assert.equal(riseStepMatches(message, steps[1]), true, message);
  }

  for (const [stepIndex, message] of [
    [0, "Would you prefer a full refund?"],
    [0, "That sounds frustrating. I can process a full refund."],
    [0, "That sounds frustrating. Can I help you?"],
    [0, "I do not understand the damaged bag. Would you prefer a full refund?"],
    [0, "I see your bag arrived damaged. I can issue a full refund."],
    [0, "I see your bag arrived damaged. Can I help with your order? I will process a full refund later."],
    [1, "A $32.49 refund was processed to your original payment card."],
    [1, "Your refund has been sent to your original card. Allow 3 to 5 business days."],
    [1, "$32.49 will go to your original card in 3 to 5 business days."],
    [1, "I sent the confirmation. The $32.49 refund goes to your original card in 3 to 5 business days."],
    [1, "I processed the return. The $32.49 refund goes to your original card in 3 to 5 business days."],
    [1, "The confirmation has been sent to your original card. Your $32.49 refund will arrive in 3 to 5 business days."],
    [1, "I refunded $132.49, not $32.49. It will return to your original card in 3 to 5 business days."],
    [1, "Your $132.49 refund was processed to your original card in 3 to 5 business days."],
    [1, "Your $32.490 refund was processed to your original card in 3 to 5 business days."],
  ] as const) {
    assert.equal(riseStepMatches(message, steps[stepIndex]), false, message);
  }

  for (const prohibited of ["store credit", "a replacement", "an exchange"]) {
    const message = `I see your bag arrived damaged. Would you prefer a full refund or ${prohibited}?`;
    assert.equal(riseStepMatches(message, steps[0]), true, message);
  }
});

test("keeps approved facts out of customer conditional follow-ups", () => {
  const files = composeScenarioFiles(focusedDraft());

  for (const { scenario } of files) {
    assert.deepEqual(scenario.facts.knownFacts, [
      "The order is expected tomorrow by end of day.",
    ]);
    assert.deepEqual(scenario.customer.behavior.conditionalFollowUps, [
      "After the learner explains the expected date, ask what happens if it is late again.",
    ]);
  }
});

test("safely enriches persisted v31 Chat requirements while preserving specific creator phrases and unknown groups", () => {
  const refundDraft = focusedDraft();
  refundDraft.channels = ["chat"];
  refundDraft.prohibitedActions = [
    "Do not offer store credit, a replacement, or an exchange.",
  ];
  refundDraft.phases = [
    {
      id: "acknowledge_and_confirm_preference",
      title: "Acknowledge and confirm the refund preference",
      learnerActions: ["Acknowledge the torn bag and confirm that the customer prefers a full refund."],
      chatAdvanceRequirements: [
        { id: "acknowledge_empathy", phrases: ["sorry the", "understand the"] },
        { id: "refund_preference", phrases: ["like a refund", "want a refund"] },
      ],
      partnerResponse: "Yes, I prefer a full refund.",
      coachGuidance: ["Confirm the customer's preferred resolution."],
    },
    {
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: ["Issue the $32.49 refund to the original payment card and explain the 3-5 business-day timeline."],
      chatAdvanceRequirements: [
        { id: "refund_destination", phrases: ["original card", "original payment card"] },
        { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days"] },
        {
          id: "refund_completion",
          phrases: ["issued the $32.49 refund", "processed the $32.49 refund", "refund is complete"],
        },
      ],
      partnerResponse: "Thank you for resolving this.",
      coachGuidance: ["Complete only the approved full refund."],
    },
    {
      id: "share_reference",
      title: "Share the case reference",
      learnerActions: ["Share the case reference."],
      chatAdvanceRequirements: [
        { id: "creator_case_reference", phrases: ["case reference", "reference number", "creator reference"] },
      ],
      partnerResponse: "I'll keep that reference.",
      coachGuidance: ["Provide the reference clearly."],
    },
  ];

  const [file] = composeScenarioFiles(refundDraft);
  const steps = file.scenario.chatConfig!.stepProgression as RiseStep[];

  assert.deepEqual(steps[0].match?.all, [
    {
      op: "contains_any",
      phrases: ["sorry the", ...expectedEmpathyPhrases.filter((phrase) => phrase !== "sorry the")],
    },
    {
      op: "contains_any",
      phrases: expectedQuestionIntentPhrases,
    },
    { op: "contains_any", phrases: ["like a refund", "want a refund", "refund"] },
  ]);
  assert.deepEqual(steps[1].match?.all, [
    { op: "contains_any", phrases: ["original card", "original payment card"] },
    {
      op: "contains_any",
      phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"],
    },
    { op: "contains_any", phrases: expectedRefundAmountPhrases },
    {
      op: "contains_any",
      phrases: [
        "issued the $32.49 refund",
        "processed the $32.49 refund",
        "refund is complete",
        ...expectedRefundCompletionPhrases,
      ],
    },
  ]);
  assert.deepEqual(steps[2].match?.all, [{
    op: "contains_any",
    phrases: ["case reference", "reference number", "creator reference"],
  }]);

  const validMessages = [
    "I'm sorry about the torn bag. Would you prefer a full refund?",
    "I've processed the $32.49 refund to your original card. It should post in 3 to 5 business days.",
    "Your creator reference is REF-123.",
  ];
  validMessages.forEach((message, index) => {
    assert.equal(riseStepMatches(message, steps[index]), true);
    assert.equal(riseStepMatches(`${message} I can also offer store credit.`, steps[index]), true);
    assert.equal(riseStepMatches(`${message} I can also send a replacement.`, steps[index]), true);
    assert.equal(riseStepMatches(`${message} I can arrange an exchange instead.`, steps[index]), true);
  });
  assert.equal(
    riseStepMatches("I understand the issue. I want a refund.", steps[0]),
    false,
  );
});

test("enriches v31 Chat requirements after a JSON pair is imported and recomposed", () => {
  const refundDraft = focusedDraft();
  refundDraft.baseId = "damaged_dog_food_full_refund_practice";
  refundDraft.channels = ["chat", "voice"];
  refundDraft.correctProcess = [
    "Acknowledge the torn bag and confirm that the customer prefers a full refund.",
    "Issue exactly $32.49 to the original payment card and explain the 3-5 business-day timeline.",
  ];
  refundDraft.prohibitedActions = ["Do not offer store credit, a replacement, or an exchange."];
  refundDraft.phases = [{
    id: "complete_refund",
    title: "Complete the refund",
    learnerActions: [
      "Acknowledge the torn bag, confirm that the customer prefers a full refund, issue the $32.49 refund to the original payment card, and explain the 3-5 business-day timeline.",
    ],
    chatAdvanceRequirements: [
      { id: "acknowledge_empathy", phrases: ["sorry the", "understand the"] },
      { id: "refund_preference", phrases: ["like a refund", "want a refund"] },
      { id: "refund_destination", phrases: ["original card", "original payment card"] },
      { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days"] },
      { id: "refund_completion", phrases: ["issued the $32.49 refund", "processed the $32.49 refund"] },
    ],
    partnerResponse: "Thank you for resolving this.",
    coachGuidance: ["Complete only the approved full refund."],
    evaluationLinks: [{ objectiveId: "refund_accuracy", criterionIds: ["refund_accuracy_criterion_1"] }],
  }];
  refundDraft.objectives = [{
    id: "refund_accuracy",
    label: "Refund accuracy",
    description: "Complete the approved refund accurately.",
    criteria: ["Issue exactly $32.49 to the original payment card and explain the 3-5 business-day timeline."],
  }];

  const files = composeScenarioFiles(refundDraft);
  const chat = files.find((file) => file.scenario.channels[0] === "chat")!.scenario;
  const oldMatch = {
    all: [
      { op: "contains_any", phrases: ["sorry the", "understand the"] },
      { op: "contains_any", phrases: ["like a refund", "want a refund"] },
      { op: "contains_any", phrases: ["original card", "original payment card"] },
      { op: "contains_any", phrases: ["3-5 business days", "3–5 business days"] },
      { op: "contains_any", phrases: ["issued the $32.49 refund", "processed the $32.49 refund"] },
    ],
    any: [],
  };
  chat.chatConfig!.stepProgression[0].match = structuredClone(oldMatch);
  chat.simulation.stateModel.chatStepProgression[0].match = structuredClone(oldMatch);

  const imported = importScenarioJson(JSON.stringify(files.map((file) => file.scenario)), "improve");
  imported.draft.sourceOverlay = true;
  const recomposed = composeScenarioFiles(imported.draft);
  const chatOutput = recomposed.find((file) => file.scenario.channels[0] === "chat")!;
  const step = chatOutput.scenario.chatConfig!.stepProgression[0] as RiseStep;

  assert.equal(validateScenarioFiles(recomposed).length, 0);
  assert.equal(riseStepMatches(
    "I'm sorry about the torn bag. Would you prefer a full refund? I've processed the $32.49 refund to your original card. It should post in 3 to 5 business days.",
    step,
  ), true);
  assert.equal(riseStepMatches(
    "I'm sorry about the torn bag. Would you prefer a full refund? I've processed the $32.49 refund to your original card. It should post in 3 to 5 business days. I can also offer store credit.",
    step,
  ), true);
  assert.equal(riseStepMatches(
    "I'm sorry about the torn bag. Would you prefer a full refund? I've processed the $32.49 refund to your original card. It should post in 3 to 5 business days. I can also send a replacement.",
    step,
  ), true);
});

test("marks legacy any-only Chat gates as needing explicit review after import", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["chat"] });
  const legacy = structuredClone(file.scenario);
  const permissive = {
    all: [],
    any: [{ op: "contains_any", phrases: ["issue", "customer", "thank", "help"] }],
  };
  legacy.chatConfig!.stepProgression[0].match = permissive;
  legacy.simulation.stateModel.chatStepProgression[0].match = permissive;

  const imported = importScenarioJson(JSON.stringify(legacy), "improve");

  assert.deepEqual(imported.draft.phases[0].chatAdvanceRequirements, []);
});

test("exports standalone metadata and guidance without draft or duplicate-copy contradictions", () => {
  const [chat] = composeScenarioFiles({ ...focusedDraft(), channels: ["chat"] }, { now: "2026-08-31T12:00:00.000Z" });
  const scenario = chat.scenario;
  const guideSections = scenario.frontend.chat?.guideSections as Array<{ body?: string; bullets?: string[] }>;

  assert.equal(scenario.status, "published");
  assert.equal(scenario.managerPreview.testRevision, "Standalone Conversation Builder validated export");
  assert.match(String(scenario.catalog.practiceDescription), /^Practice how to /);
  assert.match(String(scenario.frontend.shared.learnerBriefing.about), /^You will practice /);
  assert.match(String(scenario.frontend.shared.learnerBriefing.about), /resolving a delayed order without overpromising/i);
  assert.doesNotMatch(String(scenario.simulation.sourceTranscriptMetadata.sourceMaterial), /Avoid:\s*$/);
  assert.equal(guideSections.every((section) => !section.body || !section.bullets?.includes(section.body)), true);
});

test("does not duplicate 'how to' in the learner-facing practice description", () => {
  const draft = focusedDraft();
  draft.channels = ["chat"];
  draft.learnerGoal = "Practice how to set accurate delivery expectations.";

  const [chat] = composeScenarioFiles(draft);

  assert.equal(
    chat.scenario.catalog.practiceDescription,
    "Practice how to set accurate delivery expectations.",
  );
});

test("exports complete Coach Chewy hierarchy as flat Chat and Voice bullets", () => {
  const draft = focusedDraft();
  draft.channels = ["chat", "voice"];
  draft.phases[0].guideBody = "Use the approved recovery process.";
  draft.phases[0].coachGuidance = ["Recognize the delayed order."];
  draft.phases[0].coachGuidanceHierarchy = [{
    id: "acknowledge_parent",
    text: "Recognize the delayed order.",
    children: [
      {
        id: "acknowledge_support",
        text: "Use Jordan's and Milo's names naturally.",
        kind: "support",
      },
      {
        id: "acknowledge_caution",
        text: "Do not guarantee the delivery date.",
        kind: "caution",
      },
    ],
  }];

  const files = composeScenarioFiles(draft);
  const sections = files.map(({ scenario }) => {
    const guideSections = scenario.frontend.chat?.guideSections ?? scenario.frontend.voice?.guideSections;
    return guideSections?.[0] as {
      body: string;
      bullets: string[];
    };
  });

  for (const section of sections) {
    assert.equal(section.body, "Use the approved recovery process.");
    assert.deepEqual(section.bullets, [
      "Recognize the delayed order.",
      "Use Jordan's and Milo's names naturally.",
      "Do not guarantee the delivery date.",
    ]);
    assert.equal(section.bullets.every((bullet) => typeof bullet === "string"), true);
  }
});

test("does not repeat a guidance parent that already appears as the guide body", () => {
  const draft = focusedDraft();
  draft.channels = ["chat", "voice"];
  draft.phases[0].guideBody = "Recognize the delayed order.";
  draft.phases[0].coachGuidanceHierarchy = [{
    id: "acknowledge_parent",
    text: "Recognize the delayed order.",
    children: [{
      id: "acknowledge_caution",
      text: "Do not guarantee the delivery date.",
      kind: "caution",
    }],
  }];

  for (const { scenario } of composeScenarioFiles(draft)) {
    const guideSections = scenario.frontend.chat?.guideSections ?? scenario.frontend.voice?.guideSections;
    const [section] = guideSections as Array<{
      body: string;
      bullets: string[];
    }>;

    assert.equal(section.body, "Recognize the delayed order.");
    assert.deepEqual(section.bullets, ["Do not guarantee the delivery date."]);
  }
});

test("defaults missing authored and imported passing scores to 100", () => {
  const authored = focusedDraft();
  delete authored.evaluation;

  const [file] = composeScenarioFiles(authored);
  assert.equal(file.scenario.coaching.gradingModel.passingScore, 100);

  delete file.scenario.coaching.gradingModel.passingScore;
  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");
  assert.equal(imported.draft.evaluation?.passingScore, 100);
});

test("rejects Chat step matching that the Rise runtime cannot evaluate", () => {
  const files = composeScenarioFiles({ ...focusedDraft(), channels: ["chat"] });
  const chat = files[0].scenario;
  chat.chatConfig!.stepProgression[0].match = ["Acknowledge the concern."];
  chat.simulation.stateModel.chatStepProgression[0].match = ["Acknowledge the concern."];

  assert.deepEqual(
    validateScenarioFiles(files).find((issue) => issue.code === "invalid_chat_step_match"),
    {
      code: "invalid_chat_step_match",
      path: "files[0].scenario.chatConfig.stepProgression[0].match",
      message: "Chat turn matching is not compatible with the Rise simulator.",
      fix: "Use match.all or match.any with a contains_any condition and at least one phrase.",
    },
  );
});

test("rejects unsupported negative Chat match conditions", () => {
  const files = composeScenarioFiles({ ...focusedDraft(), channels: ["chat"] });
  const match = files[0].scenario.chatConfig!.stepProgression[0].match as {
    none: Array<{ op: string; phrases: string[] }>;
  };
  match.none = [{ op: "contains_any", phrases: ["store credit"] }];

  assert.deepEqual(
    validateScenarioFiles(files).find((issue) => issue.code === "invalid_chat_step_match"),
    {
      code: "invalid_chat_step_match",
      path: "files[0].scenario.chatConfig.stepProgression[0].match",
      message: "Chat turn matching is not compatible with the Rise simulator.",
      fix: "Use match.all or match.any with a contains_any condition and at least one phrase.",
    },
  );
});

test("reports the exact location, cause, and fix for a channel-id mismatch", () => {
  const files = composeScenarioFiles(focusedDraft());
  files[0].scenario.id = "late_order_recovery_voice";

  const issues = validateScenarioFiles(files);
  const mismatch = issues.find((issue) => issue.code === "id_channel_mismatch");

  assert.deepEqual(mismatch, {
    code: "id_channel_mismatch",
    path: "files[0].scenario.id",
    message: "Chat scenario IDs must end in _chat.",
    fix: "Use late_order_recovery_chat as the scenario ID and filename.",
  });
});

test("imports a focused scenario for improvement without changing its identity", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });

  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");

  assert.equal(imported.kind, "focused");
  assert.equal(imported.draft.baseId, "late_order_recovery");
  assert.deepEqual(imported.draft.channels, ["voice"]);
  assert.equal(imported.original.id, "late_order_recovery_voice");
});

test("keeps a full-conversation upload untouched and allows only a new objective copy", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  const fullConversation = structuredClone(file.scenario);
  fullConversation.coaching = {
    summaryGuidance: "Score all seven behaviors.",
    gradingModel: { mode: "customer_care_behaviors" },
    qualityChecklist: [{ category: "Issue Understanding", behaviors: ["Understands the issue."] }],
    behaviorRubric: [{ behavior_name: "issue_understanding" }],
  };

  assert.throws(
    () => importScenarioJson(JSON.stringify(fullConversation), "improve"),
    /Create similar from JSON/,
  );

  const imported = importScenarioJson(JSON.stringify(fullConversation), "similar");
  assert.equal(imported.kind, "full_conversation_copy");
  assert.equal(imported.original.id, "late_order_recovery_voice");
  assert.notEqual(imported.draft.baseId, "late_order_recovery");
  assert.deepEqual(imported.draft.objectives, []);
  assert.equal(imported.requiresObjectiveApproval, true);
});

test("preserves approved channel settings and guide wording when improving a sibling pair", () => {
  const originalDraft = focusedDraft();
  originalDraft.chat = {
    hotkeyProfile: "rx",
    standardTextDecision: "approved",
    standardText: [{
      hotkey: "de6",
      category: "Shipping",
      template: "Approved delayed-order response.",
      insertionMoment: "Use after explaining the delivery timeline.",
      customization: "Customize the tracking link before sending.",
      notes: ["Approved library item."],
      approvedGuidance: "",
    }],
  };
  originalDraft.voice = { selectedVoice: "cedar", speed: 0.95 };
  const files = composeScenarioFiles(originalDraft);

  const imported = importScenarioJson(JSON.stringify(files.map((file) => file.scenario)), "improve");

  assert.equal(imported.kind, "focused");
  assert.equal(imported.draft.chat.hotkeyProfile, "rx");
  assert.equal(imported.draft.chat.standardTextDecision, "approved");
  assert.deepEqual(
    imported.draft.chat.standardText.map(({ hotkey, template, notes }) => ({ hotkey, template, notes })),
    originalDraft.chat.standardText.map(({ hotkey, template, notes }) => ({ hotkey, template, notes })),
  );
  assert.equal(imported.draft.voice.selectedVoice, "cedar");
  assert.equal(imported.draft.voice.speed, 0.95);
  assert.equal(imported.draft.phases.length, originalDraft.phases.length);
  assert.deepEqual(imported.draft.customer.facts, originalDraft.customer.facts);
  assert.deepEqual(imported.draft.customer.conditionalFollowUps, originalDraft.customer.conditionalFollowUps);
  assert.deepEqual(imported.draft.phases[0].coachGuidance, originalDraft.phases[0].coachGuidance);
  const [recomposedChat] = composeScenarioFiles({ ...imported.draft, channels: ["chat"] });
  assert.equal(recomposedChat.scenario.frontend.chat?.standardTextGuidance, files[0].scenario.frontend.chat?.standardTextGuidance);
  assert.equal(recomposedChat.scenario.simulation.stateModel.chatStepProgression.length, originalDraft.phases.length);
});

test("rejects improving a sibling pair with divergent channel guidance", () => {
  const files = composeScenarioFiles(focusedDraft());
  const voiceGuide = files[1].scenario.frontend.voice?.guideSections as Array<Record<string, unknown>>;
  voiceGuide[0].body = "Use different spoken guidance.";

  assert.throws(
    () => importScenarioJson(JSON.stringify(files.map((file) => file.scenario)), "improve"),
    /channel-specific wording/,
  );
});

test("accepts a sibling pair when an approved-response instruction duplicates shared guidance", () => {
  const draft = focusedDraft();
  const sharedInstruction = draft.phases[0].coachGuidance[0];
  draft.chat.approvedResponseAssignments = [{
    id: "acknowledge_response",
    responseId: "approved_acknowledgement",
    phaseId: draft.phases[0].id,
    instruction: sharedInstruction,
  }];

  const files = composeScenarioFiles(draft);
  const chatSections = files[0].scenario.frontend.chat?.guideSections as Array<Record<string, unknown>>;
  const voiceSections = files[1].scenario.frontend.voice?.guideSections as Array<Record<string, unknown>>;

  assert.deepEqual(chatSections[0].bullets, voiceSections[0].bullets);
  assert.doesNotThrow(() => importScenarioJson(JSON.stringify(files.map((file) => file.scenario)), "improve"));
});

test("does not clamp an invalid passing score before validation can reject it", () => {
  const draft = focusedDraft();
  draft.evaluation = { passingScore: 101 };

  const files = composeScenarioFiles(draft);

  assert.equal(files[0].scenario.coaching.gradingModel.passingScore, 101);
});

test("preserves compatibility facts when improving a focused Rx scenario", () => {
  const original = focusedDraft();
  original.agentType = "Rx";
  original.channels = ["voice"];
  original.compatibilityFacts = {
    address: "",
    medication: "Carprofen",
    urgency: "The refill is already placed and the pet has two doses left.",
    medicationOrProduct: "Luna's Carprofen refill",
    clinic: "Fictional Veterinary Clinic",
  };
  const [file] = composeScenarioFiles(original);

  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");
  const [recomposed] = composeScenarioFiles(imported.draft);

  assert.deepEqual(recomposed.scenario.facts, file.scenario.facts);
});

test("preserves authoritative Factory facts, guidance, voice experience, and customer rules on improve", () => {
  const original = focusedDraft();
  original.channels = ["voice"];
  const [file] = composeScenarioFiles(original);
  file.scenario.facts.keyQuestion = "Can the learner complete the approved close?";
  file.scenario.facts.rootCauseBelief = "The customer believes the work is complete and wants a recap.";
  file.scenario.facts.conditionalFollowUp = "Follow the approved four-section path exactly.";

  const behavior = file.scenario.customer.behavior as Record<string, unknown>;
  behavior.rules = [
    ...(behavior.rules as string[]),
    "Remain relieved and cooperative unless the learner makes an unsupported promise.",
  ];

  const voiceFrontend = file.scenario.frontend.voice as Record<string, unknown>;
  const sourceGuide = (voiceFrontend.guideSections as Array<Record<string, unknown>>)[0];
  sourceGuide.sourceLabel = "Source: Approved manager guide, Section 1";
  sourceGuide.body = "Use the exact manager-provided guidance body.";
  voiceFrontend.guideTopNote = "Follow all approved sections in order.";
  voiceFrontend.pacing = "Use warm, natural, unhurried pacing.";
  voiceFrontend.verbalGuidance = "Do not read Coach Chewy guidance aloud.";
  voiceFrontend.endNote = "Let the customer respond, then click End.";
  voiceFrontend.spokenTone = "Relieved";
  voiceFrontend.completion = {
    enabled: true,
    autoEnd: false,
    terminalCustomerPhrases: ["thank you"],
    endDelayMs: 300,
    endStatus: "Practice complete. Click End to receive feedback.",
  };

  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");
  const [recomposed] = composeScenarioFiles(imported.draft);
  const recomposedVoice = recomposed.scenario.frontend.voice as Record<string, unknown>;
  const recomposedGuide = (recomposedVoice.guideSections as Array<Record<string, unknown>>)[0];
  const recomposedRules = (recomposed.scenario.customer.behavior as Record<string, unknown>).rules as string[];

  assert.equal(recomposed.scenario.facts.keyQuestion, file.scenario.facts.keyQuestion);
  assert.equal(recomposed.scenario.facts.rootCauseBelief, file.scenario.facts.rootCauseBelief);
  assert.equal(recomposed.scenario.facts.conditionalFollowUp, file.scenario.facts.conditionalFollowUp);
  assert.equal(recomposedRules.includes("Remain relieved and cooperative unless the learner makes an unsupported promise."), true);
  assert.equal(recomposedGuide.sourceLabel, sourceGuide.sourceLabel);
  assert.equal(recomposedGuide.body, sourceGuide.body);
  for (const key of ["guideTopNote", "pacing", "verbalGuidance", "endNote", "spokenTone", "completion"]) {
    assert.deepEqual(recomposedVoice[key], voiceFrontend[key]);
  }
});

test("rejects malformed runtime guide-bullet hierarchy instead of stringifying it", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  const sections = file.scenario.frontend.voice?.guideSections as Array<Record<string, unknown>>;
  sections[0].bullets = [{ text: "Parent guidance", children: [{ text: "Nested detail", kind: "support" }] }];

  assert.throws(
    () => importScenarioJson(JSON.stringify(file.scenario), "improve"),
    /Coach Chewy bullet.*cannot safely edit/i,
  );
});

test("accepts sibling files whose object keys have different insertion order", () => {
  const files = composeScenarioFiles(focusedDraft());
  files[1].scenario.facts = Object.fromEntries(Object.entries(files[1].scenario.facts).reverse());

  assert.doesNotThrow(() => importScenarioJson(JSON.stringify(files.map((file) => file.scenario)), "improve"));
});

test("pairs each approved transcript response with the next learner action and ends terminally", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  const transcript = file.scenario.simulation.approvedTranscript;

  assert.equal(transcript[0].idealAgentResponse, focusedDraft().phases[0].learnerActions.join(" "));
  assert.equal(transcript[1].idealAgentResponse, focusedDraft().phases[1].learnerActions.join(" "));
  assert.match(String(transcript.at(-1)?.idealAgentResponse), /No additional learner response is required/);
});

test("preserves a final learner-only phase where the customer must remain silent", () => {
  const terminalDraft = focusedDraft();
  terminalDraft.channels = ["voice"];
  terminalDraft.phases.push(
    {
      id: "confirm_resolution",
      title: "Confirm the resolution",
      learnerActions: ["Confirm the approved resolution and ask whether anything else is needed."],
      partnerResponse: "Next Wednesday works, and that's everything. Thank you.",
      coachGuidance: ["Confirm that the customer has no other needs."],
    },
    {
      id: "complete_chewy_closing",
      title: "Complete the Chewy closing",
      learnerActions: ["Use the complete approved Chewy closing."],
      partnerResponse: "",
      coachGuidance: ["Complete the Chewy closing after resolving the customer's needs."],
      customerRemainsSilent: true,
    },
  );
  const [file] = composeScenarioFiles(terminalDraft);
  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");

  assert.equal(imported.draft.phases.at(-1)?.customerRemainsSilent, true);
  assert.equal(imported.draft.phases.at(-1)?.partnerResponse, "");

  imported.draft.sourceOverlay = true;
  const [recomposed] = composeScenarioFiles(imported.draft);
  const progression = recomposed.scenario.simulation.stateModel.voiceStepProgression;
  assert.equal(progression.length, terminalDraft.phases.length - 1);
  assert.equal(JSON.stringify(progression).includes("Next Wednesday works"), true);
  assert.equal(recomposed.scenario.simulation.approvedTranscript.length, terminalDraft.phases.length);
  assert.match(String((recomposed.scenario.customer.behavior as Record<string, unknown>).closingRule), /remain silent/i);
});

test("preserves the absence of optional runtime tuning on Improve", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  delete file.scenario.runtime.tuning;
  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");
  imported.draft.sourceOverlay = true;

  const [recomposed] = composeScenarioFiles(imported.draft);

  assert.equal(recomposed.scenario.runtime.tuning, undefined);
  assert.equal(recomposed.scenario.frontend.voice?.selectedVoice, "marin");
});

test("carries explicit full-conversation guardrails into a new learning-objective copy", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  file.scenario.coaching = {
    summaryGuidance: "Score the full conversation.",
    gradingModel: { mode: "customer_care_behaviors" },
    qualityChecklist: [],
    behaviorRubric: [],
  };
  file.scenario.evaluationCriteria = [
    "Explain that delivery is expected tomorrow without guaranteeing delivery.",
    "Offer the approved refund and obtain the customer's consent before processing it.",
  ];
  const briefing = file.scenario.frontend.shared.learnerBriefing as Record<string, unknown>;
  briefing.goals = [
    "Resolve the delayed order accurately.",
    "Guardrails: use expected timing and obtain consent before processing a refund.",
  ];

  const imported = importScenarioJson(JSON.stringify(file.scenario), "similar");

  assert.equal(imported.kind, "full_conversation_copy");
  assert.equal(imported.draft.correctProcess.some((entry) => entry.includes("without guaranteeing delivery")), true);
  assert.equal(imported.draft.prohibitedActions.some((entry) => /guarantee delivery/i.test(entry)), true);
  assert.equal(imported.draft.prohibitedActions.some((entry) => /consent.*process|process.*consent/i.test(entry)), true);
});

test("regenerates source-driven role and behavior text after an improved draft changes", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  const imported = importScenarioJson(JSON.stringify(file.scenario), "improve");
  imported.draft.sourceOverlay = true;
  imported.draft.customer.name = "Morgan";
  imported.draft.customer.tone = "Upset";
  imported.draft.correctProcess = ["Explain the new approved process."];
  imported.draft.customer.closingLine = "Thank you for the update.";
  const [recomposed] = composeScenarioFiles(imported.draft);

  assert.match(String(recomposed.scenario.conversationBetween.aiRole), /Morgan/);
  assert.match(String(recomposed.scenario.conversationBetween.aiPersonality), /Morgan is Upset/);
  assert.match(String((recomposed.scenario.customer.behavior as Record<string, unknown>).softeningRule), /new approved process/);
  assert.match(String((recomposed.scenario.customer.behavior as Record<string, unknown>).closingRule), /Thank you for the update/);
});

test("removes unfinished blank list rows from downloaded scenario content", () => {
  const draft = focusedDraft();
  draft.correctProcess.push("   ");
  draft.phases[0].learnerActions.push("");
  draft.phases[0].coachGuidance.push(" ");
  draft.objectives[0].criteria.push("");

  const [file] = composeScenarioFiles({ ...draft, channels: ["chat"] });
  const match = file.scenario.chatConfig?.stepProgression[0].match as {
    all: Array<{ phrases: string[] }>;
    any: Array<{ phrases: string[] }>;
  };

  assert.equal(file.scenario.evaluationCriteria.includes(""), false);
  assert.equal([...match.all, ...match.any].every((condition) => !condition.phrases.includes("")), true);
  assert.equal(JSON.stringify(file.scenario.frontend.chat).includes('"bullets":["'), true);
  assert.doesNotMatch(JSON.stringify(file.scenario), /""\s*,\s*""/);
});
