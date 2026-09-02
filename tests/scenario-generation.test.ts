import assert from "node:assert/strict";
import test from "node:test";

import { createGenerateHandler } from "../lib/scenario-generation";
import {
  compileSafeChatAdvanceRequirements,
  findChatAdvanceRequirementQualityFindings,
  mergeSafeChatAdvanceRequirementAliases,
} from "../lib/scenario-quality-guards";
import { createValidateHandler } from "../lib/scenario-validation";
import { objectiveFingerprint } from "../lib/objective-approval";
import type { StudioDraft } from "../lib/scenario-contract";
import { authoringToStandaloneDraft, standaloneToAuthoringDraft } from "../public/builder-studio/src/standaloneAdapter.js";
import { normalizeStudioDraft } from "../public/builder-studio/src/scenarioStudio.js";

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

const validBody = {
  mode: "new",
  deidentificationConfirmed: true,
  channels: ["chat", "voice"],
  situation: "A fictional customer needs help with a delayed dog food order.",
  learnerGoal: "Resolve the delay without guaranteeing a delivery date.",
  correctProcess: "For this fictional exercise, confirm tracking shows the package is lost, submit a no-cost replacement order, and tell the customer the replacement order is confirmed.",
  agentType: "Core",
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/builder/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function providerResponse(output: unknown): Response {
  return Response.json({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
  });
}

const generated = {
  title: "Late Dog Food Order",
  description: "Practice resolving a delayed dog food order with accurate expectations.",
  learnerGoal: "Resolve the delay without guaranteeing a delivery date.",
  agentType: "Core",
  topic: "Delivery / Tracking",
  subtopic: "Late delivery",
  teamAudience: "Customer Care",
  customer: {
    name: "Jordan",
    petName: "Milo",
    tone: "Concerned but cooperative",
    goal: "Understand the delivery timing and available next step.",
    openingLine: "Milo's food was supposed to arrive yesterday. Can you help?",
    facts: ["The order is expected tomorrow by end of day."],
    revealOnlyWhenAsked: ["Milo has food for two more days."],
    objections: ["Can you guarantee it will arrive tomorrow?"],
    behaviorRules: ["Do not invent order details."],
    conditionalFollowUps: ["After the learner explains the timing, ask what happens if the order is late again."],
    closingLine: "That answers my question. Thank you.",
  },
  correctProcess: ["Acknowledge the concern.", "Explain the expected delivery window."],
  prohibitedActions: ["Do not guarantee the delivery date."],
  phases: [
    {
      id: "acknowledge_and_clarify",
      title: "Acknowledge and clarify",
      learnerActions: ["Acknowledge the concern and confirm the delayed order."],
      strongLearnerResponse: "I understand how concerning this delay is, Jordan. Let me confirm the order details with you.",
      chatAdvanceRequirements: [
        { id: "acknowledgement", phrases: ["sorry", "understand", "concern"] },
        { id: "delayed_order", phrases: ["delayed order", "late order"] },
      ],
      partnerResponse: "Yes, it is Milo's food order.",
      coachGuidance: ["Use the customer and pet names naturally."],
      customerRemainsSilent: false,
    },
  ],
  objectives: [
    {
      id: "set_clear_expectations",
      label: "Set clear expectations",
      description: "Explain the delivery status accurately.",
      criteria: ["State the expected delivery window.", "Avoid guarantees."],
    },
  ],
  compatibilityFacts: {
    address: "",
    medication: "",
    urgency: "Milo has food for two more days.",
    medicationOrProduct: "Dog food",
    clinic: "",
    keyQuestion: "Can the learner resolve the delayed order without making a guarantee?",
    rootCauseBelief: "Jordan believes the delivery may be lost and wants an accurate next step.",
    conditionalFollowUp: "Ask what happens next if the expected delivery does not arrive.",
  },
  assumptions: ["All names and order details are fictional."],
};

function generatedRefundWithAmount(amount: string) {
  return {
    ...generated,
    customer: {
      ...generated.customer,
      name: "Jamie",
      openingLine: "The dry dog food bag arrived torn and unusable.",
    },
    phases: [
      {
        ...generated.phases[0],
        id: "confirm_refund_preference",
        title: "Confirm refund preference",
        learnerActions: [
          "Acknowledge the damaged delivery.",
          "Ask whether Jamie wants a full refund.",
        ],
        chatAdvanceRequirements: [
          { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
          { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
          { id: "refund", phrases: ["refund"] },
        ],
        partnerResponse: "Yes, I want a full refund.",
      },
      {
        ...generated.phases[0],
        id: "complete_refund",
        title: "Complete the refund",
        learnerActions: [
          `Issue a full refund of ${amount} to the original payment card.`,
          "Explain that the refund will post within 3–5 business days.",
        ],
        chatAdvanceRequirements: [
          { id: "refund_amount", phrases: [`${amount} refund`, `refund amount is ${amount}.`] },
          { id: "refund_destination", phrases: ["original card", "original payment card"] },
          { id: "refund_timeline", phrases: ["3-5 business days", "3 to 5 business days"] },
          { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
        ],
        partnerResponse: "Thank you for resolving this.",
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "refund_resolution",
      criteria: [
        "Acknowledge the damaged delivery.",
        "Ask whether Jamie wants a full refund.",
        `Issue a full refund of ${amount} to the original payment card.`,
        "Explain that the refund will post within 3–5 business days.",
      ],
    }],
    prohibitedActions: ["Do not offer store credit, a replacement, or an exchange."],
  };
}

function importedDraft(overrides: Partial<StudioDraft> = {}): StudioDraft {
  const base: StudioDraft = {
    baseId: "existing_scenario",
    title: generated.title,
    description: generated.description,
    learnerGoal: generated.learnerGoal,
    channels: ["voice"],
    agentType: "Core",
    topic: generated.topic,
    subtopic: generated.subtopic,
    teamAudience: generated.teamAudience,
    customer: structuredClone(generated.customer),
    correctProcess: [...generated.correctProcess],
    prohibitedActions: [...generated.prohibitedActions],
    phases: structuredClone(generated.phases),
    objectives: structuredClone(generated.objectives),
    objectiveApprovalRequired: false,
    compatibilityFacts: structuredClone(generated.compatibilityFacts),
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };
  return {
    ...base,
    ...overrides,
    customer: overrides.customer ?? base.customer,
    compatibilityFacts: overrides.compatibilityFacts ?? base.compatibilityFacts,
    chat: overrides.chat ?? base.chat,
    voice: overrides.voice ?? base.voice,
  };
}

test("requires de-identification confirmation before calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request({ ...validBody, deidentificationConfirmed: false }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "confirmation_required");
  assert.equal(called, false);
});

test("accepts a concrete approved outcome and calls the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 200);
  assert.equal(called, true);
});

test("accepts behavior-focused handling guidance before calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse({ ...generated, assumptions: ["MISSING_POLICY"] });
    },
  });

  const response = await handler(request({
    ...validBody,
    learnerGoal: "Acknowledge the customer's concern and ask what happened.",
    correctProcess: "Acknowledge the customer's concern and ask what happened.",
  }));

  assert.equal(response.status, 200);
  assert.equal(called, true);
  assert.equal((await response.json()).assumptions.includes("MISSING_POLICY"), false);
});

test("accepts discovery-question guidance before calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request({
    ...validBody,
    learnerGoal: "Ask open-ended questions about the customer's concern.",
    correctProcess: "Ask open-ended questions about the customer's concern.",
  }));

  assert.equal(response.status, 200);
  assert.equal(called, true);
});

test("accepts detailed behavior guidance when resolution remains open for review", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse({ ...generated, assumptions: ["MISSING_POLICY"] });
    },
  });

  const correctProcess = [
    "Acknowledge the pet parent’s frustration and concern about having enough food for Pepper.",
    "Ask focused questions to understand what happened, what the pet parent has already checked, and how much food they have remaining.",
    "Confirm the outcome the pet parent needs before recommending a resolution.",
    "Explain the available next steps clearly and set accurate expectations.",
    "Confirm the agreed resolution, recap what will happen next, and ask whether the pet parent needs anything else.",
    "Avoid: Do not blame the delivery carrier or suggest that the pet parent did not look carefully enough.",
    "Avoid: Do not guarantee a delivery date or outcome that has not been confirmed.",
    "Avoid: Do not offer compensation or make exceptions that have not been approved.",
  ].join("\n");
  const response = await handler(request({
    ...validBody,
    learnerGoal: correctProcess,
    correctProcess,
  }));

  assert.equal(response.status, 200);
  assert.equal(called, true);
  assert.equal((await response.json()).assumptions.includes("MISSING_POLICY"), false);
});

test("repairs behavior-focused phases when the approved resolution remains open for review", async () => {
  let providerCalls = 0;
  const diagnostics: Array<Record<string, unknown>> = [];
  const correctProcess = [
    "Acknowledge the pet parent’s frustration and concern about having enough food for Pepper.",
    "Ask focused questions to understand what happened, what the pet parent has already checked, and how much food they have remaining.",
    "Confirm the outcome the pet parent needs before recommending a resolution.",
    "Explain the available next steps clearly and set accurate expectations.",
    "Confirm the agreed resolution, recap what will happen next, and ask whether the pet parent needs anything else.",
    "Avoid: Do not blame the delivery carrier or suggest that the pet parent did not look carefully enough.",
    "Avoid: Do not guarantee a delivery date or outcome that has not been confirmed.",
    "Avoid: Do not offer compensation or make exceptions that have not been approved.",
  ].join("\n");
  const behaviorPhases = [
    {
      ...generated.phases[0],
      id: "acknowledge_concern",
      learnerActions: ["Acknowledge the pet parent's frustration and concern."],
      chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["show empathy", "customer concern"] }],
    },
    {
      ...generated.phases[0],
      id: "discover_context",
      learnerActions: ["Ask what happened, what the pet parent has already checked, and how much food remains."],
      chatAdvanceRequirements: [{ id: "discovery_questions", phrases: ["ask focused questions", "understand situation"] }],
    },
    {
      ...generated.phases[0],
      id: "confirm_needed_outcome",
      learnerActions: ["Confirm the outcome the pet parent needs before recommending a resolution."],
      chatAdvanceRequirements: [{ id: "outcome_preference", phrases: ["confirm the outcome", "recommended resolution"] }],
    },
    {
      ...generated.phases[0],
      id: "explain_next_steps",
      learnerActions: ["Explain the available next steps clearly and set accurate expectations."],
      chatAdvanceRequirements: [{ id: "next_steps", phrases: ["explain the next steps", "set clear expectations"] }],
    },
    {
      ...generated.phases[0],
      id: "personalized_reassurance",
      learnerActions: ["Provide personalized reassurance that reflects the pet parent's situation."],
      chatAdvanceRequirements: [{ id: "closing", phrases: ["confirm resolution and recap", "anything else I can help with"] }],
    },
    {
      ...generated.phases[0],
      id: "document_conversation",
      learnerActions: ["Document the conversation for future reference."],
      chatAdvanceRequirements: [{ id: "summary", phrases: ["document conversation", "future reference"] }],
    },
  ];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    logError: (diagnostic) => diagnostics.push(diagnostic as unknown as Record<string, unknown>),
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        learnerGoal: correctProcess,
        customer: {
          ...generated.customer,
          name: "Taylor",
          petName: "Pepper",
          openingLine: "My Autoship order says delivered, but I cannot find it.",
        },
        phases: behaviorPhases,
        objectives: [{
          ...generated.objectives[0],
          id: "handle_missing_order",
          criteria: [
            "Acknowledge the pet parent's concern.",
            "Ask focused discovery questions.",
            "Confirm the needed outcome before recommending a resolution.",
            "Explain next steps and set accurate expectations.",
            "Recap the agreed resolution and offer additional help.",
          ],
        }],
        assumptions: ["MISSING_POLICY"],
      });
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional pet parent cannot find an Autoship order marked delivered and has food through tomorrow.",
    learnerGoal: correctProcess,
    correctProcess,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify({ error: payload.error, diagnostics }));
  assert.equal(providerCalls, 2);
  assert.equal(payload.draft.phases.length, 5);
  assert.equal(payload.assumptions.includes("MISSING_POLICY"), false);
  assert.deepEqual(payload.draft.phases.map((phase: { chatAdvanceRequirements: Array<{ id: string }> }) =>
    phase.chatAdvanceRequirements.map((requirement) => requirement.id)
  ), [
    ["acknowledge_empathy"],
    ["discovery_question"],
    ["outcome_question_intent", "outcome_preference"],
    ["next_steps", "expectation_setting"],
    ["agreed_resolution", "recap", "additional_help_question", "closing"],
  ]);
  assert.doesNotMatch(JSON.stringify(payload.draft), /refund|replacement/iu);
  assert.match(payload.draft.phases[4].learnerActions[0], /Confirm the agreed resolution/iu);
  assert.doesNotMatch(JSON.stringify(payload.draft.phases), /personalized reassurance|future reference/iu);
});

test("requires a concrete approved outcome before calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request({
    ...validBody,
    learnerGoal: "Help the customer with the delayed order.",
    correctProcess: "Acknowledge the concern, confirm the details, and help the customer.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(payload.error, {
    code: "approved_resolution_required",
    message: "Describe the exact approved action and expected outcome before Coach Chewy builds the draft.",
  });
  assert.equal(called, false);
});

test("rejects action-shaped placeholders before calling the provider", async (t) => {
  let calls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return providerResponse(generated);
    },
  });

  for (const correctProcess of [
    "Submit a request.",
    "Provide the approved refund options.",
    "Create a replacement order if appropriate.",
    "Explain the appropriate next steps to the customer.",
    "Confirm the approved resolution with the customer.",
    "Submit the appropriate request for the customer.",
    "Create a detailed plan for the customer.",
  ]) {
    await t.test(correctProcess, async () => {
      const response = await handler(request({ ...validBody, correctProcess }));

      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, "approved_resolution_required");
    });
  }
  assert.equal(calls, 0);
});

test("keeps the server-approved new-scenario outcome authoritative when the provider marks policy missing", async () => {
  let developerInstructions = "";
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        input: Array<{ role: string; content: Array<{ text: string }> }>;
      };
      developerInstructions = payload.input.find(({ role }) => role === "developer")!.content[0].text;
      return providerResponse({ ...generated, assumptions: ["MISSING_POLICY"] });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.correctProcess, [validBody.correctProcess]);
  assert.equal(payload.assumptions.some((value: string) => value.startsWith("MISSING_POLICY")), false);
  assert.match(developerInstructions, /MISSING_POLICY/);
});

test("deterministically grounds generated resolution facts to the creator-approved amount", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse(generatedRefundWithAmount("$0.49"));
    },
  });
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: "Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. Do not offer store credit, a replacement, or an exchange.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 1);
  assert.doesNotMatch(JSON.stringify(payload.draft), /\$0\.49/u);
  assert.match(JSON.stringify(payload.draft.phases), /\$32\.49/u);
  assert.match(JSON.stringify(payload.draft.objectives), /\$32\.49/u);
  assert.deepEqual(payload.draft.phases[1].chatAdvanceRequirements[0], {
    id: "refund_amount",
    phrases: expectedRefundAmountPhrases,
  });
});

test("grounds valid provider output that omits approved replacement requirements", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse(generated);
    },
  });
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received the wrong dog food and needs the correct item.",
    correctProcess: "Acknowledge the concern. Offer a no-cost replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. Tell the customer they do not need to return the wrong item. Do not offer a refund or store credit.",
  }));
  const payload = await response.json();
  const learnerActions = payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions);

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 1);
  assert.equal(learnerActions.includes("Offer a no-cost replacement."), true);
  assert.equal(learnerActions.includes("Ask whether Jordan wants a replacement."), true);
  assert.equal(learnerActions.includes("Place a no-cost replacement order."), true);
  assert.equal(learnerActions.includes("Tell the Conversation Partner they do not need to return the item."), true);
});

