import assert from "node:assert/strict";
import test from "node:test";

import { createValidateHandler } from "../lib/scenario-validation";
import { createDefaultVoiceExperience, type StudioDraft } from "../lib/scenario-contract";
import { objectiveFingerprint } from "../lib/objective-approval";
import { findOverlappingResolutionProhibitionGroups } from "../lib/scenario-quality-guards";
import { recommendStandardText } from "../lib/standard-text-recommendations";

function draft(): StudioDraft {
  return {
    baseId: "late_order_recovery",
    title: "Late Order Recovery",
    description: "Practice resolving a delayed order without overpromising.",
    learnerGoal: "Set accurate expectations and explain the next step.",
    channels: ["chat", "voice"],
    agentType: "Core",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    teamAudience: "Customer Care",
    customer: {
      name: "Jordan",
      petName: "Milo",
      tone: "Concerned but cooperative",
      goal: "Understand when the order is expected.",
      openingLine: "Milo's food was supposed to arrive yesterday. Can you help?",
      facts: ["The order is expected tomorrow by end of day."],
      revealOnlyWhenAsked: ["Milo has food for two more days."],
      objections: ["Can you guarantee it will arrive tomorrow?"],
      behaviorRules: ["Do not invent order details."],
      conditionalFollowUps: ["After the expected date is explained, ask what happens next if it is late."],
      closingLine: "That answers my question. Thank you.",
    },
    correctProcess: ["Acknowledge the concern.", "Explain the expected delivery window."],
    prohibitedActions: ["Do not guarantee delivery."],
    phases: [{
      id: "acknowledge_and_clarify",
      title: "Acknowledge and clarify",
      learnerActions: ["Acknowledge the concern and confirm the delayed order."],
      chatAdvanceRequirements: [
        { id: "acknowledgement", phrases: ["sorry", "understand", "concern"] },
        { id: "delayed_order", phrases: ["delayed order", "late order"] },
      ],
      partnerResponse: "Yes, it is Milo's food order.",
      coachGuidance: ["Use the customer and pet names naturally.", "Avoid guaranteeing delivery."],
      evaluationLinks: [{
        objectiveId: "set_clear_expectations",
        criterionIds: ["set_clear_expectations_criterion_1", "set_clear_expectations_criterion_2"],
      }],
    }],
    objectives: [{
      id: "set_clear_expectations",
      label: "Set clear expectations",
      description: "Explain the delivery status accurately.",
      criteria: ["State the expected delivery window.", "Avoid guaranteeing delivery."],
    }],
    objectiveApprovalRequired: false,
    compatibilityFacts: { address: "", medication: "", urgency: "Delayed food order.", medicationOrProduct: "Dog food", clinic: "" },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };
}

function request(body: unknown): Request {
  const record = body && typeof body === "object" ? body as { draft?: StudioDraft; objectiveApproval?: unknown } : null;
  const approvedBody = record?.draft
    ? {
        ...record,
        deidentificationConfirmed: true,
        objectiveApproval: record.objectiveApproval ?? { required: true, approved: true, fingerprint: objectiveFingerprint(record.draft.objectives) },
      }
    : body;
  return new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(approvedBody),
  });
}

