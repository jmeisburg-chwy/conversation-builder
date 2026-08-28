import assert from "node:assert/strict";
import test from "node:test";

import { createGenerateHandler } from "../lib/scenario-generation";
import type { StudioDraft } from "../lib/scenario-contract";

const validBody = {
  mode: "new",
  deidentificationConfirmed: true,
  channels: ["chat", "voice"],
  situation: "A fictional customer needs help with a delayed dog food order.",
  learnerGoal: "Resolve the delay without guaranteeing a delivery date.",
  correctProcess: "Acknowledge the concern, check the delivery estimate, and explain the next step.",
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
  assert.equal(payload.draft.baseId, "late_dog_food_order");
  assert.deepEqual(payload.draft.channels, ["chat", "voice"]);
  assert.equal(payload.draft.chat.hotkeyProfile, "core");
  assert.equal(payload.draft.chat.standardTextRecommendations.length > 0, true);
  assert.equal(payload.draft.chat.standardTextRecommendations.length <= 3, true);
  assert.equal(payload.draft.voice.selectedVoice, "marin");
  assert.deepEqual(payload.assumptions, generated.assumptions);
});

test("blocks personal data in provider output and reports a generic generation failure", async () => {
  const handler = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
      customer: { ...generated.customer, openingLine: "Call me at 415-555-1212." },
    }),
  });

  const response = await handler(request(validBody));

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "generation_unavailable");
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