test("recompiles incomplete Chat gates from verified approved replacement actions", async () => {
  const providerDraft = {
    ...generated,
    customer: {
      ...generated.customer,
      openingLine: "The wrong dog food arrived and I need the correct item.",
    },
    prohibitedActions: ["Do not offer a refund or store credit."],
    phases: [
      {
        ...generated.phases[0],
        id: "offer_and_confirm_replacement",
        learnerActions: [
          "Acknowledge the Conversation Partner's concern.",
          "Offer a no-cost replacement.",
          "Ask whether Jordan wants a replacement.",
        ],
        chatAdvanceRequirements: [{ id: "acknowledge_empathy", phrases: expectedEmpathyPhrases }],
        partnerResponse: "Yes, I want a replacement.",
        coachGuidance: [
          "Acknowledge the concern.",
          "Offer a no-cost replacement.",
          "Ask whether Jordan wants a replacement.",
        ],
      },
      {
        ...generated.phases[0],
        id: "complete_replacement",
        learnerActions: [
          "Place a no-cost replacement order.",
          "Tell the Conversation Partner they do not need to return the item.",
        ],
        chatAdvanceRequirements: [{
          id: "replacement_completion",
          phrases: ["placed the replacement order", "submitted the replacement order"],
        }],
        partnerResponse: "Thank you for resolving this.",
        coachGuidance: [
          "Place the no-cost replacement.",
          "Explain that no return is needed.",
        ],
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: [
        "Acknowledge the Conversation Partner's concern.",
        "Offer a no-cost replacement.",
        "Ask whether Jordan wants a replacement.",
        "Place a no-cost replacement order.",
        "Tell the Conversation Partner they do not need to return the item.",
      ],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received the wrong dog food and needs the correct item.",
    correctProcess: "Acknowledge the concern. Offer a no-cost replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. Tell the customer they do not need to return the wrong item. Do not offer a refund or store credit.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(
    payload.draft.phases[0].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["acknowledge_empathy", "replacement_question_intent", "replacement_resolution", "replacement_no_cost"],
  );
  assert.deepEqual(
    payload.draft.phases[1].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["replacement_no_cost", "replacement_completion", "no_return"],
  );

  const authoring = normalizeStudioDraft(standaloneToAuthoringDraft(payload.draft, {
    conversationAbout: "A fictional customer received the wrong dog food and needs the correct item.",
    learnerApproach: "Offer and place a no-cost replacement after confirmation, with no return required.",
    deidentificationConfirmed: true,
  }));
  const downloadableDraft = authoringToStandaloneDraft(authoring);
  const validationResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadableDraft,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadableDraft.objectives),
      },
    }),
  }));
  const validationPayload = await validationResponse.json();

  assert.equal(validationResponse.status, 200, JSON.stringify(validationPayload.issues));
  assert.equal(validationPayload.ok, true);
  const chat = validationPayload.files.find((file: { scenario: { channels: string[] } }) =>
    file.scenario.channels[0] === "chat"
  ).scenario;
  const openingStep = chat.chatConfig.stepProgression[0];
  const openingPhraseSets = openingStep.match.all.map((condition: { phrases: string[] }) =>
    JSON.stringify(condition.phrases)
  );
  assert.equal(new Set(openingPhraseSets).size, openingPhraseSets.length);
  const completionStep = chat.chatConfig.stepProgression[1];
  assert.deepEqual(Object.keys(completionStep.match).sort(), ["all", "any"]);
  const riseMatches = (message: string) => {
    const normalized = message.toLowerCase();
    const conditionMatches = (condition: { op: string; phrases: string[] }) =>
      condition.op === "contains_any"
      && condition.phrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
    return (!completionStep.match.all.length || completionStep.match.all.every(conditionMatches))
      && (!completionStep.match.any.length || completionStep.match.any.some(conditionMatches));
  };
  assert.equal(riseMatches("I placed the replacement order at no charge, and you don't need to return the item."), true);
  assert.equal(riseMatches("I placed a replacement order at no charge, and you don't need to return the item."), true);
  assert.equal(riseMatches("Your replacement order has been placed at no charge, and you don't need to return the item."), true);
  assert.equal(riseMatches("It is at no charge, and you don't need to return the item."), false);
  assert.equal(riseMatches("I placed the replacement order, and you don't need to return the item."), false);
  assert.equal(riseMatches("I placed the replacement order at no charge."), false);
});

test("recompiles ordinary replacement completion gates without a no-cost requirement", async () => {
  const providerDraft = {
    ...generated,
    prohibitedActions: ["Do not offer a refund."],
    phases: [
      {
        ...generated.phases[0],
        id: "confirm_replacement",
        learnerActions: ["Ask whether Jordan wants a replacement."],
        chatAdvanceRequirements: [
          { id: "replacement_question_intent", phrases: expectedQuestionIntentPhrases },
          { id: "replacement_resolution", phrases: ["replacement", "replacement order"] },
        ],
        partnerResponse: "Yes, I want a replacement.",
      },
      {
        ...generated.phases[0],
        id: "complete_replacement",
        learnerActions: ["Place the replacement order."],
        chatAdvanceRequirements: [{
          id: "replacement_resolution",
          phrases: ["replacement", "replacement order"],
        }],
        partnerResponse: "Thank you for resolving this.",
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: [
        "Ask whether Jordan wants a replacement.",
        "Place the replacement order.",
      ],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    correctProcess: "Confirm the customer wants the replacement before placing it. After confirmation, place the replacement.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(
    payload.draft.phases[1].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["replacement_completion"],
  );
});

test("grounds an omitted ordinary replacement completion action", async () => {
  const providerDraft = {
    ...generated,
    prohibitedActions: ["Do not offer a refund."],
    phases: [{
      ...generated.phases[0],
      id: "confirm_replacement",
      learnerActions: ["Ask whether Jordan wants a replacement."],
      chatAdvanceRequirements: [
        { id: "replacement_question_intent", phrases: expectedQuestionIntentPhrases },
        { id: "replacement_resolution", phrases: ["replacement", "replacement order"] },
      ],
      partnerResponse: "Yes, I want a replacement.",
    }],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: ["Ask whether Jordan wants a replacement."],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    correctProcess: "Confirm the customer wants the replacement before placing it. After confirmation, place the replacement.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(
    payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions)
      .includes("Place the replacement order."),
    true,
  );
});

test("grounds keep and dispose no-return guidance when the provider omits it", async () => {
  for (const noReturnGuidance of [
    "Tell the customer to keep the damaged bag.",
    "Tell the customer to dispose of the damaged bag.",
    "Tell the customer they can keep the wrong item.",
    "Tell the customer they can keep the wrong item rather than return it.",
    "Tell the customer they can keep or dispose of the wrong item.",
    "Tell the customer they can keep the wrong item or dispose of it.",
    "Tell the customer they do not have to return the wrong item.",
    "Tell the customer they will not have to return the wrong item.",
    "Tell the customer they won't have to return the wrong item.",
    "Tell the customer they are not required to return the wrong item.",
    "Tell the customer they will not be required to return the wrong item.",
    "Tell the customer they won't be required to return the wrong item.",
    "Tell the customer they may dispose of the wrong item.",
  ]) {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse(generated),
    });
    const response = await handler(request({
      ...validBody,
      correctProcess: `Offer a replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. ${noReturnGuidance} Do not offer a refund.`,
    }));
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload.error));
    assert.equal(
      payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions)
        .includes("Tell the Conversation Partner they do not need to return the item."),
      true,
      noReturnGuidance,
    );
  }
});

test("does not invent no-return guidance from information, care, safety, or carrier wording", async () => {
  const providerDraft = {
    ...generated,
    prohibitedActions: ["Do not offer a refund."],
    phases: [
      {
        ...generated.phases[0],
        id: "offer_and_confirm_replacement",
        learnerActions: ["Offer a replacement.", "Ask whether Jordan wants a replacement."],
        chatAdvanceRequirements: [{ id: "replacement_resolution", phrases: ["replacement", "replacement order"] }],
        partnerResponse: "Yes, I want a replacement.",
      },
      {
        ...generated.phases[0],
        id: "complete_replacement",
        learnerActions: ["Place the replacement order."],
        chatAdvanceRequirements: [{ id: "replacement_resolution", phrases: ["replacement", "replacement order"] }],
        partnerResponse: "Thank you for resolving this.",
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: [
        "Offer a replacement.",
        "Ask whether Jordan wants a replacement.",
        "Place the replacement order.",
      ],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    correctProcess: "Offer a replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. Tell the customer to keep informed about the replacement item. Tell the customer to keep the item in its original packaging for carrier pickup. Tell the customer to keep the replacement product refrigerated. Tell the customer to keep the replacement item away from children. Tell the customer not to dispose of the damaged replacement item because FedEx will collect it. Tell the customer they do not need a box to return the wrong item. Tell the customer they do not need to return the item today because UPS will collect it tomorrow. Do not offer a refund.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.doesNotMatch(JSON.stringify(payload.draft.phases), /do not need to return/i);
});

test("preserves atomic offer and no-cost wording while grounding its Chat gates", async () => {
  const offerActions = [
    "Acknowledge the Conversation Partner's concern.",
    "Offer a replacement.",
    "Explain that it is at no charge.",
    "Ask whether Jordan wants a replacement.",
  ];
  const providerDraft = {
    ...generated,
    prohibitedActions: ["Do not offer a refund."],
    phases: [
      {
        ...generated.phases[0],
        id: "offer_and_confirm_replacement",
        learnerActions: offerActions,
        chatAdvanceRequirements: [{ id: "acknowledge_empathy", phrases: expectedEmpathyPhrases }],
        partnerResponse: "Yes, I want a replacement.",
      },
      {
        ...generated.phases[0],
        id: "complete_replacement",
        learnerActions: ["Place the replacement order."],
        chatAdvanceRequirements: [{ id: "replacement_resolution", phrases: ["replacement", "replacement order"] }],
        partnerResponse: "Thank you for resolving this.",
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: [...offerActions, "Place the replacement order."],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    correctProcess: "Acknowledge the concern. Offer a replacement. Explain that the replacement is at no charge. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. Do not offer a refund.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.phases[0].learnerActions, offerActions);
  assert.deepEqual(
    payload.draft.phases[0].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["acknowledge_empathy", "replacement_question_intent", "replacement_resolution", "replacement_no_cost"],
  );
  assert.deepEqual(
    payload.draft.phases[1].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["replacement_completion"],
  );
});

test("does not treat free return shipping as a no-cost replacement", async () => {
  const providerDraft = {
    ...generated,
    prohibitedActions: ["Do not offer a refund."],
    phases: [
      {
        ...generated.phases[0],
        id: "offer_and_confirm_replacement",
        learnerActions: ["Offer a replacement.", "Ask whether Jordan wants a replacement."],
        chatAdvanceRequirements: [{ id: "replacement_resolution", phrases: ["replacement", "replacement order"] }],
        partnerResponse: "Yes, I want a replacement.",
      },
      {
        ...generated.phases[0],
        id: "explain_return_shipping",
        learnerActions: [
          "Explain that return shipping is free of charge.",
          "Explain that shipping is free of charge.",
          "Explain that the prepaid return label is at no charge.",
          "Explain that gift wrap is at no charge.",
        ],
        chatAdvanceRequirements: [{
          id: "return_shipping_cost",
          phrases: ["free return shipping", "no return shipping cost"],
        }],
        partnerResponse: "That helps.",
      },
      {
        ...generated.phases[0],
        id: "complete_replacement",
        learnerActions: ["Place the replacement order."],
        chatAdvanceRequirements: [{ id: "replacement_resolution", phrases: ["replacement", "replacement order"] }],
        partnerResponse: "Thank you for resolving this.",
      },
    ],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: [
        "Offer a replacement.",
        "Ask whether Jordan wants a replacement.",
        "Explain that return shipping is free of charge.",
        "Explain that shipping is free of charge.",
        "Explain that the prepaid return label is at no charge.",
        "Explain that gift wrap is at no charge.",
        "Place the replacement order.",
      ],
    }],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });
  const response = await handler(request({
    ...validBody,
    correctProcess: "Offer a replacement. Explain that return shipping is free of charge. Explain that shipping is free of charge. Explain that the prepaid return label is at no charge. Explain that gift wrap is at no charge. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement. Do not offer a refund.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(
    payload.draft.phases.flatMap((phase: { chatAdvanceRequirements: Array<{ id: string }> }) =>
      phase.chatAdvanceRequirements.map((requirement) => requirement.id)
    ).includes("replacement_no_cost"),
    false,
  );
  assert.equal(
    payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions)
      .includes("Place the replacement order."),
    true,
  );
});

test("rejects a missing-policy marker for an imported scenario without a server-approved outcome", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      assumptions: ["MISSING_POLICY: the replacement threshold was not supplied"],
    }),
  });

  const response = await handler(request({
    ...validBody,
    mode: "similar",
    correctProcess: undefined,
    sourceDraft: importedDraft(),
  }));

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "approved_resolution_required");
});

test("infers Rx from the original two-question Build answers and keeps it authoritative", async () => {
  let providerInput: Record<string, unknown> | undefined;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        input: Array<{ role: string; content: Array<{ text: string }> }>;
      };
      providerInput = JSON.parse(payload.input.find(({ role }) => role === "user")!.content[0].text);
      return providerResponse({
        ...generated,
        agentType: "Core",
        topic: "Pharmacy Support",
        subtopic: "Prescription refill",
      });
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional pet parent needs help with a delayed prescription refill from Chewy Pharmacy.",
    learnerGoal: "Explain the medication refill status and the approved next step.",
    correctProcess: "Confirm the prescription details, submit a case to the Pharmacy team, and tell the customer the case was submitted for review.",
    agentType: undefined,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerInput?.agentType, "Rx");
  assert.equal(payload.draft.agentType, "Rx");
  assert.equal(payload.draft.chat.hotkeyProfile, "rx");
});

test("requires a JSON content type before accepting generation input", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });
  const response = await handler(new Request("http://localhost/api/builder/generate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify(validBody),
  }));

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "unsupported_media_type");
  assert.equal(called, false);
});

test("blocks personal data before calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request({ ...validBody, situation: "Email the real customer at casey@personalmail.com." }));

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "privacy_blocked");
  assert.deepEqual(payload.error.details, [{ code: "email_address", path: "situation" }]);
  assert.equal(called, false);
});

test("rejects oversized request bodies before buffering or calling the provider", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });
  const oversized = new Request("http://localhost/api/builder/generate", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1500001" },
    body: "{}",
  });

  const response = await handler(oversized);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "request_too_large");
  assert.equal(called, false);
});

test("returns an actionable client error for malformed input", async () => {
  const response = await createGenerateHandler({ apiKey: "test-key" })(request({ nope: true }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("accepts the new-scenario browser payload with a null source draft", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(generated),
  });

  const response = await handler(request({ ...validBody, sourceDraft: null }));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.baseId, "late_dog_food_order");
});

test("returns a configuration error without exposing or calling an absent key", async () => {
  let called = false;
  const handler = createGenerateHandler({
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "generation_not_configured");
  assert.equal(called, false);
});

test("reports safe diagnostics when the provider rejects a generation request", async () => {
  const diagnostics: unknown[] = [];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    logError: (diagnostic) => diagnostics.push(diagnostic),
    fetchImpl: async () => Response.json(
      { error: { code: "model_not_found", message: "Provider detail that must not be logged." } },
      { status: 400, headers: { "x-request-id": "req_test_123" } },
    ),
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 502);
  assert.deepEqual(diagnostics, [{
    stage: "provider_response",
    providerStatus: 400,
    providerErrorCode: "model_not_found",
    providerRequestId: "req_test_123",
  }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /Provider detail|test-key/);
});

test("reports a redacted diagnostic when the provider request throws", async () => {
  const diagnostics: unknown[] = [];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    logError: (diagnostic) => diagnostics.push(diagnostic),
    fetchImpl: async () => { throw new TypeError("Network failed near sk-secretvalue123."); },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 502);
  assert.deepEqual(diagnostics, [{
    stage: "provider_request",
    errorName: "TypeError",
    errorMessage: "Network failed near [redacted].",
  }]);
});