test("validates and returns separate downloadable files", async () => {
  const response = await createValidateHandler()(request({ draft: draft() }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.files.map((file: { filename: string }) => file.filename), [
    "late_order_recovery_chat.json",
    "late_order_recovery_voice.json",
  ]);
});

test("accepts equivalent option and alternative wording when a prohibition is visibly covered", async () => {
  const covered = draft();
  covered.prohibitedActions = ["Avoid offering store credit or replacements as alternatives."];
  covered.objectives[0].criteria[1] = "Avoid offering or mentioning replacement or store credit options.";
  covered.phases[0].coachGuidance[1] = "Avoid offering store credit or replacement options.";

  const response = await createValidateHandler()(request({ draft: covered }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
  assert.equal(payload.ok, true);
});

test("still rejects equivalent boundary wording when a prohibited action is missing", async () => {
  const missingAction = draft();
  missingAction.prohibitedActions = ["Avoid offering store credit or replacements as alternatives."];
  missingAction.objectives[0].criteria[1] = "Avoid offering store credit options.";
  missingAction.phases[0].coachGuidance[1] = "Avoid offering store credit options.";

  const response = await createValidateHandler()(request({ draft: missingAction }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "unmapped_prohibited_action"), true);
});

test("rejects a positive prohibited action even when contrast wording makes it look like a boundary", async () => {
  const positive = draft();
  positive.prohibitedActions = ["Offer store credit instead of refund."];
  positive.objectives[0].criteria[1] = "Offer store credit instead of refund.";
  positive.phases[0].coachGuidance[1] = "Offer store credit instead of refund.";

  const response = await createValidateHandler()(request({ draft: positive }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.find((issue: { code: string }) => issue.code === "positive_prohibited_action"),
    {
      code: "positive_prohibited_action",
      path: "draft.prohibitedActions[0]",
      message: "A prohibited action must use explicit negative wording.",
      fix: "Start with Do not, Avoid, or Never so the boundary cannot be interpreted as an approved action.",
    },
  );
});

test("rejects positive contrast wording that contradicts an explicit prohibited action", async () => {
  const contradictory = draft();
  contradictory.prohibitedActions = ["Do not offer store credit instead of refund."];
  contradictory.objectives[0].criteria = [
    "State the expected delivery window.",
    "Offer store credit instead of refund.",
    "Do not offer store credit instead of refund.",
  ];
  contradictory.phases[0].coachGuidance = [
    "Offer store credit rather than a refund.",
    "Do not offer store credit instead of refund.",
  ];
  contradictory.phases[0].learnerActions = [
    "The learner should offer store credit instead of a refund.",
  ];

  const response = await createValidateHandler()(request({ draft: contradictory }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  const contradictionPaths = payload.issues
    .filter((issue: { code: string }) => issue.code === "positive_prohibited_reference")
    .map((issue: { path: string }) => issue.path);
  assert.equal(contradictionPaths.includes("draft.objectives[0].criteria[1]"), true);
  assert.equal(contradictionPaths.includes("draft.phases[0].coachGuidance[0]"), true);
  assert.equal(contradictionPaths.includes("draft.phases[0].learnerActions[0]"), true);
});

test("accepts equivalent subject-led negative polarity in Coach Chewy guidance", async () => {
  const subjectLed = draft();
  subjectLed.prohibitedActions = ["Do not promise a delivery timeline."];
  subjectLed.objectives[0].criteria = [
    "State the expected delivery window.",
    "Do not promise a delivery timeline.",
  ];
  subjectLed.phases[0].coachGuidance = [
    "The representative does not promise a delivery timeline.",
  ];

  const response = await createValidateHandler()(request({ draft: subjectLed }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
});

test("rejects a positive action that contradicts an imported subject-led prohibition", async () => {
  const contradictory = draft();
  contradictory.prohibitedActions = [
    "The representative doesn't promise a delivery timeline.",
  ];
  contradictory.objectives[0].criteria = [
    "State the expected delivery window.",
    "Do not promise a delivery timeline.",
  ];
  contradictory.phases[0].learnerActions = ["Promise a delivery timeline."];
  contradictory.phases[0].coachGuidance = [
    "The representative doesn't promise a delivery timeline.",
  ];

  const response = await createValidateHandler()(request({ draft: contradictory }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string; path: string }) =>
      issue.code === "positive_prohibited_reference"
      && issue.path === "draft.phases[0].learnerActions[0]"
    ),
    true,
  );
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "unmapped_prohibited_action"),
    false,
  );
});

test("blocks private data from downloadable files with an actionable location", async () => {
  const unsafe = draft();
  unsafe.customer.openingLine = "Email my real address at jordan@personalmail.com.";

  const response = await createValidateHandler()(request({ draft: unsafe }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.issues[0], {
    code: "privacy_email_address",
    path: "draft.customer.openingLine",
    message: "The draft contains personal or sensitive details.",
    fix: "Replace this value with fictional or de-identified information.",
  });
  assert.equal(payload.files, undefined);
});

test("blocks download until at least one approved objective exists", async () => {
  const incomplete = draft();
  incomplete.objectives = [];

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.ok, false);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "objectives_required"), true);
});

test("returns a bounded request error instead of throwing on a malformed draft", async () => {
  const response = await createValidateHandler()(request({ draft: { baseId: "bad", title: "Bad", channels: ["chat"], customer: {}, phases: [], objectives: [] } }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "invalid_request");
});

test("requires a JSON content type for validation", async () => {
  const response = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ draft: draft() }),
  }));

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "unsupported_media_type");
});

test("requires de-identification confirmation before validating downloads", async () => {
  const valid = draft();
  const response = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: valid,
      objectiveApproval: { required: true, approved: true, fingerprint: objectiveFingerprint(valid.objectives) },
    }),
  }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "confirmation_required");
});

test("reports missing creator-owned content before offering downloads", async () => {
  const incomplete = draft();
  incomplete.title = "";
  incomplete.phases[0].partnerResponse = "";

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { path: string }) => issue.path === "draft.title"), true);
  assert.equal(payload.issues.some((issue: { path: string }) => issue.path === "draft.phases[0].partnerResponse"), true);
  assert.equal(payload.files, undefined);
});

test("blocks a repeated opening before it can become the first earned partner turn", async () => {
  const invalid = draft();
  invalid.phases[0].partnerResponse = invalid.customer.openingLine;

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.find((issue: { code: string }) => issue.code === "repeated_customer_opening"),
    {
      code: "repeated_customer_opening",
      path: "draft.phases[0].partnerResponse",
      message: "The first Conversation Partner response repeats the opening line.",
      fix: "Write what the Conversation Partner says after the Learner completes Phase 1.",
    },
  );
  assert.equal(payload.files, undefined);
});

test("blocks a customer follow-up that performs the Learner's discovery question", async () => {
  const invalid = draft();
  invalid.customer.conditionalFollowUps = ["Have you checked neighbors or other usual delivery spots?"];
  invalid.phases[0].learnerActions = ["Ask what the customer has already checked for the package."];
  invalid.objectives[0].criteria = [
    "Ask what the customer has already checked for the package.",
    "Avoid guaranteeing delivery.",
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.find((issue: { code: string }) => issue.code === "customer_role_conflict"),
    {
      code: "customer_role_conflict",
      path: "draft.customer.conditionalFollowUps[0]",
      message: "This follow-up assigns the Learner's discovery question to the Conversation Partner.",
      fix: "Rewrite it as the Conversation Partner's reaction or answer after the Learner asks the question.",
    },
  );
  assert.equal(payload.files, undefined);
});

test("blocks customer behavior rules that assign Chewy-agent actions to the Conversation Partner", async () => {
  const invalid = draft();
  invalid.customer.behaviorRules.push(
    "Issue a full refund to the original payment card only.",
    "Inform the customer that the refund will post in 3–5 business days.",
  );

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.filter((issue: { code: string }) => issue.code === "customer_role_conflict")
      .map((issue: { path: string }) => issue.path),
    ["draft.customer.behaviorRules[1]", "draft.customer.behaviorRules[2]"],
  );
});

