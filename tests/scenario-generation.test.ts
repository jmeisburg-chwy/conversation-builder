import assert from "node:assert/strict";
import test from "node:test";

import { createGenerateHandler } from "../lib/scenario-generation";
import { createValidateHandler } from "../lib/scenario-validation";
import { objectiveFingerprint } from "../lib/objective-approval";
import type { StudioDraft } from "../lib/scenario-contract";
import { authoringToStandaloneDraft, standaloneToAuthoringDraft } from "../public/builder-studio/src/standaloneAdapter.js";
import { normalizeStudioDraft } from "../public/builder-studio/src/scenarioStudio.js";

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
  assert.equal(payload.draft.baseId, "late_dog_food_order");
  assert.deepEqual(payload.draft.channels, ["chat", "voice"]);
  assert.equal(payload.draft.chat.hotkeyProfile, "core");
  assert.equal(payload.draft.chat.standardTextRecommendations.length > 0, true);
  assert.equal(payload.draft.chat.standardTextRecommendations.length <= 3, true);
  assert.equal(payload.draft.voice.selectedVoice, "marin");
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
    "Do not guarantee the delivery date.",
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

test("rejects generated Chat gates that use weak or prohibited evidence", async () => {
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

test("validates normalized refund criteria through the complete generated Review/Edit download path", async () => {
  const generate = createGenerateHandler({
    apiKey: "test-key",
    fetchImpl: async () => providerResponse({
      ...generated,
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