test("uses the Worker runtime binding for provider configuration", async () => {
  let authorization = "";
  const handler = createGenerateHandler({
    runtimeEnv: {
      OPENAI_API_KEY: "worker-binding-test-key",
      OPENAI_AUTHORING_MODEL: "worker-binding-test-model",
    },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 200);
  assert.equal(authorization, "Bearer worker-binding-test-key");
});

test("trims surrounding whitespace from the hosted API key before building the authorization header", async () => {
  let authorization = "";
  const handler = createGenerateHandler({
    runtimeEnv: { OPENAI_API_KEY: "  worker-binding-test-key\n" },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 200);
  assert.equal(authorization, "Bearer worker-binding-test-key");
});

test("removes embedded whitespace from a hosted API key before building the authorization header", async () => {
  let authorization = "";
  const handler = createGenerateHandler({
    runtimeEnv: { OPENAI_API_KEY: "worker-binding-\ntest-key" },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") || "";
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 200);
  assert.equal(authorization, "Bearer worker-binding-test-key");
});

test("uses a supported Responses API model when no authoring model is configured", async () => {
  let providerModel = "";
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      providerModel = JSON.parse(String(init?.body)).model;
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 200);
  assert.equal(providerModel, "gpt-5-mini");
});

test("sends one strict, tool-free, non-stored request and returns a normalized draft", async () => {
  let providerRequest: RequestInit | undefined;
  const handler = createGenerateHandler({
    apiKey: "server-only-test-key",
    model: "test-model",
    fetchImpl: async (_input, init) => {
      providerRequest = init;
      return providerResponse(generated);
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();
  const sent = JSON.parse(String(providerRequest?.body));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(sent.model, "test-model");
  assert.equal(sent.store, false);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.type, "json_schema");
  assert.equal(sent.text.format.schema.properties.phases.items.required.includes("strongLearnerResponse"), true);
  assert.match(sent.input[0].content[0].text, /complete, natural response the Learner could say directly/);
  assert.equal(payload.draft.baseId, "late_dog_food_order");
  assert.deepEqual(payload.draft.channels, ["chat", "voice"]);
  assert.equal(payload.draft.chat.hotkeyProfile, "core");
  assert.equal(payload.draft.chat.standardTextRecommendations.length > 0, true);
  assert.equal(payload.draft.chat.standardTextRecommendations.length <= 3, true);
  assert.equal(payload.draft.voice.selectedVoice, "marin");
  assert.equal(payload.draft.phases[0].strongLearnerResponse, generated.phases[0].strongLearnerResponse);
  assert.deepEqual(payload.assumptions, generated.assumptions);
});

test("normalizes generated objective criteria to neutral imperative wording", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      objectives: [{
        ...generated.objectives[0],
        criteria: [
          "Acknowledges the customer's concern clearly.",
          "Clearly explains the expected delivery window.",
          "Tells the customer no return is needed.",
          "Telling the customer to keep the damaged bag.",
          "Does not guarantee the delivery date.",
        ],
      }],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.objectives[0].criteria, [
    "Acknowledge the customer's concern clearly.",
    "Explain clearly the expected delivery window.",
    "Tell the customer no return is needed.",
    "Tell the customer to keep the damaged bag.",
    "Do not guarantee the delivery date.",
  ]);

  const authoring = normalizeStudioDraft(standaloneToAuthoringDraft(payload.draft));
  const downloadableDraft = authoringToStandaloneDraft(authoring);
  assert.deepEqual(downloadableDraft.objectives[0].criteria.slice(2, 4), [
    "Tell the customer no return is needed.",
    "Tell the customer to keep the damaged bag.",
  ]);
  const validationResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadableDraft,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadableDraft.objectives),
      },
    }),
  }));
  const validationPayload = await validationResponse.json();

  assert.equal(validationResponse.status, 200, JSON.stringify(validationPayload.issues));
  assert.equal(validationPayload.ok, true);
});

test("normalizes positive model output into explicit prohibited actions before Review/Edit", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      const groundedRefund = generatedRefundWithAmount("$32.49");
      const resolutionBoundary = providerCalls === 1
        ? "Offer store credit instead of refund."
        : "Offer store credit, a replacement, or an exchange.";
      return providerResponse({
        ...groundedRefund,
        correctProcess: [
          ...groundedRefund.correctProcess,
          resolutionBoundary,
        ],
        prohibitedActions: [
          ...(providerCalls === 1 ? ["Offer a replacement bag."] : []),
          resolutionBoundary,
          "Promise immediate or expedited refund beyond 3-5 business days.",
          "Provide medical advice or product guarantees.",
        ],
        phases: groundedRefund.phases.map((phase, index) => index === 0 ? {
          ...phase,
          learnerActions: [...phase.learnerActions, resolutionBoundary],
          coachGuidance: [...phase.coachGuidance, resolutionBoundary],
        } : phase),
        objectives: [{
          ...groundedRefund.objectives[0],
          criteria: [
            ...groundedRefund.objectives[0].criteria,
            resolutionBoundary,
          ],
        }],
      });
    },
  });

  const generatedResponse = await handler(request({
    ...validBody,
    situation: "A fictional customer received a torn dog food bag and wants a refund.",
    learnerGoal: "Issue the exact approved refund without offering alternatives.",
    correctProcess: "Issue an exact $32.49 refund to the original payment card and explain that it may take 3-5 business days.",
  }));
  const generatedPayload = await generatedResponse.json();

  assert.equal(generatedResponse.status, 200);
  assert.equal(providerCalls, 2);
  assert.deepEqual(generatedPayload.draft.prohibitedActions, [
    "Do not offer store credit, a replacement, or an exchange.",
    "Do not promise immediate or expedited refund beyond 3-5 business days.",
    "Do not provide medical advice or product guarantees.",
  ]);
  assert.equal(
    JSON.stringify({
      correctProcess: generatedPayload.draft.correctProcess,
      phases: generatedPayload.draft.phases,
      objectives: generatedPayload.draft.objectives,
    }).includes('"Offer store credit instead of refund."'),
    false,
  );
  assert.equal(
    generatedPayload.draft.phases.some((phase: { coachGuidance: string[] }) =>
      phase.coachGuidance.includes("Offer store credit, a replacement, or an exchange.")
    ),
    false,
  );

  const authoring = normalizeStudioDraft(standaloneToAuthoringDraft(
    generatedPayload.draft,
    { deidentificationConfirmed: true },
  ));
  const downloadableDraft = authoringToStandaloneDraft(authoring);
  const validationResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadableDraft,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadableDraft.objectives),
      },
    }),
  }));
  const validationPayload = await validationResponse.json();

  assert.equal(validationResponse.status, 200, JSON.stringify(validationPayload.issues));
  assert.equal(
    downloadableDraft.objectives.flatMap((objective) => objective.criteria)
      .some((criterion) => /^Offer store credit instead of refund\.?$/i.test(criterion)),
    false,
  );
});

test("canonicalizes subject-led generated prohibitions without double negatives", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      prohibitedActions: [
        "The learner must not offer store credit, a replacement, or an exchange.",
        "The agent cannot provide medical advice.",
        "The learner should avoid promising an expedited refund.",
        "The representative doesn't guarantee an arrival date.",
        "The agent won’t promise immediate delivery.",
      ],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit, a replacement, or an exchange.",
    "Do not provide medical advice.",
    "Avoid promising an expedited refund.",
    "Do not guarantee an arrival date.",
    "Do not promise immediate delivery.",
  ]);
  assert.equal(payload.draft.prohibitedActions.some((action: string) => /do not not/iu.test(action)), false);
});

test("preserves compound replacement nouns in generated prohibitions", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      prohibitedActions: [
        "Offer a replacement delivery date.",
        "Offer a replacement order confirmation.",
      ],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer a replacement delivery date.",
    "Do not offer a replacement order confirmation.",
  ]);
});

test("removes learner actions from generated customer rules and preserves negative guardrails", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        behaviorRules: [
          "Do not offer store credit.",
          "The learner must not offer a replacement.",
          "The agent should avoid offering a discount.",
          "The learner must avoid guaranteeing delivery.",
          "Issue a full refund to the original payment card only.",
          "Explain the refund timeline to the customer.",
          "Inform the customer that the refund will post in 3–5 business days.",
          "Remain disappointed until the learner confirms the refund.",
        ],
      },
      prohibitedActions: [],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.customer.behaviorRules, [
    "Remain disappointed until the learner confirms the refund.",
  ]);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit.",
    "Do not offer a replacement.",
    "Avoid offering a discount.",
    "Avoid guaranteeing delivery.",
  ]);
});

test("migrates contracted and modal learner prohibitions into prohibited actions", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        behaviorRules: [
          "The agent can't offer store credit.",
          "The learner may not offer a replacement.",
          "The representative could not guarantee the timeline.",
          "Remain disappointed until the learner confirms the refund.",
        ],
      },
      prohibitedActions: [],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.customer.behaviorRules, [
    "Remain disappointed until the learner confirms the refund.",
  ]);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit.",
    "Do not offer a replacement.",
    "Do not guarantee the timeline.",
  ]);
});

test("rejects any negative learner rule when it cannot be migrated safely", async () => {
  for (const rule of [
    "The learner is prohibited from offering store credit.",
    "The learner isn't allowed to offer store credit.",
    "The agent isn’t permitted to guarantee delivery.",
    "The agent aren't supposed to guarantee delivery.",
    "The representative wasn't permitted to offer a replacement.",
    "The learner weren't authorized to issue store credit.",
    "The agent needn't offer a discount.",
  ]) {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          behaviorRules: [
            rule,
            "Remain disappointed until the learner confirms the refund.",
          ],
        },
        prohibitedActions: [],
      }),
    });

    const response = await handler(request(validBody));
    const payload = await response.json();

    assert.equal(response.status, 502, rule);
    assert.equal(payload.error.code, "generation_unavailable", rule);
  }
});

for (const [apostropheStyle, rule] of [
  [
    "ASCII",
    "The learner who has thoroughly reviewed all approved account and customer information isn't allowed to offer store credit.",
  ],
  [
    "curly",
    "The learner who has thoroughly reviewed all approved account and customer information isn’t allowed to offer store credit.",
  ],
] as const) {
  test(`rejects a long ${apostropheStyle} n't learner rule instead of silently removing it`, async () => {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          behaviorRules: [rule],
        },
        prohibitedActions: [],
      }),
    });

    const response = await handler(request(validBody));
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error.code, "generation_unavailable");
  });
}

test("normalizes generic objective IDs and subject-led or gerund criteria", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Issue and process the approved full refund to the original payment card."],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "obj1",
        label: "Refund Process Accuracy",
        criteria: [
          "Issuing a full refund to the original payment card.",
          "The agent informs the customer when the refund will post.",
          "Processing the approved refund without changing the destination.",
        ],
      }],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.draft.objectives[0].id, "refund_process_accuracy");
  assert.deepEqual(payload.draft.objectives[0].criteria, [
    "Issue a full refund to the original payment card.",
    "Inform the customer when the refund will post.",
    "Process the approved refund without changing the destination.",
  ]);
  assert.doesNotMatch(JSON.stringify(payload.draft.objectives), /Show this behavior:/);
});

test("rejects generated Chat gates when required behavior cannot be compiled safely", async () => {
  for (const phases of [
    [{
      ...generated.phases[0],
      chatAdvanceRequirements: [{ id: "courtesy", phrases: ["thank", "help"] }],
    }],
    [{
      ...generated.phases[0],
      chatAdvanceRequirements: [{ id: "resolution", phrases: ["store credit", "replacement"] }],
    }],
  ]) {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...generated,
        prohibitedActions: ["Do not offer store credit or a replacement."],
        phases,
      }),
    });

    const response = await handler(request(validBody));
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error.code, "generation_unavailable");
  }
});

test("repairs generated response ordering that makes a required preference redundant", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        openingLine: "The dog food bag arrived torn, so I'd like a full refund.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the damage and confirm whether the customer wants a refund."],
        chatAdvanceRequirements: [
          { id: "acknowledgement", phrases: ["sorry about the damage", "acknowledge the torn bag"] },
          { id: "refund_preference", phrases: ["want a refund", "prefer a refund"] },
        ],
        partnerResponse: "Yes, I want a refund to my original payment card.",
      }],
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(payload.draft.customer.openingLine, "The dog food bag arrived torn.");
  assert.match(payload.draft.phases[0].partnerResponse, /want a refund/i);
});

test("retries generated response ordering when removing the disclosed preference would empty the opening", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          openingLine: providerCalls === 1
            ? "A full refund is what I need."
            : "The dog food bag arrived torn and the contents spilled.",
        },
        phases: [{
          ...generated.phases[0],
          learnerActions: ["Confirm the customer's requested resolution."],
          chatAdvanceRequirements: [
            { id: "resolution_preference", phrases: ["want a refund", "prefer a refund"] },
          ],
          partnerResponse: "Yes, I want a full refund to my original payment card.",
        }],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.equal(payload.draft.customer.openingLine, "The dog food bag arrived torn and the contents spilled.");
});

test("drops generated follow-ups that request an explicitly rejected option", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        openingLine: "The damaged bag is unusable, and I want a refund.",
        goal: "Receive a refund to the original payment card.",
        objections: ["I don't want store credit or a replacement."],
        conditionalFollowUps: [
          "Why isn't a replacement possible?",
          "Could you send a replacement instead?",
        ],
      },
      compatibilityFacts: {
        ...generated.compatibilityFacts,
        conditionalFollowUp: "Could you send a replacement instead?",
      },
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.customer.conditionalFollowUps, []);
  assert.equal(payload.draft.compatibilityFacts.conditionalFollowUp, "");
});

test("retries generated full-turn Chat gates and accepts compact numeric anchors", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          openingLine: "Hi, I just got my 40-pound bag of dry dog food and the bag is torn. The food spilled everywhere and it's unusable. I want a full refund.",
          goal: "Receive a full refund for the torn dog food bag.",
          objections: ["No, I don't want store credit or a replacement."],
          conditionalFollowUps: ["Why can't I get a replacement?"],
        },
        compatibilityFacts: {
          ...generated.compatibilityFacts,
          conditionalFollowUp: "Why can't I get a replacement?",
        },
        phases: [{
          ...generated.phases[0],
          learnerActions: [
            "Acknowledge the torn bag and the inconvenience caused.",
            "Ask if Taylor wants a refund for the damaged item.",
          ],
          chatAdvanceRequirements: providerCalls === 1
            ? [{
                id: "refund_amount",
                phrases: [
                  "Issue the refund to original card",
                  "Process refund to original payment card",
                ],
              }]
            : [
                { id: "refund_amount", phrases: ["$32.49", "refund of $32.49"] },
                { id: "refund_destination", phrases: ["original payment card", "original card"] },
                { id: "refund_timeline", phrases: ["3-5 business days", "3 to 5 business days"] },
              ],
        }],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.equal(
    payload.draft.customer.openingLine,
    "Hi, I just got my 40-pound bag of dry dog food and the bag is torn. The food spilled everywhere and it's unusable.",
  );
  assert.deepEqual(payload.draft.customer.conditionalFollowUps, []);
  assert.equal(payload.draft.compatibilityFacts.conditionalFollowUp, "");
  assert.deepEqual(payload.draft.phases[0].chatAdvanceRequirements, [
    { id: "refund_amount", phrases: ["$32.49", "refund of $32.49"] },
    { id: "refund_destination", phrases: ["original payment card", "original card"] },
    { id: "refund_timeline", phrases: ["3-5 business days", "3 to 5 business days"] },
  ]);
});