test("blocks an opening that pre-answers a required preference confirmation", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "The dog food bag arrived torn, and I want a full refund.";
  invalid.customer.goal = "Receive a full refund for the damaged bag.";
  invalid.phases[0].learnerActions = ["Confirm the customer's requested resolution."];
  invalid.phases[0].chatAdvanceRequirements = [
    { id: "acknowledgement", phrases: ["sorry about the damage", "acknowledge the torn bag"] },
    { id: "refund_preference", phrases: ["want a refund", "prefer a refund"] },
  ];
  invalid.phases[0].partnerResponse = "Yes, I want a refund to my original payment card.";

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string; path: string }) =>
      issue.code === "opening_preanswers_phase"
      && issue.path === "draft.customer.openingLine"
    ),
    true,
  );
});

test("blocks a contracted preference disclosure in the opening", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "The bag is torn, so I'd like a refund.";
  invalid.phases[0].learnerActions = ["Confirm the customer's requested resolution."];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "opening_preanswers_phase"),
    true,
  );
});

test("blocks an object-fronted preference disclosure in the opening", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "A full refund is what I need.";
  invalid.phases[0].learnerActions = ["Confirm the customer's requested resolution."];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "opening_preanswers_phase"),
    true,
  );
});

test("blocks a phase that performs a dependent refund outcome before its partner response earns the preference", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "The 40-pound dog food bag arrived torn and unusable.";
  invalid.phases[0] = {
    ...invalid.phases[0],
    learnerActions: [
      "Acknowledge the torn bag, ask Jordan to confirm a full refund, then issue and confirm $32.49 to the original payment card.",
    ],
    chatAdvanceRequirements: [{
      id: "confirm_preference",
      phrases: ["confirm full refund", "ask about refund preference"],
    }],
    partnerResponse: "I just want a full refund.",
  };

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string; path: string }) =>
      issue.code === "phase_preempts_partner_preference"
      && issue.path === "draft.phases[0].learnerActions"
    ),
    true,
  );
});

test("does not treat a generic request for help as an earned resolution preference", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "I need help with a torn dog food bag.";
  invalid.phases[0] = {
    ...invalid.phases[0],
    learnerActions: [
      "Ask whether Jordan wants a full refund, then issue it to the original payment card.",
    ],
    chatAdvanceRequirements: [{
      id: "confirm_preference",
      phrases: ["full refund", "want a refund"],
    }],
    partnerResponse: "I want a full refund.",
  };

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "phase_preempts_partner_preference"),
    true,
  );
});

test("blocks an operational criterion linked to a phase that only confirms outcome details", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "The 40-pound dog food bag arrived torn and unusable.";
  invalid.phases[0] = {
    ...invalid.phases[0],
    learnerActions: [
      "Acknowledge the torn bag and confirm a full refund of $32.49 to the original payment card.",
    ],
    chatAdvanceRequirements: [{
      id: "confirm_preference",
      phrases: ["confirm full refund", "ask about refund preference"],
    }],
    partnerResponse: "I just want a full refund.",
  };
  invalid.objectives[0].criteria = [
    "Issue a full refund of $32.49 to the original payment card.",
    "Avoid guaranteeing delivery.",
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string; path: string }) =>
      issue.code === "linked_criterion_action_missing"
      && issue.path === "draft.objectives[0].criteria[0]"
    ),
    true,
  );
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "phase_preempts_partner_preference"),
    false,
  );
});

test("does not let completing validation satisfy a refund-execution criterion", async () => {
  const invalid = draft();
  invalid.phases[0].learnerActions = [
    "Complete account validation, then confirm whether the customer wants a refund.",
  ];
  invalid.objectives[0].criteria[0] = "Issue a full refund.";

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "linked_criterion_action_missing"),
    true,
  );
});

test("requires one operational phase and one phase link for each operational criterion", async () => {
  const invalid = draft();
  invalid.objectives[0].criteria[0] = "Issue a full refund.";
  invalid.phases = [
    {
      ...invalid.phases[0],
      id: "issue_refund",
      learnerActions: ["Issue a full refund."],
      chatAdvanceRequirements: [{ id: "refund", phrases: ["full refund", "refund issued"] }],
      evaluationLinks: [{
        objectiveId: "set_clear_expectations",
        criterionIds: ["set_clear_expectations_criterion_1", "set_clear_expectations_criterion_2"],
      }],
    },
    {
      ...invalid.phases[0],
      id: "repeat_refund",
      learnerActions: ["Process the full refund again."],
      chatAdvanceRequirements: [{ id: "refund", phrases: ["process refund", "refund again"] }],
      partnerResponse: "Why was it processed twice?",
      evaluationLinks: [{
        objectiveId: "set_clear_expectations",
        criterionIds: ["set_clear_expectations_criterion_1"],
      }],
    },
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "linked_criterion_action_missing"),
    true,
  );
});

test("allows the refund outcome after a prior phase earns the partner preference", async () => {
  const valid = draft();
  valid.customer.openingLine = "The 40-pound dog food bag arrived torn and unusable.";
  valid.phases = [
    {
      ...valid.phases[0],
      id: "confirm_refund_preference",
      title: "Confirm refund preference",
      learnerActions: ["Ask whether Jordan wants a full refund."],
      chatAdvanceRequirements: [{
        id: "confirm_preference",
        phrases: ["confirm full refund", "ask about refund preference"],
      }],
      partnerResponse: "I just want a full refund.",
    },
    {
      ...valid.phases[0],
      id: "complete_refund",
      title: "Complete the refund",
      learnerActions: ["Issue and confirm a $32.49 refund to the original payment card."],
      chatAdvanceRequirements: [
        { id: "refund_amount", phrases: ["$32.49", "refund amount $32.49"] },
        { id: "refund_destination", phrases: ["original payment card", "original card"] },
      ],
      partnerResponse: "Thank you for confirming the refund.",
      evaluationLinks: [],
    },
  ];

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
});

test("blocks a follow-up that requests an option the customer explicitly rejected", async () => {
  const invalid = draft();
  invalid.customer.openingLine = "The damaged bag is unusable, and I want a refund.";
  invalid.customer.goal = "Receive a refund to the original payment card.";
  invalid.customer.objections = ["I don't want store credit or a replacement."];
  invalid.customer.conditionalFollowUps = [
    "Why isn't a replacement possible?",
    "Could you send a replacement instead?",
  ];
  invalid.compatibilityFacts = {
    ...invalid.compatibilityFacts,
    conditionalFollowUp: "Could you send a replacement instead?",
  };

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();
  const paths = payload.issues
    .filter((issue: { code: string }) => issue.code === "contradictory_customer_follow_up")
    .map((issue: { path: string }) => issue.path);

  assert.equal(response.status, 422);
  assert.equal(paths.includes("draft.customer.conditionalFollowUps[0]"), true);
  assert.equal(paths.includes("draft.customer.conditionalFollowUps[1]"), true);
  assert.equal(paths.includes("draft.compatibilityFacts.conditionalFollowUp"), true);
});

test("allows a follow-up consistent with a positive choice introduced by no", async () => {
  const valid = draft();
  valid.customer.goal = "Receive a refund to the original payment card.";
  valid.customer.objections = ["No, I just want a refund."];
  valid.customer.conditionalFollowUps = ["Can I get that refund to my original card?"];
  valid.compatibilityFacts = {
    ...valid.compatibilityFacts,
    conditionalFollowUp: "Can I get that refund to my original card?",
  };

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
});

test("does not confuse store pickup with rejected store credit", async () => {
  const valid = draft();
  valid.customer.objections = ["I don't want store credit."];
  valid.customer.conditionalFollowUps = ["Is store pickup available?"];
  valid.compatibilityFacts = {
    ...valid.compatibilityFacts,
    conditionalFollowUp: "Is store pickup available?",
  };

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
});

test("blocks a morphological restatement of a rejected resolution option", async () => {
  const invalid = draft();
  invalid.customer.objections = ["I don't want a replacement."];
  invalid.customer.conditionalFollowUps = ["Can I get the item replaced?"];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "contradictory_customer_follow_up"),
    true,
  );
});

test("requires grouped Chat evidence and complete criterion-to-phase coverage", async () => {
  const invalid = draft();
  invalid.phases[0].chatAdvanceRequirements = [];
  invalid.phases[0].evaluationLinks = [{
    objectiveId: "set_clear_expectations",
    criterionIds: ["set_clear_expectations_criterion_1"],
  }];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "chat_advance_requirements_required"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "unlinked_objective_criterion"), true);
});

test("blocks weak, overlapping, blank, and prohibited Chat gate evidence", async () => {
  const invalid = draft();
  invalid.prohibitedActions = ["Do not offer store credit or a replacement."];
  invalid.phases[0].chatAdvanceRequirements = [
    { id: "refund_concept", phrases: ["refund", "money back"] },
    { id: "refund_completion", phrases: ["refund has been issued", "completed the refund"] },
    { id: "generic_courtesy", phrases: ["thank", "help"] },
    { id: "prohibited_option", phrases: ["store credit", "replacement"] },
    { id: "blank_alternative", phrases: [" ", "apologize"] },
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();
  const codes = new Set(payload.issues.map((issue: { code: string }) => issue.code));

  assert.equal(response.status, 422);
  assert.equal(codes.has("overlapping_chat_advance_phrase"), true);
  assert.equal(codes.has("generic_chat_advance_phrase"), true);
  assert.equal(codes.has("prohibited_chat_advance_phrase"), true);
  assert.equal(codes.has("blank_chat_advance_phrase"), true);
  assert.equal(codes.has("chat_advance_requirement_alternatives"), true);
});

test("rejects full-turn Chat gates while accepting compact concept and numeric anchors", async () => {
  const brittle = draft();
  brittle.phases[0].chatAdvanceRequirements = [
    {
      id: "refund_amount",
      phrases: [
        "I will issue a refund of $32.49 to your original payment method.",
        "The refund amount is $32.49 and will go back to your payment card.",
      ],
    },
  ];

  const brittleResponse = await createValidateHandler()(request({ draft: brittle }));
  const brittlePayload = await brittleResponse.json();

  assert.equal(brittleResponse.status, 422);
  assert.equal(
    brittlePayload.issues.some((issue: { code: string }) => issue.code === "brittle_chat_advance_phrase"),
    true,
  );

  const compact = draft();
  compact.phases[0].chatAdvanceRequirements = [
    { id: "refund_amount", phrases: ["$32.49", "refund of $32.49"] },
    { id: "refund_destination", phrases: ["original payment card", "original card"] },
    { id: "refund_timeline", phrases: ["3-5 business days", "3 to 5 business days"] },
  ];

  const compactResponse = await createValidateHandler()(request({ draft: compact }));
  const compactPayload = await compactResponse.json();

  assert.equal(compactResponse.status, 200, JSON.stringify(compactPayload.issues));
});

test("rejects a subject-led full-turn Chat gate without terminal punctuation", async () => {
  const brittle = draft();
  brittle.phases[0].chatAdvanceRequirements = [{
    id: "refund_action",
    phrases: ["I will issue the full refund", "We can process the full refund"],
  }];

  const response = await createValidateHandler()(request({ draft: brittle }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string }) => issue.code === "brittle_chat_advance_phrase"),
    true,
  );
});