test("retries one hosted draft with every repairable ordering, gate-concept, and prohibition conflict", async () => {
  let providerCalls = 0;
  const developerInstructions: string[] = [];
  const invalidPhase = {
    ...generated.phases[0],
    id: "confirm_refund_preference",
    title: "Confirm preference and refund",
    learnerActions: [
      "Acknowledge the torn bag and confirm a full refund of $32.49 to the original payment card.",
    ],
    chatAdvanceRequirements: [
      {
        id: "confirm_preference",
        phrases: ["confirm full refund", "refund amount $32.49", "original payment card"],
      },
      {
        id: "recap_refund",
        phrases: ["refund $32.49 confirmed", "thank customer"],
      },
      {
        id: "customer_closing",
        phrases: ["thank", "thank"],
      },
    ],
    partnerResponse: "I just want a full refund.",
  };
  const repairedPhases = [
    {
      ...invalidPhase,
      id: "confirm_refund_preference",
      title: "Confirm refund preference",
      learnerActions: ["Acknowledge the torn bag and ask whether Taylor wants a full refund."],
      chatAdvanceRequirements: [{
        id: "confirm_preference",
        phrases: ["confirm full refund", "ask about refund preference"],
      }],
    },
    {
      ...generated.phases[0],
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: ["Issue and confirm a $32.49 refund to the original payment card."],
      chatAdvanceRequirements: [
        { id: "refund_amount", phrases: ["$32.49", "refund amount $32.49"] },
        { id: "refund_destination", phrases: ["original payment card", "original card"] },
      ],
      partnerResponse: "Thank you for confirming the refund.",
    },
  ];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      providerCalls += 1;
      const providerRequest = JSON.parse(String(init?.body)) as {
        input: Array<{ role: string; content: Array<{ text: string }> }>;
      };
      developerInstructions.push(providerRequest.input[0].content[0].text);
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          openingLine: "The 40-pound dog food bag arrived torn and unusable.",
        },
        phases: providerCalls === 1 ? [invalidPhase] : repairedPhases,
        objectives: [{
          ...generated.objectives[0],
          id: "refund_resolution",
          label: "Complete the approved refund",
          criteria: [
            "Issue a full refund of $32.49 to the original payment card.",
            "Avoid offering store credit, a replacement, or an exchange.",
          ],
        }],
        prohibitedActions: providerCalls === 1
          ? [
              "Do not mention store credit.",
              "Do not mention replacement or exchange.",
            ]
          : ["Do not offer store credit, a replacement, or an exchange."],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.equal(payload.draft.phases.length, 2);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit, a replacement, or an exchange.",
  ]);
  assert.match(developerInstructions[1], /separate question phase/i);
  assert.match(developerInstructions[1], /earned Conversation Partner answer/i);
  assert.match(developerInstructions[1], /requirement ID/i);
  assert.match(developerInstructions[1], /one composite/i);
});

test("logs only safe guard codes when the corrective draft is still rejected", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const invalidPhase = {
    ...generated.phases[0],
    learnerActions: [
      "Ask whether Jordan wants a full refund, then issue it to the original payment card.",
    ],
    chatAdvanceRequirements: [{
      id: "confirm_preference",
      phrases: ["refund amount $32.49", "original payment card"],
    }],
    partnerResponse: "I want a full refund.",
  };
  const invalidOutput = {
    ...generated,
    customer: {
      ...generated.customer,
      openingLine: "The dog food bag arrived torn and unusable.",
    },
    phases: [invalidPhase],
    objectives: [{
      ...generated.objectives[0],
      id: "refund_resolution",
      criteria: ["Issue a full refund of $32.49 to the original payment card."],
    }],
    prohibitedActions: [
      "Do not offer store credit or a replacement.",
      "Do not offer a replacement or exchange.",
    ],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(invalidOutput),
    logError: (diagnostic) => diagnostics.push(diagnostic as unknown as Record<string, unknown>),
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 502);
  assert.deepEqual(diagnostics.at(-1)?.repairCodes, [
    "preference_response_order",
    "operational_criterion_coverage",
    "chat_advance_requirements",
    "overlapping_resolution_prohibitions",
  ]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /Jordan|32\.49|original payment card/);
});

test("logs only structural compiler diagnostics for an unrepairable Chat phase", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge Jordan's concern and document the delayed order."],
        chatAdvanceRequirements: [{
          id: "acknowledgement",
          phrases: ["thank", "help"],
        }],
      }],
    }),
    logError: (diagnostic) => diagnostics.push(diagnostic as unknown as Record<string, unknown>),
  });

  const response = await handler(request({
    ...validBody,
    correctProcess: "Transfer the conversation to the approved pharmacy support queue and confirm the transfer is complete.",
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(diagnostics.at(-1)?.repairDetails, {
    chatPhases: [{
      phaseIndex: 0,
      findingCodes: ["generic_chat_advance_phrase", "chat_advance_phrase_concept_mismatch"],
      compilerFailureCode: "unsupported_action_clause",
    }],
    operationalCriteria: [],
    resolutionBlueprintFailureCode: "approved_process_unsupported",
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /Jordan|delayed order/);
});

test("deterministically repairs the final corrective draft's Chat gates and split resolution boundaries", async () => {
  let providerCalls = 0;
  const phases = [
    {
      ...generated.phases[0],
      id: "confirm_refund_preference",
      title: "Confirm refund preference",
      learnerActions: ["Acknowledge the torn bag and ask whether Jamie wants a full refund."],
      chatAdvanceRequirements: [{
        id: "confirm_preference",
        phrases: ["refund amount $32.49", "original payment card"],
      }],
      partnerResponse: "I want a full refund.",
    },
    {
      ...generated.phases[0],
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: [
        "Issue the $32.49 refund to the original payment card and explain it will post within 3–5 business days.",
      ],
      chatAdvanceRequirements: [{
        id: "recap_refund",
        phrases: ["refund $32.49 confirmed", "thank customer"],
      }],
      partnerResponse: "Thank you for resolving this.",
    },
    {
      ...generated.phases[0],
      id: "preserve_valid_reference_gate",
      title: "Preserve a valid gate",
      learnerActions: ["Confirm the case reference."],
      chatAdvanceRequirements: [{
        id: "case_reference",
        phrases: ["case reference", "reference number"],
      }],
      partnerResponse: "That is the correct case.",
    },
  ];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          openingLine: "The dog food bag arrived torn and unusable.",
        },
        phases: phases.map((phase) => ({
          ...phase,
          coachGuidance: [
            ...phase.coachGuidance,
            ...(phase.id === "confirm_refund_preference"
              ? ["Use empathy when discussing store credit."]
              : []),
            "Avoid mentioning store credit.",
            "Never offer a replacement or exchange.",
          ],
        })),
        objectives: [{
          ...generated.objectives[0],
          id: "refund_resolution",
          criteria: [
            "Issue a full refund of $32.49 to the original payment card.",
            "Do not offer store credit.",
            "Avoid proposing a replacement or exchange.",
          ],
        }],
        prohibitedActions: [
          "Do not mention store credit.",
          "Do not mention replacement or exchange.",
          "Do not issue a refund for an amount other than $32.49.",
          "Do not state a timeline other than 3-5 business days.",
        ],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not mention store credit, a replacement, or an exchange.",
    "Do not issue a refund for an amount other than $32.49.",
    "Do not state a timeline other than 3-5 business days.",
  ]);
  assert.deepEqual(
    payload.draft.objectives[0].criteria.filter((criterion: string) => /^Do not/iu.test(criterion)),
    ["Do not mention store credit, a replacement, or an exchange."],
  );
  payload.draft.phases.forEach((phase: { coachGuidance: string[] }) => {
    assert.deepEqual(
      phase.coachGuidance.filter((guidance) => /^Do not mention/iu.test(guidance)),
      ["Do not mention store credit, a replacement, or an exchange."],
    );
  });
  assert.equal(
    payload.draft.phases[0].coachGuidance.includes("Use empathy when discussing store credit."),
    true,
  );
  assert.deepEqual(payload.draft.phases.map((phase: { chatAdvanceRequirements: unknown }) => phase.chatAdvanceRequirements), [
    [
      { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
      { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
      { id: "refund", phrases: ["refund"] },
    ],
    [
      { id: "refund_amount", phrases: expectedRefundAmountPhrases },
      { id: "refund_destination", phrases: ["original card", "original payment card"] },
      { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
      { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
    ],
    [
      { id: "case_reference", phrases: ["case reference", "reference number"] },
    ],
  ]);
});

test("rebuilds unrepairable model phases from the approved refund process", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          name: "Jamie",
          openingLine: "The dog food bag arrived torn and unusable.",
        },
        phases: [
          {
            ...generated.phases[0],
            id: "document_issue",
            learnerActions: ["Acknowledge the torn bag and document what happened."],
            chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
          },
          {
            ...generated.phases[0],
            id: "ask_preference",
            learnerActions: ["Ask whether Jamie wants a full refund."],
            chatAdvanceRequirements: [{ id: "refund_preference", phrases: ["like a refund", "want a refund"] }],
            partnerResponse: "Yes, I want a full refund.",
          },
          {
            ...generated.phases[0],
            id: "recap_refund",
            learnerActions: ["Explain the refund timeline and recap the resolution."],
            chatAdvanceRequirements: [{ id: "refund_timeline", phrases: ["recap refund", "review outcome"] }],
          },
          {
            ...generated.phases[0],
            id: "complete_and_close",
            learnerActions: ["Issue the $32.49 refund to the original payment card and close the conversation."],
            chatAdvanceRequirements: [{ id: "refund_completion", phrases: ["offer replacement", "issue store credit"] }],
          },
        ],
        objectives: [{
          ...generated.objectives[0],
          id: "refund_resolution",
          criteria: ["Issue a full refund of $32.49 to the original payment card."],
        }],
        prohibitedActions: [
          "Do not offer store credit, a replacement, or an exchange.",
          "Do not issue a refund for an amount other than $32.49.",
          "Do not state a timeline other than 3-5 business days.",
        ],
      });
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dog food.",
    correctProcess: "Issue a full refund of exactly $32.49 to the original payment card. Explain that the refund will post within 3–5 business days. Acknowledge the torn bag and inconvenience, then ask Jamie whether a full refund is preferred. Do not mention store credit, replacement, or exchange. Jamie rejects store credit and replacement. The Conversation Partner may describe the problem, answer questions, and react, but must never perform Chewy-agent actions or explain Chewy policy.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.equal(payload.draft.phases.length, 2);
  assert.deepEqual(payload.draft.phases[0].learnerActions, [
    "Acknowledge the Conversation Partner's concern.",
    "Ask whether Jamie wants a full refund.",
  ]);
  assert.deepEqual(payload.draft.phases[0].chatAdvanceRequirements, [
    { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
    { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "refund", phrases: ["refund"] },
  ]);
  assert.deepEqual(payload.draft.phases[1].learnerActions, [
    "Issue a full refund of $32.49 to the original payment card.",
    "Explain that the refund will post within 3–5 business days.",
  ]);
  assert.deepEqual(payload.draft.phases[1].chatAdvanceRequirements, [
    { id: "refund_amount", phrases: expectedRefundAmountPhrases },
    { id: "refund_destination", phrases: ["original card", "original payment card"] },
    { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
    { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
  ]);
});

test("rebuilds the torn-dog-food draft when the approved destination is written as an exception", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          name: "Jamie",
          openingLine: "The dog food bag arrived torn and unusable.",
        },
        phases: [
          {
            ...generated.phases[0],
            id: "confirm_refund_preference",
            learnerActions: ["Acknowledge the concern and ask whether Jamie wants a full refund."],
            chatAdvanceRequirements: [{ id: "refund_preference", phrases: ["refund the order", "issue refund"] }],
            partnerResponse: "Yes, I want a full refund.",
          },
          {
            ...generated.phases[0],
            id: "complete_refund",
            learnerActions: [
              "Issue the $32.49 refund to the original payment card.",
              "Explain that the refund will post within 3-5 business days.",
            ],
            chatAdvanceRequirements: [{ id: "refund_completion", phrases: ["offer replacement", "issue store credit"] }],
            partnerResponse: "Thank you for resolving this.",
          },
        ],
        objectives: [{
          ...generated.objectives[0],
          id: "refund_resolution",
          criteria: ["Issue a full refund of $32.49 to the original payment card."],
        }],
        prohibitedActions: [
          "Do not mention store credit, a replacement, or an exchange.",
          "Do not issue any amount other than exactly $32.49.",
          "Do not refund to any destination other than the original payment card.",
          "Do not give any timeline other than 3-5 business days.",
        ],
      });
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "Practice acknowledging a damaged dry dog food complaint, confirming the customer’s refund preference, and issuing an exact refund to the original payment card.",
    learnerGoal: "Acknowledge the Conversation Partner's concern. Ask whether Jamie wants a full refund. Issue a full refund of $32.49 to the original payment card. Explain that the refund will post within 3-5 business days. Avoid: Do not mention store credit, a replacement, or an exchange. Avoid: Do not issue any amount other than exactly $32.49. Avoid: Do not refund to any destination other than the original payment card. Avoid: Do not give any timeline other than 3-5 business days.",
    correctProcess: "Acknowledge the Conversation Partner's concern. Ask whether Jamie wants a full refund. Issue a full refund of $32.49 to the original payment card. Explain that the refund will post within 3-5 business days. Avoid: Do not mention store credit, a replacement, or an exchange. Avoid: Do not issue any amount other than exactly $32.49. Avoid: Do not refund to any destination other than the original payment card. Avoid: Do not give any timeline other than 3-5 business days.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.equal(
    payload.draft.phases.some((phase: { chatAdvanceRequirements: Array<{ id: string; phrases: string[] }> }) =>
      findChatAdvanceRequirementQualityFindings(
        phase.chatAdvanceRequirements,
        payload.draft.prohibitedActions,
        payload.draft.customer.name,
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase")
    ),
    false,
  );
  assert.match(JSON.stringify(payload.draft.phases), /\$32\.49/u);
  assert.match(JSON.stringify(payload.draft.phases), /original payment card/u);
  assert.match(JSON.stringify(payload.draft.phases), /3-5 business days/u);
});

test("rebuilds approved refund phases when a sequencing guardrail names the refund", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        id: "document_issue",
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
      prohibitedActions: [
        "Do not refund Jamie before they confirm they want it.",
        "Do not authorize the refund before obtaining Jamie's confirmation.",
        "Do not offer store credit, a replacement, or an exchange.",
      ],
    }),
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: "Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. Do not offer store credit, a replacement, or an exchange.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.phases[0].chatAdvanceRequirements, [
    { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
    { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "refund", phrases: ["refund"] },
  ]);
  assert.deepEqual(payload.draft.phases[1].chatAdvanceRequirements, [
    { id: "refund_amount", phrases: expectedRefundAmountPhrases },
    { id: "refund_destination", phrases: ["original card", "original payment card"] },
    { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
    { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
  ]);
});

test("uses creator-approved prohibitions when AI sequencing wording cannot compile", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        id: "document_issue",
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
      prohibitedActions: [
        "Do not issue the refund until Jamie explicitly states a preference for a refund.",
        "Do not offer store credit, a replacement, or an exchange.",
      ],
    }),
  });
  const creatorBoundary = "Do not offer store credit, a replacement, or an exchange.";
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: `Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. ${creatorBoundary}`,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.prohibitedActions, [creatorBoundary]);
  assert.deepEqual(payload.draft.phases[0].chatAdvanceRequirements, [
    { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
    { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "refund", phrases: ["refund"] },
  ]);
});

test("keeps creator prohibitions with curly, modal, and subject-led negative wording during fallback", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
      prohibitedActions: [
        "Do not issue the refund until Jamie explicitly states a preference for a refund.",
      ],
    }),
  });
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: "Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. Don’t offer store credit. The learner must not offer a replacement. The representative should not offer an exchange.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit, a replacement, or an exchange.",
  ]);
});

test("consolidates separate creator resolution prohibitions during fallback", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
      prohibitedActions: [
        "Do not issue the refund until Jamie explicitly states a preference for a refund.",
      ],
    }),
  });
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: "Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. Do not offer store credit. Do not offer a replacement. Do not offer an exchange.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.prohibitedActions, [
    "Do not offer store credit, a replacement, or an exchange.",
  ]);
});

test("does not turn a creator's No-policy fact into a prohibited action during fallback", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
      prohibitedActions: [
        "Do not issue the refund until Jamie explicitly states a preference for a refund.",
      ],
    }),
  });
  const creatorBoundary = "Do not offer store credit, a replacement, or an exchange.";
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: `Acknowledge the damaged delivery, ask whether Jamie wants a full refund, then issue a $32.49 refund to the original payment card and explain it will post in 3–5 business days. No manager approval is required. ${creatorBoundary}`,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.prohibitedActions, [creatorBoundary]);
});

test("keeps an earned replacement sequence separate from absolute alternative prohibitions", async () => {
  const diagnostics: unknown[] = [];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    logError: (diagnostic) => diagnostics.push(diagnostic),
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        name: "Jamie",
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the torn bag and document what happened."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["document issue", "take notes"] }],
      }],
      objectives: [{
        ...generated.objectives[0],
        id: "replacement_resolution",
        criteria: ["Place a no-cost replacement order."],
      }],
      prohibitedActions: [
        "Do not place the replacement until Jamie explicitly states a preference for a replacement.",
      ],
    }),
  });
  const sequenceBoundary = "Do not issue the replacement before the customer confirms they want it.";
  const absoluteBoundary = "Do not offer store credit.";
  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer named Jamie received a torn bag of dry dog food.",
    correctProcess: `Acknowledge the damaged delivery, ask whether Jamie wants a replacement, then place a no-cost replacement and explain it will arrive in 3–5 business days. ${sequenceBoundary} ${absoluteBoundary}`,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify({ error: payload.error, diagnostics }));
  assert.deepEqual(payload.draft.prohibitedActions, [sequenceBoundary, absoluteBoundary]);
});

test("does not copy prohibited-alternative facts into a rebuilt approved outcome", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the concern and document the delayed order."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["thank", "help"] }],
      }],
    }),
  });

  const response = await handler(request({
    ...validBody,
    correctProcess: "Issue the approved refund. Do not offer $10.00 store credit or a replacement arriving tomorrow.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.phases[0].learnerActions, ["Issue the refund."]);
  assert.equal(payload.draft.objectives[0].description, "Apply the approved refund process accurately.");
  assert.doesNotMatch(JSON.stringify(payload.draft.phases), /10\.00|tomorrow|store credit|replacement/i);
});

test("rebuilds an after-confirmation replacement with no-return guidance when corrective output remains invalid", async () => {
  const diagnostics: Array<Record<string, unknown>> = [];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    logError: (diagnostic) => diagnostics.push(diagnostic as unknown as Record<string, unknown>),
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        openingLine: "The dog food bag arrived torn and unusable.",
      },
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge the concern and document the delayed order."],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["thank", "help"] }],
      }],
    }),
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received a torn dog food bag and needs a usable replacement.",
    correctProcess: "Acknowledge the frustration and apologize. Offer a no-cost replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement and explain that it should arrive within 2-3 business days. Tell the customer they do not need to return the damaged bag. Do not offer a refund or store credit.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify({ error: payload.error, diagnostics }));
  assert.deepEqual(payload.draft.phases.map((phase: { learnerActions: string[] }) => phase.learnerActions), [
    [
      "Acknowledge the Conversation Partner's concern.",
      "Offer a no-cost replacement.",
      "Ask whether Jordan wants a replacement.",
    ],
    [
      "Place a no-cost replacement order.",
      "Explain that the replacement will arrive within 2-3 business days.",
      "Tell the Conversation Partner they do not need to return the item.",
    ],
  ]);
  assert.deepEqual(
    payload.draft.phases[0].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    [
      "acknowledge_empathy",
      "replacement_question_intent",
      "replacement_resolution",
      "replacement_no_cost",
    ],
  );
  assert.deepEqual(
    payload.draft.phases[1].chatAdvanceRequirements.map((requirement: { id: string }) => requirement.id),
    ["replacement_no_cost", "replacement_timeline", "replacement_completion", "no_return"],
  );
  assert.deepEqual(payload.draft.prohibitedActions, ["Do not offer a refund or store credit."]);
});

test("rebuilds newline-delimited free replacement steps without inventing damage", async () => {
  for (const noCostPhrase of ["at no charge", "free of charge"]) {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...generated,
        phases: [{
          ...generated.phases[0],
          learnerActions: ["Acknowledge the concern and document the delayed order."],
          chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["thank", "help"] }],
        }],
      }),
    });

    const response = await handler(request({
      ...validBody,
      situation: "A fictional customer received the wrong dog food and needs the correct item.",
      correctProcess: [
        "Acknowledge the concern",
        `Offer a replacement ${noCostPhrase}`,
        "Confirm the customer wants the replacement before placing it",
        "After confirmation, place the replacement and explain it should arrive within 2-3 business days",
        "Tell the customer they do not need to return the wrong item",
        "Do not offer a refund or store credit",
      ].join("\n"),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload.error));
    assert.deepEqual(payload.draft.phases.map((phase: { learnerActions: string[] }) => phase.learnerActions), [
      [
        "Acknowledge the Conversation Partner's concern.",
        "Offer a no-cost replacement.",
        "Ask whether Jordan wants a replacement.",
      ],
      [
        "Place a no-cost replacement order.",
        "Explain that the replacement will arrive within 2-3 business days.",
        "Tell the Conversation Partner they do not need to return the item.",
      ],
    ]);
    assert.doesNotMatch(JSON.stringify(payload.draft.phases), /damaged item/i);
  }
});

test("fails closed when a phase blueprint would drop prerequisites or choose conflicting facts", async () => {
  for (const correctProcess of [
    "Verify that the torn bag is eligible for a refund. Issue a full refund of $32.49 to the original payment card.",
    "Issue a full refund of $10.00 to the original payment card and process a full refund of $20.00 to the original payment card.",
  ]) {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...generated,
        phases: [{
          ...generated.phases[0],
          learnerActions: ["Acknowledge the concern and document the delayed order."],
          chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["thank", "help"] }],
        }],
      }),
    });

    const response = await handler(request({ ...validBody, correctProcess }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "generation_unavailable");
  }
});

test("adds a missing approved operational criterion to the final phase before compiling gates", async () => {
  let providerCalls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      providerCalls += 1;
      return providerResponse({
        ...generated,
        customer: {
          ...generated.customer,
          openingLine: "The dog food bag arrived torn and unusable.",
        },
        phases: [
          {
            ...generated.phases[0],
            id: "confirm_refund_preference",
            learnerActions: ["Acknowledge the torn bag and ask whether Jamie wants a full refund."],
            chatAdvanceRequirements: [{
              id: "refund_preference",
              phrases: ["like a refund", "want a refund"],
            }],
            partnerResponse: "I want a full refund.",
          },
          {
            ...generated.phases[0],
            id: "explain_refund_timeline",
            learnerActions: ["Explain that the refund will post within 3-5 business days."],
            chatAdvanceRequirements: [{
              id: "refund_timeline",
              phrases: ["3-5 business days", "3–5 business days"],
            }],
            partnerResponse: "Thank you for resolving this.",
          },
        ],
        objectives: [{
          ...generated.objectives[0],
          id: "refund_resolution",
          criteria: ["Issue a full refund of $32.49 to the original payment card."],
        }],
        prohibitedActions: ["Do not offer store credit, a replacement, or an exchange."],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(providerCalls, 2);
  assert.deepEqual(payload.draft.phases[1].learnerActions, [
    "Explain that the refund will post within 3-5 business days.",
    "Issue a full refund of $32.49 to the original payment card.",
  ]);
  assert.deepEqual(payload.draft.phases[1].chatAdvanceRequirements, [
    { id: "refund_amount", phrases: expectedRefundAmountPhrases },
    { id: "refund_destination", phrases: ["original card", "original payment card"] },
    { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
    { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
  ]);
});

test("does not auto-repair an operational criterion performed in multiple phases", async () => {
  const operationalPhases = [
    {
      ...generated.phases[0],
      id: "issue_refund",
      learnerActions: ["Issue the $32.49 refund to the original payment card."],
      chatAdvanceRequirements: [{ id: "refund_completion", phrases: ["issued the", "processed the"] }],
    },
    {
      ...generated.phases[0],
      id: "process_refund_again",
      learnerActions: ["Process the $32.49 refund to the original payment card."],
      chatAdvanceRequirements: [{ id: "refund_completion", phrases: ["issued the", "processed the"] }],
    },
  ];
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: operationalPhases,
      objectives: [{
        ...generated.objectives[0],
        id: "refund_resolution",
        criteria: ["Issue a full refund of $32.49 to the original payment card."],
      }],
    }),
  });

  const response = await handler(request(validBody));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "generation_unavailable");
});

test("compiles an exact non-range timeline instead of a generic deadline", () => {
  const requirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: ["Explain that the refund will post within 24 hours."],
    chatAdvanceRequirements: [{
      id: "refund_timeline",
      phrases: ["soon", "expected timeframe"],
    }],
  }, [], "Jamie");

  assert.deepEqual(requirements, [{
    id: "refund_timeline",
    phrases: ["24 hours", "24-hour"],
  }]);
});

test("compiles adjudicated natural refund anchors", () => {
  const requirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: [
      "Acknowledge the torn bag with empathy.",
      "Confirm that Jamie prefers a full refund.",
      "Issue the $32.49 refund and explain it will post within 3-5 business days.",
    ],
    chatAdvanceRequirements: [{
      id: "refund_completion",
      phrases: ["issued the $32.49 refund", "processed the $32.49 refund"],
    }],
  }, [], "Jamie");

  assert.deepEqual(requirements, [
    { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
    { id: "refund_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "refund_amount", phrases: expectedRefundAmountPhrases },
    { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
    { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
  ]);
});

test("compiles refund gates into separately required natural-language concepts", () => {
  const preferenceRequirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: [
      "Acknowledge the damaged bag and ask whether Jamie wants a full refund.",
    ],
    chatAdvanceRequirements: [
      { id: "acknowledge_empathy", phrases: ["sorry the", "sorry about", "understand the"] },
      { id: "refund_preference", phrases: ["like a refund", "want a refund", "prefer a full refund"] },
    ],
  }, [], "Jamie");
  const completionRequirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: [
      "Complete the $32.49 refund to the original payment card and explain the 3-5 business-day timeline.",
    ],
    chatAdvanceRequirements: [
      { id: "refund_destination", phrases: ["original card", "original payment card"] },
      { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days"] },
      { id: "refund_completion", phrases: ["issued the $32.49 refund", "processed the $32.49 refund"] },
    ],
  }, [], "Jamie");

  assert.deepEqual(preferenceRequirements, [
    {
      id: "acknowledge_empathy",
      phrases: expectedEmpathyPhrases,
    },
    {
      id: "refund_question_intent",
      phrases: expectedQuestionIntentPhrases,
    },
    { id: "refund", phrases: ["refund"] },
  ]);
  assert.deepEqual(completionRequirements, [
    { id: "refund_amount", phrases: expectedRefundAmountPhrases },
    { id: "refund_destination", phrases: ["original card", "original payment card"] },
    {
      id: "refund_timeline",
      phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"],
    },
    { id: "refund_completion", phrases: expectedRefundCompletionPhrases },
  ]);
});

test("does not reinterpret an unknown intent requirement as question intent", () => {
  const requirement = {
    id: "refund_intent",
    phrases: ["full refund intent", "refund selection"],
  };

  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([requirement]), [requirement]);
});