test("rejects a six-word learner action while accepting noun-led compact anchors", async () => {
  const brittle = draft();
  brittle.phases[0].chatAdvanceRequirements = [{
    id: "refund_destination",
    phrases: ["Issue the refund to original card", "Process refund to original payment card"],
  }];

  const brittleResponse = await createValidateHandler()(request({ draft: brittle }));
  const brittlePayload = await brittleResponse.json();

  assert.equal(brittleResponse.status, 422);
  assert.equal(
    brittlePayload.issues.some((issue: { code: string }) => issue.code === "brittle_chat_advance_phrase"),
    true,
  );

  const compact = draft();
  compact.phases[0].chatAdvanceRequirements = [{
    id: "refund_destination",
    phrases: ["refund to original card", "refund to original payment card"],
  }];

  const compactResponse = await createValidateHandler()(request({ draft: compact }));
  const compactPayload = await compactResponse.json();

  assert.equal(compactResponse.status, 200, JSON.stringify(compactPayload.issues));
});

test("rejects Chat alternatives that drift from their requirement ID while accepting compact semantic aliases", async () => {
  const invalid = draft();
  invalid.phases[0].chatAdvanceRequirements = [
    {
      id: "confirm_preference",
      phrases: ["confirm full refund", "refund amount $32.49", "original payment card"],
    },
    {
      id: "recap_refund",
      phrases: ["confirm full refund", "thank customer"],
    },
  ];

  const invalidResponse = await createValidateHandler()(request({ draft: invalid }));
  const invalidPayload = await invalidResponse.json();
  const mismatchPaths = invalidPayload.issues
    .filter((issue: { code: string }) => issue.code === "chat_advance_phrase_concept_mismatch")
    .map((issue: { path: string }) => issue.path);

  assert.equal(invalidResponse.status, 422);
  assert.deepEqual(mismatchPaths, [
    "draft.phases[0].chatAdvanceRequirements[0].phrases[1]",
    "draft.phases[0].chatAdvanceRequirements[0].phrases[2]",
    "draft.phases[0].chatAdvanceRequirements[1].phrases[0]",
    "draft.phases[0].chatAdvanceRequirements[1].phrases[1]",
  ]);

  const valid = draft();
  valid.phases[0].chatAdvanceRequirements = [
    {
      id: "acknowledge_inconvenience",
      phrases: ["acknowledge torn bag", "recognize inconvenience"],
    },
    {
      id: "refund_timeline",
      phrases: ["3-5 business days", "refund timeframe"],
    },
    {
      id: "refund_destination",
      phrases: ["original payment card", "original card"],
    },
    {
      id: "confirm_preference",
      phrases: ["full refund", "want a refund"],
    },
    {
      id: "custom_creator_signal",
      phrases: ["details checked", "verified information"],
    },
  ];

  const validResponse = await createValidateHandler()(request({ draft: valid }));
  const validPayload = await validResponse.json();

  assert.equal(validResponse.status, 200, JSON.stringify(validPayload.issues));
});

test("requires one composite boundary for overlapping resolution alternatives without merging distinct refund constraints", async () => {
  const overlapping = draft();
  overlapping.prohibitedActions = [
    "Do not offer store credit or a replacement.",
    "Do not present a replacement or exchange.",
    "Do not suggest options other than a full refund.",
  ];

  const overlappingResponse = await createValidateHandler()(request({ draft: overlapping }));
  const overlappingPayload = await overlappingResponse.json();

  assert.equal(overlappingResponse.status, 422);
  assert.equal(
    overlappingPayload.issues.some((issue: { code: string }) => issue.code === "overlapping_resolution_prohibitions"),
    true,
  );

  const distinct = draft();
  distinct.prohibitedActions = [
    "Do not offer a partial refund.",
    "Do not issue an incorrect refund amount.",
  ];
  distinct.objectives[0].criteria = [...distinct.prohibitedActions];
  distinct.phases[0].coachGuidance = [...distinct.prohibitedActions];

  const distinctResponse = await createValidateHandler()(request({ draft: distinct }));
  const distinctPayload = await distinctResponse.json();

  assert.equal(distinctResponse.status, 200, JSON.stringify(distinctPayload.issues));
});

test("groups provide-and-offer alternatives without treating credit cards as store credit", () => {
  assert.deepEqual(findOverlappingResolutionProhibitionGroups([
    "Do not provide store credit or a replacement.",
    "Do not offer a replacement or exchange.",
  ]), [[0, 1]]);
  assert.deepEqual(findOverlappingResolutionProhibitionGroups([
    "Do not mention the original credit card.",
    "Do not offer store credit.",
  ]), []);
});

test("matches Rise substring semantics for morphological Chat gate collisions", async () => {
  const invalid = draft();
  invalid.prohibitedActions = ["Do not issue a refund."];
  invalid.phases[0].chatAdvanceRequirements = [
    { id: "refund_request", phrases: ["refund", "money back"] },
    { id: "refund_completion", phrases: ["refunded", "reimbursed"] },
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();
  const refundedIssues = payload.issues.filter((issue: { path: string }) =>
    issue.path === "draft.phases[0].chatAdvanceRequirements[1].phrases[0]"
  );

  assert.equal(response.status, 422);
  assert.equal(
    refundedIssues.some((issue: { code: string }) => issue.code === "overlapping_chat_advance_phrase"),
    true,
  );
  assert.equal(
    refundedIssues.some((issue: { code: string }) => issue.code === "prohibited_chat_advance_phrase"),
    true,
  );
});

test("matches customer-role conflicts by delivery subject instead of the shared check verb", async () => {
  for (const followUp of [
    "What have you already checked for the package?",
    "Can you confirm which delivery spots you checked?",
  ]) {
    const invalid = draft();
    invalid.customer.conditionalFollowUps = [followUp];
    invalid.phases[0].learnerActions = ["Ask what the customer has already checked for the package."];

    const response = await createValidateHandler()(request({ draft: invalid }));
    const payload = await response.json();
    const roleIssues = payload.issues.filter((issue: { code: string }) => issue.code === "customer_role_conflict");

    assert.equal(response.status, 422, followUp);
    assert.deepEqual(roleIssues, [{
      code: "customer_role_conflict",
      path: "draft.customer.conditionalFollowUps[0]",
      message: "This follow-up assigns the Learner's discovery question to the Conversation Partner.",
      fix: "Rewrite it as the Conversation Partner's reaction or answer after the Learner asks the question.",
    }]);
  }

  for (const followUp of [
    "Have you checked whether the refund posted?",
    "Have you checked with your supervisor?",
  ]) {
    const valid = draft();
    valid.customer.conditionalFollowUps = [followUp];
    valid.phases[0].learnerActions = ["Ask what the customer has already checked for the package."];

    const response = await createValidateHandler()(request({ draft: valid }));
    const payload = await response.json();

    assert.equal(response.status, 200, `${followUp}: ${JSON.stringify(payload.issues)}`);
    assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "customer_role_conflict"), false);
  }
});