test("preserves specific return and replacement tracking gates while enriching true no-return guidance", () => {
  const returnGuidance = { id: "return_guidance", phrases: ["return the item", "send it back"] };
  const replacementTracking = { id: "replacement_tracking", phrases: ["replacement tracking", "replacement status"] };
  const replacementDelivery = { id: "replacement_delivery", phrases: ["replacement delivery date", "replacement arrival window"] };
  const replacementOrderNumber = { id: "replacement_order_number", phrases: ["replacement order number", "replacement confirmation number"] };
  const replacementConfirmationNumber = { id: "replacement_confirmation", phrases: ["replacement confirmation number"] };
  const replacementOutcomeConfirmation = { id: "replacement_confirmation", phrases: ["your replacement is confirmed"] };
  const replacementOrderConfirmation = { id: "replacement_order_confirmation", phrases: ["replacement order confirmed", "replacement order confirmation"] };
  const replacementShippingConfirmation = { id: "replacement_shipping_confirmation", phrases: ["replacement shipping confirmation", "replacement shipped"] };
  const replacementEmailConfirmation = { id: "replacement_email_confirmation", phrases: ["replacement confirmation email", "confirmation email sent"] };
  const replacementTrackingConfirmation = { id: "replacement_tracking_confirmation", phrases: ["replacement tracking confirmation"] };
  const noCostReplacementTracking = { id: "no_cost_replacement_tracking", phrases: ["no-cost replacement tracking", "replacement tracking at no charge"] };
  const noCostReplacementCompletion = { id: "no_cost_replacement_completion", phrases: ["completed the no-cost replacement", "placed the replacement at no charge"] };
  const noReturnGuidance = { id: "return_guidance", phrases: ["no return needed", "keep the damaged bag"] };
  const replacementConfirmation = { id: "replacement_confirmation", phrases: ["want the replacement", "okay to send"] };
  const replacementOrderPreference = { id: "replacement_order_preference", phrases: ["want the replacement", "okay to send"] };
  const replacementResolution = { id: "replacement_resolution", phrases: ["replacement", "replacement order"] };
  const noCostReplacement = { id: "no_cost_replacement", phrases: ["no-cost replacement", "replacement at no charge"] };

  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([
    returnGuidance,
    replacementTracking,
    replacementDelivery,
    replacementOrderNumber,
    replacementConfirmationNumber,
    replacementOrderConfirmation,
    replacementShippingConfirmation,
    replacementEmailConfirmation,
    replacementTrackingConfirmation,
    noCostReplacementTracking,
    noCostReplacementCompletion,
  ]), [
    returnGuidance,
    replacementTracking,
    replacementDelivery,
    replacementOrderNumber,
    replacementConfirmationNumber,
    replacementOrderConfirmation,
    replacementShippingConfirmation,
    replacementEmailConfirmation,
    replacementTrackingConfirmation,
    noCostReplacementTracking,
    noCostReplacementCompletion,
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([replacementOutcomeConfirmation]), [
    replacementOutcomeConfirmation,
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([noReturnGuidance]), [{
    id: "return_guidance",
    phrases: [
      "no return needed",
      "keep the damaged bag",
      "not need to return",
      "don't need to return",
      "don’t need to return",
      "no need to return",
      "don't send it back",
      "don’t send it back",
      "dispose of the damaged bag",
    ],
  }]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([replacementConfirmation]), [
    { id: "replacement_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "replacement_resolution", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([replacementOrderPreference]), [
    { id: "replacement_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "replacement_resolution", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([noCostReplacement]), [
    { id: "replacement_offer", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([replacementResolution, noCostReplacement]), [
    { id: "replacement_resolution", phrases: ["replacement", "replacement order", "new bag", "replace it"] },
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([noCostReplacement, replacementResolution]), [
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
    { id: "replacement_resolution", phrases: ["replacement", "replacement order", "new bag", "replace it"] },
  ]);
  assert.deepEqual(mergeSafeChatAdvanceRequirementAliases([replacementShippingConfirmation, noCostReplacement]), [
    replacementShippingConfirmation,
    { id: "replacement_offer", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
  ]);
});

test("compiles a replacement completion gate without weakening the outcome", () => {
  const requirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: [
      "Place a no-cost replacement order and explain that it will arrive in 3-5 business days.",
    ],
    chatAdvanceRequirements: [{
      id: "replacement_completion",
      phrases: ["process", "help"],
    }],
  }, [], "Jamie");

  assert.deepEqual(requirements, [
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
    { id: "replacement_timeline", phrases: ["3-5 business days", "3–5 business days", "3 to 5 business days", "three to five business days"] },
    {
      id: "replacement_completion",
      phrases: [
        "placed the replacement order",
        "placed a replacement order",
        "placed your replacement order",
        "submitted the replacement order",
        "submitted a replacement order",
        "submitted your replacement order",
        "replacement order has been placed",
        "replacement order was placed",
        "replacement order has been submitted",
        "replacement order was submitted",
      ],
    },
  ]);
});

test("keeps a prohibited replacement out of positive refund gates and in final scoring", () => {
  const prohibitedAction = "Do not offer a replacement.";
  const requirements = compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions: [
      "Issue the $32.49 refund to the original payment card and explain it will post within 3-5 business days.",
    ],
    chatAdvanceRequirements: [{
      id: "refund_completion",
      phrases: ["issued the", "processed the"],
    }],
  }, [prohibitedAction], "Jamie");
  assert.ok(requirements);

  const matchesCurrentRisePositiveGate = (message: string) => {
    const normalized = message.toLowerCase();
    return requirements!.every((requirement) =>
      requirement.phrases.some((phrase) => normalized.includes(phrase))
    );
  };
  assert.equal(matchesCurrentRisePositiveGate(
    "I've issued the refund. The refund amount is $32.49, returning to your original card in 3-5 business days.",
  ), true);
  assert.equal(matchesCurrentRisePositiveGate(
    "I've issued the refund and offered a replacement. The refund amount is $32.49, returning to your original card in 3-5 business days.",
  ), true);

  const authoring = standaloneToAuthoringDraft({
    baseId: "refund_with_prohibited_replacement",
    prohibitedActions: [prohibitedAction],
    phases: [{
      id: "complete_refund",
      learnerActions: ["Issue the $32.49 refund to the original payment card."],
      partnerResponse: "Thank you.",
      coachGuidance: [prohibitedAction],
    }],
    objectives: [{
      id: "complete_refund",
      label: "Complete the refund",
      description: "Complete only the approved refund.",
      criteria: ["Issue the $32.49 refund to the original payment card.", prohibitedAction],
    }],
  });
  assert.equal(
    authoring.evaluation.objectives[0].criteria.some((criterion: { text: string }) => criterion.text === prohibitedAction),
    true,
  );
});

test("allows an approved amount and timeline named as exceptions to a prohibition", () => {
  const requirements = [
    { id: "refund_timeline", phrases: ["3-5 business days", "3–5 business days"] },
    { id: "refund_completion", phrases: ["issued the $32.49 refund", "processed the $32.49 refund"] },
  ];
  const findings = findChatAdvanceRequirementQualityFindings(requirements, [
    "Do not issue a refund for an amount other than $32.49.",
    "Do not state a timeline other than 3-5 business days.",
  ], "Jamie");
  assert.equal(findings.some((finding) => finding.code === "prohibited_chat_advance_phrase"), false);

  const explicitlyProhibited = findChatAdvanceRequirementQualityFindings(requirements, [
    "Do not state 3-5 business days.",
  ], "Jamie");
  assert.equal(explicitlyProhibited.some((finding) => finding.code === "prohibited_chat_advance_phrase"), true);
});

test("allows earned-preference sequencing without weakening unrelated prerequisites", () => {
  const requirements = [{ id: "refund", phrases: ["refund"] }];
  const sequenceFindings = (
    candidateRequirements: Array<{ id: string; phrases: string[] }>,
    prohibitedActions: string[],
  ) => findChatAdvanceRequirementQualityFindings(
    candidateRequirements,
    prohibitedActions,
    "Jamie",
  );
  for (const preferenceOrdering of [
    "Do not issue the refund before the customer confirms they want it.",
    "Do not refund Jamie before they confirm they want it.",
    "Do not authorize the refund before the customer confirms they want it.",
    "Do not complete the refund before obtaining Jamie's confirmation.",
    "Do not execute the refund before the customer confirms they want it.",
    "Do not release the refund until the customer selects it.",
    "Do not move forward with the refund without customer confirmation.",
    "Do not give the refund before the customer confirms they want it.",
    "Do not process Jamie's refund until they confirm it.",
    "Do not apply the refund until the customer authorizes it.",
    "Do not proceed with the refund until the customer approves it.",
    "Do not issue the refund prior to receiving confirmation from Jamie.",
    "Do not issue the refund until the customer says yes.",
    "Do not issue the refund without the customer's approval.",
    "Do not issue the refund without Jamie's approval.",
    "Do not refund Jamie in full before they confirm they want it.",
    "Do not refund the Conversation Partner before they confirm they want it.",
    "Do not issue the refund until explicit customer confirmation.",
    "Do not issue the refund before obtaining explicit confirmation from Jamie.",
    "Do not issue the refund without clear customer consent.",
    "Do not issue the refund before the customer gives permission.",
    "Do not issue the refund before Jamie gives the go-ahead.",
    "Do not issue the refund before Jamie gives explicit permission.",
    "Do not issue the refund until Jamie provides confirmation.",
    "Do not issue the refund until the customer confirms that they want it.",
    "Do not issue the refund until Jamie agrees to a refund.",
    "Do not issue the refund until the customer confirms their preference.",
    "Do not issue the refund until the customer gives their permission.",
    "Do not provide a refund to Jamie until they confirm they want it.",
    "Do not issue the refund until confirmation is received from Jamie.",
    "Do not issue the refund until confirmation has been received from Jamie.",
    "Do not refund Jamie before receiving his confirmation.",
    "Do not issue the refund before Jamie verbally confirms.",
    "Do not provide Jamie with a full refund before Jamie confirms.",
    "Do not issue the refund before the customer confirms and approves the refund.",
    "Do not issue the refund before Jamie confirms and authorizes the refund.",
    "Do not finalize the refund before the customer confirms they want it.",
    "Do not initiate the refund until the customer selects it.",
    "Do not issue the refund prior to confirming the customer's preference.",
    "Do not issue the refund until the customer selects it.",
    "Do not issue the refund unless Jamie confirms.",
    "Do not issue the refund without customer confirmation.",
  ]) {
    const findings = sequenceFindings(requirements, [preferenceOrdering]);
    assert.equal(
      findings.some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      false,
      preferenceOrdering,
    );
  }

  for (const prerequisite of [
    "Do not issue the refund before confirming manager approval.",
    "Do not guarantee a delivery date before confirming tracking.",
    "Do not refund Jamie before they confirm tracking.",
    "Do not refund Jamie before Jamie confirms a replacement.",
    "Do not finalize the refund until approval is received.",
    "Do not authorize the refund before obtaining Finance approval.",
    "Do not authorize the refund before obtaining Legal authorization.",
    "Do not authorize the refund before Director Smith approves it.",
    "Do not authorize the refund until Customer Care approves it.",
    "Do not authorize the refund before Operations confirms the case.",
    "Do not authorize the refund before the system selects it.",
    "Do not authorize the refund before the fraud team requests it.",
    "Do not issue a partial refund before the customer confirms they want a full refund.",
    "Do not refund more than $32.49 unless the customer requests it.",
    "Do not authorize the refund before Billing confirms the case.",
    "Do not authorize the refund before Triage selects it.",
    "Do not refund Shipping before the customer confirms they want it.",
    "Do not refund the manager before the customer confirms they want it.",
    "Do not refund an excess before the customer confirms they want it.",
    "Do not issue another refund before the customer confirms they want it.",
    "Do not issue a duplicate refund before the customer confirms they want it.",
    "Do not issue a cash refund before the customer confirms they want it.",
    "Do not issue a reduced refund before the customer confirms they want it.",
    "Do not issue a prorated refund before the customer confirms they want it.",
    "Do not place a paid replacement before the customer confirms they want it.",
    "Do not place an expedited replacement before the customer confirms they want it.",
    "Do not place another replacement before the customer confirms they want it.",
    "Do not place a replacement with a fee before the customer confirms they want it.",
    "Do not authorize the refund until Customer Support confirms it.",
    "Do not authorize the refund until Customer Service confirms it.",
    "Do not authorize the refund until Support confirms the customer choice.",
    "Do not authorize the refund until QA confirms the customer wants it.",
    "Do not mention the refund before the customer confirms they want it.",
    "Do not authorize the refund until customer fraud screening confirms it.",
    "Do not authorize the refund until the tool says they approve.",
    "Do not issue the refund until they approve it.",
    "Do not issue the refund until the customer confirms they do not want it.",
    "Do not issue the refund until the customer confirms they want a partial refund.",
    "Do not issue the refund until the customer requests a refund to a gift card.",
    "Do not issue the refund until the customer authorizes a refund over $32.49.",
    "Do not issue the refund until the customer confirms they won't want it.",
    "Do not issue the refund until the customer confirms they wouldn't want it.",
    "Do not issue the refund until the customer confirms they will not want it.",
    "Do not issue the refund until the customer confirms they cannot accept it.",
    "Do not issue the refund until the customer confirms they no longer want it.",
    "Do not issue the refund until the customer requests a cash refund.",
    "Do not issue the refund until the customer requests a duplicate refund.",
    "Do not issue the refund until the customer requests a reduced refund.",
    "Do not issue the refund until the customer requests a prorated refund.",
    "Do not place the replacement until the customer requests a paid replacement.",
    "Do not place the replacement until the customer requests an expedited replacement.",
    "Do not place the replacement until the customer requests a replacement with a fee.",
    "Do not issue the refund until the customer confirms they want help.",
    "Do not issue the refund until the customer confirms they want more information.",
    "Do not issue the refund until the customer confirms they want to wait.",
    "Do not issue the refund until the customer confirms they want nothing.",
    "Do not issue the refund until the customer confirms they want an apology.",
    "Do not issue the refund until the customer confirms they want dog food.",
    "Do not issue the refund before Jamie confirms and Sam approves it.",
  ]) {
    const phrase = prerequisite.includes("delivery date")
      ? "guarantee a delivery date"
      : prerequisite.includes("replacement")
        ? "replacement"
        : "refund";
    const findings = sequenceFindings(
      [{ id: "prerequisite", phrases: [phrase, `confirmed ${phrase}`] }],
      [prerequisite],
    );
    assert.equal(
      findings.some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      prerequisite,
    );
  }

  for (const absoluteProhibition of [
    "Do not issue a refund.",
    "Do not issue a partial refund.",
  ]) {
    const findings = sequenceFindings(requirements, [absoluteProhibition]);
    assert.equal(
      findings.some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      absoluteProhibition,
    );
  }

  const compound = "Do not offer store credit and do not issue the refund before the customer confirms they want it.";
  assert.equal(
    sequenceFindings(requirements, [compound])
      .some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    false,
  );
  assert.equal(
    sequenceFindings(
      [{ id: "alternative", phrases: ["store credit", "offered store credit"] }],
      [compound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  const reverseCompound = "Do not issue the refund before the customer confirms they want it and do not offer store credit.";
  assert.equal(
    sequenceFindings(requirements, [reverseCompound])
      .some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    false,
  );
  assert.equal(
    sequenceFindings(
      [{ id: "alternative", phrases: ["store credit", "offered store credit"] }],
      [reverseCompound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  const inheritedCompound = "Do not offer store credit or authorize the refund before the customer confirms they want it.";
  assert.equal(
    sequenceFindings(requirements, [inheritedCompound])
      .some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    false,
  );
  assert.equal(
    sequenceFindings(
      [{ id: "alternative", phrases: ["store credit", "offered store credit"] }],
      [inheritedCompound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  const butCompound = "Do not offer store credit, but authorize the refund before the customer confirms they want it.";
  assert.equal(
    sequenceFindings(requirements, [butCompound])
      .some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    false,
  );
  assert.equal(
    sequenceFindings(
      [{ id: "alternative", phrases: ["store credit", "offered store credit"] }],
      [butCompound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  const temporalAction = "Do not guarantee the refund before the customer confirms they want it.";
  assert.equal(
    sequenceFindings(
      [{ id: "refund_promise", phrases: ["guarantee the refund", "promise the refund"] }],
      [temporalAction],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );
  for (const [temporalRule, compactPhrases] of [
    ["Do not issue the refund before the customer confirms they want it.", ["issue refund", "process refund"]],
    ["Do not issue a full refund before the customer confirms they want it.", ["issue refund", "process refund"]],
    ["Do not guarantee the refund before the customer confirms they want it.", ["guarantee refund", "promise refund"]],
    ["Do not authorize the refund before the customer confirms they want it.", ["authorize refund", "approve refund"]],
    ["Do not authorize the full refund before the customer confirms they want it.", ["authorize refund", "approve refund"]],
    ["Do not place a no-cost replacement before the customer confirms they want it.", ["place replacement", "send replacement"]],
  ] as const) {
    assert.equal(
      sequenceFindings(
        [{ id: "refund_action", phrases: [...compactPhrases] }],
        [temporalRule],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      temporalRule,
    );
  }
  assert.equal(
    sequenceFindings(
      [{ id: "refund_completion", phrases: ["processed the refund", "issued the refund"] }],
      [temporalAction],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    false,
  );

  for (const [shortRule, completionPhrases] of [
    ["Do not refund until the customer confirms they want it.", ["issued the refund", "processed the refund"]],
    ["Do not replace until the customer confirms they want it.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not reship until the customer confirms they want it.", ["placed the reshipment order", "submitted the reshipment order"]],
  ] as const) {
    assert.equal(
      sequenceFindings(
        [{ id: "outcome_completion", phrases: [...completionPhrases] }],
        [shortRule],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      false,
      shortRule,
    );
  }

  const inheritedResolutionCompound = "Do not offer store credit and issue a replacement.";
  assert.equal(
    sequenceFindings(
      [{ id: "replacement_completion", phrases: ["placed the replacement order", "submitted the replacement order"] }],
      [inheritedResolutionCompound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  const offeredResolutionCompound = "Do not provide store credit and offer a replacement.";
  assert.equal(
    sequenceFindings(
      [{ id: "replacement_completion", phrases: ["placed the replacement order", "submitted the replacement order"] }],
      [offeredResolutionCompound],
    ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
    true,
  );

  for (const directResolutionCompound of [
    "Do not provide store credit and replace the item.",
    "Do not provide store credit and reship the item.",
    "Do not provide store credit and set up a replacement.",
    "Do not provide store credit and arrange a replacement.",
    "Do not provide store credit and schedule a replacement.",
    "Do not provide store credit and carry out a replacement.",
    "Do not provide store credit and move forward with a replacement.",
    "Do not provide store credit and proceed with a replacement.",
    "Do not provide store credit and arrange the approved replacement order.",
    "Do not provide store credit and set up the replacement order in OMS.",
    "Do not provide store credit and submit a replacement item.",
  ]) {
    assert.equal(
      sequenceFindings(
        [{ id: "replacement_completion", phrases: ["placed the replacement order", "submitted the replacement order"] }],
        [directResolutionCompound],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      directResolutionCompound,
    );
  }

  for (const [detailOnlyRule, completionPhrases] of [
    ["Do not promise the refund posting date.", ["issued the refund", "processed the refund"]],
    ["Do not promise a replacement arrival window.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not promise a refund.", ["issued the refund", "processed the refund"]],
    ["Do not guarantee the refund.", ["issued the refund", "processed the refund"]],
  ] as const) {
    assert.equal(
      sequenceFindings(
        [{ id: "outcome_completion", phrases: [...completionPhrases] }],
        [detailOnlyRule],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      false,
      detailOnlyRule,
    );
  }
  for (const communicationRule of [
    "Do not promise a refund.",
    "Do not guarantee the refund.",
  ]) {
    assert.equal(
      sequenceFindings(
        [{ id: "refund_commitment", phrases: ["promise refund", "guarantee refund"] }],
        [communicationRule],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      communicationRule,
    );
  }
  for (const [operationRule, completionPhrases] of [
    ["Do not process the approved full refund to the original payment card.", ["issued the refund", "processed the refund"]],
    ["Do not process the approved refund to Jamie's original payment card.", ["issued the refund", "processed the refund"]],
    ["Do not process the approved refund to their original payment card.", ["issued the refund", "processed the refund"]],
    ["Do not process the approved refund to her original card.", ["issued the refund", "processed the refund"]],
    ["Do not process the approved refund to his original card.", ["issued the refund", "processed the refund"]],
    ["Do not place the approved replacement order.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not submit a replacement item.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not submit the replacement order via OMS.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not arrange a replacement for Jamie via OMS.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not submit a replacement for Jamie through OMS.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not submit a replacement for Jamie using OMS.", ["placed the replacement order", "submitted the replacement order"]],
    ["Do not submit a replacement for Jamie via the OMS.", ["placed the replacement order", "submitted the replacement order"]],
  ] as const) {
    assert.equal(
      sequenceFindings(
        [{ id: "outcome_completion", phrases: [...completionPhrases] }],
        [operationRule],
      ).some((finding) => finding.code === "prohibited_chat_advance_phrase"),
      true,
      operationRule,
    );
  }

  assert.equal(
    compileSafeChatAdvanceRequirements({
      ...generated.phases[0],
      learnerActions: ["Issue the full refund."],
      chatAdvanceRequirements: [{
        id: "refund_completion",
        phrases: ["issued the refund", "processed the refund"],
      }],
    }, ["Do not issue the refund until they approve it."], "Jamie"),
    undefined,
  );
});

test("rejects values and resolution options outside prohibition allowlists", () => {
  const prohibitedActions = [
    "Do not issue a refund for an amount other than $32.49.",
    "Do not state a timeline other than 3-5 business days.",
    "Do not offer anything other than a full refund.",
  ];
  const findingsFor = (phrases: string[]) => findChatAdvanceRequirementQualityFindings(
    [{ id: "approved_outcome", phrases }],
    prohibitedActions,
    "Jamie",
  );

  assert.equal(findingsFor(["issued the $32.49 refund", "processed the $32.49 refund"])
    .some((finding) => finding.code === "prohibited_chat_advance_phrase"), false);
  assert.equal(findingsFor(["3-5 business days", "3–5 business days", "3 to 5 business days"])
    .some((finding) => finding.code === "prohibited_chat_advance_phrase"), false);

  for (const prohibitedPhrase of [
    "issued the $31.99 refund",
    "5-7 business days",
    "72 hours",
    "offered store credit",
    "sent a replacement",
    "offered an exchange",
  ]) {
    assert.equal(findingsFor([prohibitedPhrase, `confirmed ${prohibitedPhrase}`])
      .some((finding) => finding.code === "prohibited_chat_advance_phrase"), true, prohibitedPhrase);
  }
});

test("compiles the damaged-bag replacement conversation into independent natural Chat concepts", () => {
  const compile = (learnerActions: string[]) => compileSafeChatAdvanceRequirements({
    ...generated.phases[0],
    learnerActions,
    chatAdvanceRequirements: [],
  }, [
    "Do not offer a refund or store credit.",
    "Do not place the no-cost replacement before the customer confirms they want it.",
  ], "Maya");

  assert.deepEqual(compile([
    "Acknowledge the damaged bag and apologize.",
    "Offer a no-cost replacement.",
  ]), [
    { id: "acknowledge_empathy", phrases: expectedEmpathyPhrases },
    { id: "replacement_offer", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
    { id: "replacement_no_cost", phrases: ["no cost", "no-cost", "at no charge", "free of charge"] },
  ]);
  assert.deepEqual(compile([
    "Confirm the customer wants the replacement before placing it.",
  ]), [
    { id: "replacement_question_intent", phrases: expectedQuestionIntentPhrases },
    { id: "replacement_resolution", phrases: ["replacement", "replacement order", "replacement bag", "new bag", "replace it"] },
  ]);
  assert.deepEqual(compile([
    "State that the replacement should arrive within 2–3 business days.",
    "Tell the customer they do not need to return the damaged bag.",
  ]), [
    {
      id: "replacement_timeline",
      phrases: [
        "2-3 business days",
        "2–3 business days",
        "2 to 3 business days",
        "two to three business days",
        "couple of business days",
      ],
    },
    {
      id: "no_return",
      phrases: [
        "not need to return",
        "don't need to return",
        "don’t need to return",
        "no need to return",
        "don't send it back",
        "don’t send it back",
        "keep the damaged bag",
        "dispose of the damaged bag",
      ],
    },
  ]);
});

test("repairs generic provider phase labels from detailed Coach Chewy guidance", async () => {
  const exactHandling = "Acknowledge the frustration, apologize, and offer a no-cost replacement. Confirm the customer wants the replacement before placing it, explain that it should arrive within 2–3 business days, and tell them they do not need to return the damaged bag. Do not offer a refund or store credit.";
  const providerDraft = {
    ...generated,
    title: "Damaged Dog Food Bag Replacement",
    learnerGoal: exactHandling,
    customer: {
      ...generated.customer,
      name: "Maya",
      openingLine: "Hi, my dog food bag showed up torn and food spilled all over the box. I need a usable bag.",
      closingLine: "Okay, please send the replacement.",
    },
    correctProcess: [exactHandling],
    prohibitedActions: [
      "Do not offer a refund or store credit.",
      "Do not place the no-cost replacement before the customer confirms they want it.",
    ],
    phases: [
      {
        ...generated.phases[0],
        id: "acknowledge_and_offer_replacement",
        title: "Acknowledge and offer replacement",
        learnerActions: ["Acknowledge", "Offer a no-cost replacement."],
        chatAdvanceRequirements: [
          { id: "opening_evidence", phrases: ["sorry", "torn bag"] },
          { id: "replacement_evidence", phrases: ["no-cost replacement", "replacement bag"] },
        ],
        partnerResponse: "I just need a usable bag. If you can send a replacement, that's fine.",
        coachGuidance: [
          "Use a warm tone.",
          "Maintain an empathetic tone.",
          "Acknowledge empathetically.",
          "Acknowledge the damaged bag and apologize.",
          "Offer a no-cost replacement.",
          "Do not offer store credit.",
        ],
      },
      {
        ...generated.phases[0],
        id: "confirm_preference",
        title: "Confirm preference",
        learnerActions: ["Confirm"],
        chatAdvanceRequirements: [
          { id: "replacement_confirmation", phrases: ["want the replacement", "okay to send"] },
        ],
        partnerResponse: "Yes, that works.",
        coachGuidance: [
          "Confirm the customer wants the replacement before placing it.",
          "Do not place the no-cost replacement before the customer confirms they want it.",
        ],
      },
      {
        ...generated.phases[0],
        id: "set_expectation_and_close",
        title: "Set expectation and close",
        learnerActions: ["Explain Recap"],
        chatAdvanceRequirements: [
          { id: "replacement_timeline", phrases: ["2-3 business days", "within 3 business days"] },
          { id: "return_guidance", phrases: ["no return needed", "keep the damaged bag"] },
        ],
        partnerResponse: "Okay, please send the replacement.",
        coachGuidance: [
          "State that the replacement should arrive within 2–3 business days.",
          "Tell the customer they do not need to return the damaged bag.",
          "Avoid offering a refund or store credit.",
        ],
      },
    ],
    objectives: [
      {
        id: "acknowledge_and_offer_replacement",
        label: "Acknowledge and offer replacement",
        description: "Respond to the damaged delivery with empathy and a no-cost replacement offer.",
        criteria: [
          "Acknowledge the frustration.",
          "Apologize for the torn bag.",
          "Offer a no-cost replacement.",
        ],
      },
      {
        id: "confirm_before_placing",
        label: "Confirm before placing",
        description: "Verify the customer wants the replacement before taking the final action.",
        criteria: [
          "Confirm the customer wants the replacement.",
          "Avoid placing it before confirmation.",
          "Do not place the no-cost replacement before the customer confirms they want it.",
        ],
      },
      {
        id: "set_timeline_and_no_return_guidance",
        label: "Set timeline and no-return guidance",
        description: "Close with the expected delivery window and return guidance.",
        criteria: [
          "Explain the 2–3 business-day window.",
          "Confirm no return is needed.",
          "Avoid offering a refund or store credit.",
        ],
      },
    ],
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(providerDraft),
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received a torn dog food bag with food spilled in the box and needs a usable bag.",
    learnerGoal: exactHandling,
    correctProcess: exactHandling,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.deepEqual(payload.draft.phases.map((phase: { learnerActions: string[] }) => phase.learnerActions), [
    ["Acknowledge the damaged bag and apologize.", "Offer a no-cost replacement."],
    ["Confirm the customer wants the replacement before placing it."],
    [
      "State that the replacement should arrive within 2–3 business days.",
      "Tell the customer they do not need to return the damaged bag.",
    ],
  ]);
  assert.equal(
    payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions)
      .some((action: string) => /^(?:avoid|do not)\b/iu.test(action)),
    false,
  );

  const authoring = normalizeStudioDraft(standaloneToAuthoringDraft(payload.draft, {
    conversationAbout: "A fictional customer received a torn dog food bag with food spilled in the box and needs a usable bag.",
    learnerApproach: exactHandling,
    deidentificationConfirmed: true,
  }));
  const downloadableDraft = authoringToStandaloneDraft(authoring);
  const validationResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadableDraft,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadableDraft.objectives),
      },
    }),
  }));
  const validationPayload = await validationResponse.json();

  assert.equal(validationResponse.status, 200, JSON.stringify(validationPayload.issues));
  assert.equal(validationPayload.ok, true);
  assert.deepEqual(validationPayload.files.map((file: { filename: string }) => file.filename), [
    "damaged_dog_food_bag_replacement_chat.json",
    "damaged_dog_food_bag_replacement_voice.json",
  ]);

  const negativeCriteria = downloadableDraft.objectives
    .flatMap((objective: { criteria: string[] }) => objective.criteria)
    .filter((criterion: string) => /^(?:avoid|do not)\b/iu.test(criterion));
  assert.deepEqual(negativeCriteria, [
    "Do not place the no-cost replacement before the customer confirms they want it.",
    "Do not offer a refund or store credit.",
  ]);

  const chat = validationPayload.files.find((file: { scenario: { channels: string[] } }) =>
    file.scenario.channels[0] === "chat"
  ).scenario;
  const voice = validationPayload.files.find((file: { scenario: { channels: string[] } }) =>
    file.scenario.channels[0] === "voice"
  ).scenario;
  const sequencingBoundary = "Do not place the no-cost replacement before the customer confirms they want it.";
  for (const scenario of [chat, voice]) {
    const scoredCriteria = scenario.coaching.gradingModel.objectives
      .flatMap((objective: { criteria: string[] }) => objective.criteria);
    const guideSections = scenario.channels[0] === "chat"
      ? scenario.frontend.chat.guideSections
      : scenario.frontend.voice.guideSections;
    const guideBullets = guideSections.flatMap((section: { bullets: string[] }) => section.bullets);
    assert.equal(scenario.evaluationCriteria.filter((criterion: string) => criterion === sequencingBoundary).length, 1);
    assert.equal(scoredCriteria.filter((criterion: string) => criterion === sequencingBoundary).length, 1);
    assert.equal(guideBullets.filter((bullet: string) => bullet === sequencingBoundary).length, 1);
  }
  const currentRiseMatches = (message: string, step: {
    match: { all: Array<{ op: string; phrases: string[] }>; any: Array<{ op: string; phrases: string[] }> };
  }) => {
    const normalized = message.toLowerCase();
    const conditionMatches = (condition: { op: string; phrases: string[] }) =>
      condition.op === "contains_any"
      && condition.phrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
    return (!step.match.all.length || step.match.all.every(conditionMatches))
      && (!step.match.any.length || step.match.any.some(conditionMatches));
  };
  const chatSteps = chat.chatConfig.stepProgression;
  const naturalTurns = [
    "I'm really sorry Biscuit's food arrived damaged. I can replace it at no charge.",
    "Would you like me to send you a new bag?",
    "It should arrive in a couple of business days, and you don’t need to return the damaged bag.",
  ];
  naturalTurns.forEach((message, index) => {
    assert.equal(currentRiseMatches(message, chatSteps[index]), true, message);
    assert.deepEqual(Object.keys(chatSteps[index].match).sort(), ["all", "any"]);
  });
  for (const [stepIndex, incompleteTurn] of [
    [0, "I'm sorry about the torn bag. I can send a replacement."],
    [0, "I'm really sorry the food arrived damaged. I can help at no charge."],
    [1, "I can send a replacement."],
    [1, "Would you like me to send it?"],
    [2, "It should arrive in two to three business days."],
    [2, "You don’t need to return the damaged bag."],
  ] as const) {
    assert.equal(currentRiseMatches(incompleteTurn, chatSteps[stepIndex]), false, incompleteTurn);
  }
  assert.equal(currentRiseMatches(
    "I'm not really sorry, but I can replace it at no charge.",
    chatSteps[0],
  ), false);
  assert.equal(currentRiseMatches(
    "It should arrive in a couple of business days, and you don't need to return the damaged bag.",
    chatSteps[2],
  ), true);
  assert.equal(
    currentRiseMatches(`${naturalTurns[0]} I can also offer store credit.`, chatSteps[0]),
    true,
  );
  assert.equal(negativeCriteria.some((criterion: string) => /refund or store credit/iu.test(criterion)), true);

  const voiceSteps = voice.simulation.stateModel.voiceStepProgression;
  const genericLabel = /:\s*(?:Acknowledge|Explain|Confirm|Recap)(?:\s+(?:Acknowledge|Explain|Confirm|Recap))*\s*$/u;
  voiceSteps.forEach((step: { trigger: string }, index: number) => {
    assert.doesNotMatch(step.trigger, genericLabel);
    assert.match(step.trigger, new RegExp(downloadableDraft.phases[index].learnerActions[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  });
  assert.deepEqual(
    voice.simulation.approvedTranscript.slice(0, 3).map((turn: { idealAgentResponse: string }) => turn.idealAgentResponse),
    downloadableDraft.phases.map((phase: { learnerActions: string[] }) => phase.learnerActions.join(" ")),
  );

  const generateVariant = async (learnerActions: string[], coachGuidance: string[], phaseIndex = 0) => {
    const variantHandler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse({
        ...providerDraft,
        phases: providerDraft.phases.map((phase, index) => index === phaseIndex
          ? { ...phase, learnerActions, coachGuidance }
          : phase),
      }),
    });
    const variantResponse = await variantHandler(request({
      ...validBody,
      situation: "A fictional customer received a torn dog food bag with food spilled in the box and needs a usable bag.",
      learnerGoal: exactHandling,
      correctProcess: exactHandling,
    }));
    const variantPayload = await variantResponse.json();
    assert.equal(variantResponse.status, 200, JSON.stringify(variantPayload.error));
    return variantPayload.draft.phases[phaseIndex].learnerActions as string[];
  };
  assert.deepEqual(await generateVariant(
    ["Offer a no-cost replacement.", "Acknowledge"],
    ["Acknowledge the damaged bag and apologize.", "Offer a no-cost replacement."],
  ), [
    "Offer a no-cost replacement.",
    "Acknowledge the damaged bag and apologize.",
  ]);
  assert.deepEqual(await generateVariant(
    ["Acknowledge", "Offer"],
    ["Acknowledge the damaged bag, apologize, and offer a no-cost replacement."],
  ), [
    "Acknowledge the damaged bag, apologize, and offer a no-cost replacement.",
  ]);
  assert.deepEqual(await generateVariant(
    ["Offer", "Acknowledge"],
    ["Acknowledge the damaged bag and apologize.", "Offer a no-cost replacement."],
  ), [
    "Offer a no-cost replacement.",
    "Acknowledge the damaged bag and apologize.",
  ]);
  for (const genericLabel of ["Set expectations", "Explain next steps", "Close"]) {
    assert.deepEqual(await generateVariant(
      [genericLabel],
      [
        "State that the replacement should arrive within 2–3 business days.",
        "Tell the customer they do not need to return the damaged bag.",
      ],
      2,
    ), [
      "State that the replacement should arrive within 2–3 business days.",
      "Tell the customer they do not need to return the damaged bag.",
    ], genericLabel);
  }
});

test("fails closed when a generic provider phase has only style guidance", async () => {
  let calls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return providerResponse({
        ...generated,
        phases: [{
          ...generated.phases[0],
          learnerActions: ["Acknowledge"],
          coachGuidance: ["Use a warm tone."],
        }],
      });
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "generation_unavailable");
  assert.equal(calls, 2);
  assert.equal("draft" in payload, false);
});

test("rebuilds repeated generic corrective output from the exact creator-approved replacement process", async () => {
  const exactHandling = "Acknowledge the frustration and apologize. Offer a no-cost replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement, explain that it should arrive within 2-3 business days, and tell the customer they do not need to return the damaged bag. Do not offer a refund or store credit.";
  const genericDraft = {
    ...generated,
    title: "Damaged Dog Food Bag Replacement",
    learnerGoal: exactHandling,
    customer: {
      ...generated.customer,
      name: "Maya",
      openingLine: "My dog food bag arrived torn and unusable.",
    },
    correctProcess: [exactHandling],
    prohibitedActions: ["Do not offer a refund or store credit."],
    phases: [{
      ...generated.phases[0],
      learnerActions: ["Acknowledge"],
      chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["acknowledge"] }],
      coachGuidance: ["Use a warm tone."],
    }],
    objectives: [{
      ...generated.objectives[0],
      id: "replacement_resolution",
      criteria: ["Acknowledge the concern."],
    }],
  };
  let calls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return providerResponse(genericDraft);
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received a torn dog food bag and needs a usable replacement.",
    learnerGoal: exactHandling,
    correctProcess: exactHandling,
  }));
  const payload = await response.json();
  const learnerActions = payload.draft?.phases
    .flatMap((phase: { learnerActions: string[] }) => phase.learnerActions) ?? [];

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(calls, 2);
  assert.equal(learnerActions.includes("Offer a no-cost replacement."), true);
  assert.equal(learnerActions.includes("Place a no-cost replacement order."), true);
  assert.equal(learnerActions.includes("Tell the Conversation Partner they do not need to return the item."), true);
});

test("drops stray provider objectives when rebuilding from the exact creator-approved process", async () => {
  const exactHandling = "Acknowledge the frustration and apologize. Offer a no-cost replacement. Confirm the customer wants the replacement before placing it. After confirmation, place the replacement, explain that it should arrive within 2-3 business days, and tell the customer they do not need to return the damaged bag. Do not offer a refund or store credit.";
  const prohibitedActions = ["Do not offer a refund or store credit."];
  const duplicateOutcomePhase = (id: string) => {
    const phase = {
      ...generated.phases[0],
      id,
      learnerActions: ["Process the replacement order."],
      chatAdvanceRequirements: [],
      partnerResponse: "Thank you.",
    };
    return {
      ...phase,
      chatAdvanceRequirements: compileSafeChatAdvanceRequirements(
        phase,
        prohibitedActions,
        generated.customer.name,
      )!,
    };
  };
  const providerDraft = {
    ...generated,
    learnerGoal: exactHandling,
    correctProcess: [exactHandling],
    prohibitedActions,
    phases: [duplicateOutcomePhase("first_outcome"), duplicateOutcomePhase("second_outcome")],
    objectives: [
      {
        ...generated.objectives[0],
        id: "unapproved_transfer",
        label: "Transfer to a supervisor",
        description: "Escalate the conversation.",
        criteria: ["Transfer the conversation to a supervisor."],
      },
      {
        ...generated.objectives[0],
        id: "complete_action",
        criteria: ["Complete the approved action."],
      },
      {
        ...generated.objectives[0],
        id: "acknowledge_concern",
        criteria: ["Acknowledge the concern."],
      },
    ],
  };
  let calls = 0;
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return providerResponse(providerDraft);
    },
  });

  const response = await handler(request({
    ...validBody,
    situation: "A fictional customer received a torn dog food bag and needs a usable replacement.",
    learnerGoal: exactHandling,
    correctProcess: exactHandling,
  }));
  const payload = await response.json();
  const criteria = payload.draft?.objectives
    .flatMap((objective: { criteria: string[] }) => objective.criteria) ?? [];

  assert.equal(response.status, 200, JSON.stringify(payload.error));
  assert.equal(calls, 2);
  assert.equal(payload.draft.objectives.length, 1);
  assert.deepEqual({
    id: payload.draft.objectives[0].id,
    label: payload.draft.objectives[0].label,
    description: payload.draft.objectives[0].description,
  }, {
    id: "complete_approved_replacement",
    label: "Complete the approved replacement",
    description: "Apply the approved replacement process accurately.",
  });
  assert.equal(criteria.includes("Transfer the conversation to a supervisor."), false);
  assert.deepEqual(criteria, [
    ...payload.draft.phases.flatMap((phase: { learnerActions: string[] }) => phase.learnerActions),
    ...payload.draft.prohibitedActions,
  ]);
});

test("fails closed when a generic fallback would drop an unsupported creator behavior", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Acknowledge"],
        chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["acknowledge"] }],
        coachGuidance: ["Use a warm tone."],
      }],
      objectives: [{
        ...generated.objectives[0],
        criteria: ["Acknowledge the concern."],
      }],
    }),
  });

  const response = await handler(request({
    ...validBody,
    learnerGoal: "Acknowledge the concern and use the approved escalation.",
    correctProcess: "Acknowledge the concern. Escalate the case to a supervisor.",
  }));
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "generation_unavailable");
  assert.equal("draft" in payload, false);
});

test("preserves an Avoid colon guardrail during the generic behavior fallback", async () => {
  for (const correctProcess of [
    "Acknowledge the concern. Avoid: Do not guarantee a delivery date.",
    "Acknowledge the concern.\n- Avoid: Do not guarantee a delivery date.",
  ]) {
    let calls = 0;
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => {
        calls += 1;
        return providerResponse({
          ...generated,
          prohibitedActions: [],
          phases: [{
            ...generated.phases[0],
            learnerActions: ["Acknowledge"],
            chatAdvanceRequirements: [{ id: "acknowledgement", phrases: ["acknowledge"] }],
            coachGuidance: ["Use a warm tone."],
          }],
          objectives: [{
            ...generated.objectives[0],
            criteria: ["Acknowledge the concern."],
          }],
        });
      },
    });

    const response = await handler(request({
      ...validBody,
      learnerGoal: "Acknowledge the concern without making an unconfirmed delivery promise.",
      correctProcess,
    }));
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload.error));
    assert.equal(calls, 2);
    assert.deepEqual(payload.draft.prohibitedActions, ["Do not guarantee a delivery date."]);
  }
});

test("validates normalized refund criteria through the complete generated Review/Edit download path", async () => {
  const generate = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      phases: [{
        ...generated.phases[0],
        learnerActions: ["Issue and process the approved full refund to the original payment card."],
      }],
      objectives: [{
        id: "obj1",
        label: "Refund Process Accuracy",
        description: "Complete and explain the approved refund.",
        criteria: [
          "Issues the approved refund.",
          "Informs the customer when the refund will post.",
          "Processing the refund without changing its destination.",
          "Express understanding of the inconvenience caused by the damage.",
        ],
      }],
    }),
  });
  const generatedResponse = await generate(request(validBody));
  const generatedPayload = await generatedResponse.json();
  const authoring = normalizeStudioDraft(standaloneToAuthoringDraft(generatedPayload.draft));
  const downloadableDraft = authoringToStandaloneDraft(authoring);
  const validate = createValidateHandler();
  const validationResponse = await validate(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: downloadableDraft,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(downloadableDraft.objectives),
      },
    }),
  }));
  const validationPayload = await validationResponse.json();

  assert.equal(generatedResponse.status, 200);
  assert.equal(validationResponse.status, 200, JSON.stringify(validationPayload.issues));
  assert.equal(validationPayload.ok, true);
});

test("replaces sensitive-looking details invented by the provider before returning the draft", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: {
        ...generated.customer,
        openingLine: "Call me at 415-555-1212 about order number 987654321.",
      },
    }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    payload.draft.customer.openingLine,
    "Call me at [de-identified phone] about [fictional service identifier].",
  );
});