test("blocks a placeholder resolution that does not define an approved outcome", async () => {
  const invalid = draft();
  invalid.correctProcess = [
    "Acknowledge the concern.",
    "Explain the available next steps to locate the package or initiate resolution.",
  ];
  invalid.phases[0].learnerActions = [...invalid.correctProcess];
  invalid.objectives[0].criteria = [
    "Acknowledge the concern.",
    "Explain the available next steps to locate the package or initiate resolution.",
    "Avoid guaranteeing delivery.",
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.find((issue: { code: string }) => issue.code === "nondeterministic_resolution"),
    {
      code: "nondeterministic_resolution",
      path: "draft.correctProcess[1]",
      message: "The correct process does not define one approved outcome.",
      fix: "Replace general options or next steps with the exact authorized action and expected result.",
    },
  );
  assert.equal(payload.files, undefined);
});

test("blocks resolution alternatives and policy deferrals at one editable process item", async () => {
  for (const unresolvedStep of [
    "Issue an approved refund or send a replacement.",
    "Follow policy to determine the best resolution.",
    "Discuss the refund policy with the customer.",
  ]) {
    const invalid = draft();
    invalid.correctProcess = ["Acknowledge the concern.", unresolvedStep];

    const response = await createValidateHandler()(request({ draft: invalid }));
    const payload = await response.json();
    const resolutionIssues = payload.issues.filter((issue: { code: string }) => issue.code === "nondeterministic_resolution");

    assert.equal(response.status, 422, unresolvedStep);
    assert.deepEqual(resolutionIssues, [{
      code: "nondeterministic_resolution",
      path: "draft.correctProcess[1]",
      message: "The correct process does not define one approved outcome.",
      fix: "Replace general options or next steps with the exact authorized action and expected result.",
    }]);
  }
});

test("blocks action-shaped placeholders that still leave the result unresolved", async (t) => {
  for (const unresolvedStep of [
    "Submit a request.",
    "Provide the approved refund options.",
    "Create a replacement order if appropriate.",
    "Explain the appropriate next steps to the customer.",
    "Confirm the approved resolution with the customer.",
    "Submit the appropriate request for the customer.",
    "Create a detailed plan for the customer.",
  ]) {
    await t.test(unresolvedStep, async () => {
      const invalid = draft();
      invalid.correctProcess = ["Acknowledge the concern.", unresolvedStep];

      const response = await createValidateHandler()(request({ draft: invalid }));
      const payload = await response.json();

      assert.equal(response.status, 422);
      assert.deepEqual(
        payload.issues.find((issue: { code: string }) => issue.code === "nondeterministic_resolution"),
        {
          code: "nondeterministic_resolution",
          path: "draft.correctProcess[1]",
          message: "The correct process does not define one approved outcome.",
          fix: "Replace general options or next steps with the exact authorized action and expected result.",
        },
      );
    });
  }
});

test("requires a concrete outcome even when the process contains no known placeholder phrase", async () => {
  const invalid = draft();
  invalid.correctProcess = [
    "Acknowledge the concern.",
    "Help the customer with the order.",
  ];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(
    payload.issues.find((issue: { code: string }) => issue.code === "nondeterministic_resolution"),
    {
      code: "nondeterministic_resolution",
      path: "draft.correctProcess[1]",
      message: "The correct process does not define one approved outcome.",
      fix: "Replace general options or next steps with the exact authorized action and expected result.",
    },
  );
});

test("accepts an exact resolution even when process wording introduces it", async () => {
  for (const exactStep of [
    "Follow the approved process to issue a full refund.",
    "Initiate a resolution by issuing a full refund.",
  ]) {
    const valid = draft();
    valid.correctProcess = ["Acknowledge the concern.", exactStep];

    const response = await createValidateHandler()(request({ draft: valid }));
    const payload = await response.json();

    assert.equal(response.status, 200, `${exactStep}: ${JSON.stringify(payload.issues)}`);
    assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "nondeterministic_resolution"), false);
  }
});

test("blocks vague process or policy placeholders inside phase learner actions", async (t) => {
  for (const learnerAction of [
    "Explain the refund process as per correct process.",
    "Explain the refund timeline per approved policy.",
  ]) {
    await t.test(learnerAction, async () => {
      const invalid = draft();
      invalid.correctProcess = ["Issue a full refund to the original payment card and explain that it will post within 3–5 business days."];
      invalid.phases[0].learnerActions = [learnerAction];

      const response = await createValidateHandler()(request({ draft: invalid }));
      const payload = await response.json();

      assert.equal(response.status, 422);
      assert.deepEqual(
        payload.issues.find((issue: { code: string }) => issue.code === "vague_process_reference"),
        {
          code: "vague_process_reference",
          path: "draft.phases[0].learnerActions[0]",
          message: "The learner action refers to a process or policy without stating the approved action.",
          fix: "Replace the placeholder with the exact approved action, amount, destination, and timing that apply.",
        },
      );
    });
  }
});

test("blocks a vague process placeholder inside the top-level correct process", async () => {
  const invalid = draft();
  invalid.correctProcess = ["Explain the refund process as per correct process."];

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(
    payload.issues.some((issue: { code: string; path: string }) =>
      issue.code === "vague_process_reference" && issue.path === "draft.correctProcess[0]"),
    true,
  );
});

test("assesses the correct process as a whole instead of flagging setup steps", async () => {
  const valid = draft();
  valid.correctProcess = [
    "Acknowledge the concern.",
    "Follow the approved process.",
    "Issue a full refund.",
  ];

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "nondeterministic_resolution"), false);
});

test("accepts representative exact outcomes without depending on the outcome topic", async (t) => {
  for (const exactStep of [
    "Complete a warm transfer to the Tiger Team so the customer does not have to repeat the issue.",
    "Offer a 20% partial refund with the choice of original payment method or Chewy account, then process the customer's selected refund back to the original payment card and explain it will post within 3–5 business days.",
    "Confirm the package is still moving within the delivery window, share the tracking link, and explain that no refund or other compensation is approved while it remains on time.",
    "Create a behavior improvement plan that requires the learner to acknowledge the concern before asking discovery questions in every practice attempt.",
  ]) {
    await t.test(exactStep, async () => {
      const valid = draft();
      valid.correctProcess = ["Acknowledge the concern.", exactStep];

      const response = await createValidateHandler()(request({ draft: valid }));
      const payload = await response.json();

      assert.equal(response.status, 200, JSON.stringify(payload.issues));
      assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "nondeterministic_resolution"), false);
    });
  }
});

test("rejects passing scores outside the displayed 1-100 range", async () => {
  for (const passingScore of [0, 101]) {
    const invalid = draft();
    invalid.evaluation = { passingScore };

    const response = await createValidateHandler()(request({ draft: invalid }));
    const payload = await response.json();

    assert.equal(response.status, 422);
    assert.deepEqual(
      payload.issues.find((issue: { code: string }) => issue.code === "invalid_passing_score"),
      {
        code: "invalid_passing_score",
        path: "draft.evaluation.passingScore",
        message: "Passing score must be between 1 and 100.",
        fix: "Choose a passing score from 1 through 100.",
      },
    );
    assert.equal(payload.files, undefined);
  }
});

test("requires a Standard Text decision for chat files", async () => {
  const incomplete = draft();
  incomplete.chat.standardTextDecision = "unreviewed";

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "standard_text_decision_required"), true);
});

test("rejects invalid and duplicate objective IDs before factory validation", async () => {
  const incomplete = draft();
  incomplete.objectives.push({ ...incomplete.objectives[0], label: "Second objective" });
  incomplete.objectives[0].id = "Not Stable";
  incomplete.objectives[1].id = "Not Stable";

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "invalid_objective_id"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "duplicate_objective_id"), true);
});

test("rejects empty channels and malformed phase entries", async () => {
  const noChannels = draft();
  noChannels.channels = [];
  const noChannelResponse = await createValidateHandler()(request({ draft: noChannels }));
  assert.equal(noChannelResponse.status, 422);

  const malformed = { ...draft(), phases: [null] };
  const malformedResponse = await createValidateHandler()(request({ draft: malformed }));
  assert.equal(malformedResponse.status, 400);
});

test("rejects oversized validation bodies before buffering", async () => {
  const oversized = new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1500001" },
    body: "{}",
  });

  const response = await createValidateHandler()(oversized);

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "request_too_large");
});

test("requires current approval evidence for a full-conversation objective copy", async () => {
  const copy = draft();
  copy.objectiveApprovalRequired = true;
  const staleFingerprint = objectiveFingerprint(copy.objectives);
  copy.objectives[0].label = "Updated objective";

  const missing = await createValidateHandler()(request({
    draft: copy,
    objectiveApproval: { required: true, approved: false, fingerprint: "" },
  }));
  const stale = await createValidateHandler()(request({
    draft: copy,
    objectiveApproval: { required: true, approved: true, fingerprint: staleFingerprint },
  }));
  const current = await createValidateHandler()(request({
    draft: copy,
    objectiveApproval: { required: true, approved: true, fingerprint: objectiveFingerprint(copy.objectives) },
  }));
  const forgedNotRequired = await createValidateHandler()(request({
    draft: copy,
    objectiveApproval: { required: false, approved: false, fingerprint: "" },
  }));

  assert.equal(missing.status, 422);
  assert.equal(stale.status, 422);
  assert.equal(forgedNotRequired.status, 422);
  assert.equal(current.status, 200);
  assert.equal((await stale.json()).issues.some((issue: { code: string }) => issue.code === "objective_approval_stale"), true);
});

test("rejects invalid and duplicate phase IDs", async () => {
  const incomplete = draft();
  incomplete.phases.push({ ...incomplete.phases[0], title: "Second phase" });
  incomplete.phases[0].id = "Not Stable";
  incomplete.phases[1].id = "Not Stable";

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "invalid_phase_id"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "duplicate_phase_id"), true);
});

test("rejects malformed nested values and out-of-range voice settings", async () => {
  const malformed = draft() as StudioDraft & { customer: StudioDraft["customer"] & { facts: unknown[] } };
  malformed.customer.facts = [{ private: "value" }];
  const malformedResponse = await createValidateHandler()(request({ draft: malformed }));

  const invalidVoice = draft();
  invalidVoice.voice.selectedVoice = "not_a_voice";
  invalidVoice.voice.speed = 0.5;
  const invalidVoiceResponse = await createValidateHandler()(request({ draft: invalidVoice }));
  const payload = await invalidVoiceResponse.json();

  assert.equal(malformedResponse.status, 400);
  assert.equal(invalidVoiceResponse.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "invalid_voice"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "invalid_voice_speed"), true);
});