test("gives hosted structured generation a two-minute provider window", async () => {
  let requestedTimeout = 0;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ((milliseconds: number) => {
    requestedTimeout = milliseconds;
    return originalTimeout.call(AbortSignal, milliseconds);
  }) as typeof AbortSignal.timeout;

  try {
    const handler = createGenerateHandler({
      apiKey: "test-key",
      fetchImpl: async () => providerResponse(generated),
    });

    const response = await handler(request(validBody));

    assert.equal(response.status, 200);
    assert.equal(requestedTimeout, 120_000);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test("returns a specific message when provider generation times out", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 504);
  assert.equal(payload.error.code, "generation_timeout");
  assert.equal(payload.error.message, "Coach Chewy took too long to create the draft. Try again.");
});

test("returns a specific message when provider output cannot be safely repaired", async () => {
  const unsafeCustomer = {
    ...generated.customer,
    orderNumber: "987654321",
  };
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({ ...generated, customer: unsafeCustomer }),
  });

  const response = await handler(request(validBody));
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "unsafe_provider_output");
  assert.equal(
    payload.error.message,
    "Coach Chewy created a draft with sensitive-looking details that could not be safely replaced. Try again.",
  );
});

test("preserves imported scenario identity and channel settings in improve mode", async () => {
  const sourceDraft = importedDraft({
    baseId: "existing_refund_scenario",
    channels: ["voice"],
    chat: { hotkeyProfile: "rx", standardText: [{ hotkey: "de6", category: "Shipping", template: "Hello", insertionMoment: "After the status.", customization: "Review before sending.", notes: [], approvedGuidance: "" }], standardTextDecision: "approved" },
    voice: { selectedVoice: "cedar", speed: 0.95 },
  });
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse(generated),
  });

  const response = await handler(request({
    ...validBody,
    mode: "improve",
    channels: ["voice"],
    sourceDraft,
  }));
  const payload = await response.json();

  assert.equal(payload.draft.baseId, "existing_refund_scenario");
  assert.deepEqual(payload.draft.channels, ["voice"]);
  assert.deepEqual(payload.draft.chat, sourceDraft.chat);
  assert.deepEqual(payload.draft.voice, sourceDraft.voice);
});

test("withholds sensitive-looking imported details from the AI while keeping them for creator review", async () => {
  let providerInput = "";
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      const sent = JSON.parse(String(init?.body));
      providerInput = sent.input[1].content[0].text;
      return providerResponse(generated);
    },
  });
  const sourceDraft = importedDraft({
    compatibilityFacts: { address: "123 Main Street", medication: "", urgency: "", medicationOrProduct: "", clinic: "" },
  });

  const response = await handler(request({ ...validBody, mode: "improve", sourceDraft }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.doesNotMatch(providerInput, /123 Main Street/);
  assert.match(providerInput, /redacted imported detail/);
  assert.equal(payload.draft.compatibilityFacts.address, "123 Main Street");
  assert.equal(payload.assumptions.some((assumption: string) => assumption.includes("withheld from AI")), true);
});

test("redacts imported address details repeated in the improve form instead of blocking generation", async () => {
  let providerInput = "";
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      const sent = JSON.parse(String(init?.body));
      providerInput = sent.input[1].content[0].text;
      return providerResponse(generated);
    },
  });
  const sourceDraft = importedDraft({
    baseId: "address_update",
    compatibilityFacts: { address: "123 Main Street", medication: "", urgency: "", medicationOrProduct: "", clinic: "" },
  });

  const response = await handler(request({
    ...validBody,
    mode: "improve",
    situation: "Update an order shipping to 123 Main Street.",
    correctProcess: "Confirm 123 Main Street before saving the change.",
    sourceDraft,
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.doesNotMatch(providerInput, /123 Main Street/);
  assert.match(providerInput, /redacted imported detail/);
  assert.equal(payload.assumptions.some((assumption: string) => assumption.includes("withheld from AI")), true);
});

test("drops unknown imported fields and redacts sensitive object keys before calling the provider", async () => {
  let providerInput = "";
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async (_input, init) => {
      const sent = JSON.parse(String(init?.body));
      providerInput = sent.input[1].content[0].text;
      return providerResponse(generated);
    },
  });
  const sourceDraft = importedDraft() as StudioDraft & Record<string, unknown>;
  sourceDraft.orderId = 123456789;
  sourceDraft["person@personalmail.com"] = "hidden in an object key";

  const response = await handler(request({ ...validBody, mode: "improve", sourceDraft }));

  assert.equal(response.status, 200);
  assert.doesNotMatch(providerInput, /123456789|person@personalmail\.com/);
});

test("keeps a collision-safe learning-objective copy ID for full-conversation Similar mode", async () => {
  const handler = createGenerateHandler({ apiKey: "test-key", fetchImpl: async () => providerResponse(generated) });
  const sourceDraft = importedDraft({
    baseId: "late_dog_food_order_learning_objective_copy",
    objectiveApprovalRequired: true,
  });

  const response = await handler(request({ ...validBody, mode: "similar", sourceDraft }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.draft.baseId, "late_dog_food_order_learning_objective_copy");
});

test("uses only an uploaded approved hotkey as the Similar-mode Standard Text recommendation", async () => {
  const handler = createGenerateHandler({ apiKey: "test-key", fetchImpl: async () => providerResponse(generated) });
  const sourceDraft = importedDraft({
    channels: ["chat"],
    chat: {
      hotkeyProfile: "core",
      standardTextDecision: "approved",
      standardText: [{
        hotkey: "de3",
        category: "Shipping",
        template: "Older approved DE3 wording.",
        insertionMoment: "After confirming the approved partial refund.",
        customization: "Customize the amount.",
        notes: [],
        approvedGuidance: "",
      }],
    },
  });

  const response = await handler(request({ ...validBody, mode: "similar", channels: ["chat"], sourceDraft }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.draft.chat.standardTextRecommendations.map((item: { hotkey: string }) => item.hotkey), ["de3"]);
});

test("keeps full-conversation process context in Similar mode without copying its fictional address", async () => {
  const handler = createGenerateHandler({ apiKey: "test-key", fetchImpl: async () => providerResponse(generated) });
  const sourceDraft = importedDraft({
    objectiveApprovalRequired: true,
    correctProcess: ["Confirm 3948 Simpson Road before completing the address update."],
  });

  const response = await handler(request({ ...validBody, mode: "similar", sourceDraft }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.draft.correctProcess.some((line: string) => line.includes("3948 Simpson Road")), false);
  assert.equal(payload.draft.correctProcess.some((line: string) => line.includes("[fictional address]")), true);
});