test("rejects passive or second-person objective criteria", async () => {
  const incomplete = draft();
  incomplete.objectives[0].criteria = ["The learner should explain the delivery window.", "You should avoid guarantees."];

  const response = await createValidateHandler()(request({ draft: incomplete }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "non_imperative_criterion"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "second_person_criterion"), true);
});

test("allows imperative criteria that contain you or your after the opening action", async () => {
  const valid = draft();
  valid.objectives[0].criteria = [
    "Use the Chewy-branded statement, Thank you for being the best part of Chewy.",
    "Explain why saying thank you alone does not complete the required step.",
    "Avoid guaranteeing delivery.",
  ];
  valid.phases[0].evaluationLinks = [{
    objectiveId: "set_clear_expectations",
    criterionIds: [
      "set_clear_expectations_criterion_1",
      "set_clear_expectations_criterion_2",
      "set_clear_expectations_criterion_3",
    ],
  }];

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload.issues));
});

test("allows exact imported fictional addresses but still blocks newly added private details", async () => {
  const imported = draft();
  imported.compatibilityFacts.address = "123 Main Street";
  imported.correctProcess.push("Confirm 123 Main Street before saving the change.");
  const sourceScenario = {
    ...JSON.parse(JSON.stringify((await (await createValidateHandler()(request({ draft: draft() }))).json()).files[0].scenario)),
    facts: { address: "123 Main Street" },
    simulation: {
      ...JSON.parse(JSON.stringify((await (await createValidateHandler()(request({ draft: draft() }))).json()).files[0].scenario.simulation)),
      sourceTranscriptMetadata: { sourceMaterial: "Confirm 123 Main Street before saving the change." },
    },
  };
  imported.sourceScenarios = { chat: sourceScenario };
  imported.sourceOverlay = true;

  const allowed = await createValidateHandler()(request({ draft: imported }));
  assert.equal(allowed.status, 200, JSON.stringify((await allowed.clone().json()).issues));

  imported.customer.openingLine = "Send the result to new.person@personalmail.com.";
  const blocked = await createValidateHandler()(request({ draft: imported }));
  const payload = await blocked.json();
  assert.equal(blocked.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "privacy_email_address"), true);
});

test("allows exact approved Standard Text library values but ignores unselected recommendations", async () => {
  const valid = draft();
  valid.channels = ["chat"];
  valid.agentType = "Rx";
  const recommendations = recommendStandardText({
    agentType: "Rx",
    title: "Mail a physical prescription",
    description: "Provide the pharmacy mailing address for a physical prescription.",
    learnerGoal: "Explain where to mail the prescription.",
    topic: "Prescription",
    subtopic: "Mailing address",
    correctProcess: ["Provide the pharmacy mailing address."],
  });
  const addressRecommendation = recommendations.find((item) => item.hotkey === "ad1");
  assert.ok(addressRecommendation);

  valid.chat.standardTextRecommendations = recommendations;
  valid.chat.standardTextDecision = "none";
  valid.chat.standardText = [{ ...addressRecommendation, template: "Unused draft: https://private.example.test/customer" }];
  const ignored = await createValidateHandler()(request({ draft: valid }));
  assert.equal(ignored.status, 200, JSON.stringify((await ignored.clone().json()).issues));

  valid.chat.standardTextDecision = "approved";
  valid.chat.standardText = [addressRecommendation];
  const selected = await createValidateHandler()(request({ draft: valid }));
  assert.equal(selected.status, 200, JSON.stringify((await selected.clone().json()).issues));
});

test("rejects completion delays outside the displayed 0 to 5000 millisecond range", async () => {
  const invalid = draft();
  invalid.channels = ["voice"];
  invalid.voice.experience = {
    ...createDefaultVoiceExperience(invalid.customer.tone),
    completion: { enabled: true, autoEnd: false, endDelayMs: 5001, endStatus: "Complete" },
  };

  const response = await createValidateHandler()(request({ draft: invalid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "invalid_completion_delay"), true);
});

test("blocks an opaque imported source from bypassing objective approval or privacy checks", async () => {
  const valid = draft();
  valid.channels = ["chat"];
  const initial = await createValidateHandler()(request({ draft: valid }));
  const sourceScenario = (await initial.json()).files[0].scenario;
  sourceScenario.coaching.gradingModel.objectives[0].label = "FORGED UNAPPROVED OBJECTIVE";
  sourceScenario.orderId = 123456789;
  sourceScenario["person@personalmail.com"] = "hidden in an object key";
  valid.sourceScenarios = { chat: sourceScenario };
  valid.sourceOverlay = false;

  const response = await createValidateHandler()(request({ draft: valid }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.files, undefined);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "source_review_required"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "privacy_service_identifier"), true);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "privacy_email_address"), true);
});

test("requires prohibited actions to keep negative polarity in objectives and guidance", async () => {
  const unsafe = draft();
  unsafe.objectives[0].criteria = ["State the expected delivery window.", "Guarantee delivery."];
  unsafe.phases[0].coachGuidance = ["Guarantee delivery."];

  const response = await createValidateHandler()(request({ draft: unsafe }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "unmapped_prohibited_action"), true);
});

test("requires every prohibited-action term in the same scored criterion and guide item", async () => {
  const unsafe = draft();
  unsafe.prohibitedActions = ["Do not issue a refund without consent."];
  unsafe.objectives[0].description = "Avoid issuing a refund without consent.";
  unsafe.objectives[0].criteria = ["Avoid issuing without consent.", "Explain the refund process."];
  unsafe.phases[0].coachGuidance = ["Avoid issuing without consent.", "Explain the refund process."];

  const response = await createValidateHandler()(request({ draft: unsafe }));
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.issues.some((issue: { code: string }) => issue.code === "unmapped_prohibited_action"), true);
});
