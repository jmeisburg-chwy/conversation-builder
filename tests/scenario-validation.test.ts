import assert from "node:assert/strict";
import test from "node:test";

import { createValidateHandler } from "../lib/scenario-validation";
import { createDefaultVoiceExperience, type StudioDraft } from "../lib/scenario-contract";
import { objectiveFingerprint } from "../lib/objective-approval";
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
      partnerResponse: "Yes, it is Milo's food order.",
      coachGuidance: ["Use the customer and pet names naturally.", "Avoid guaranteeing delivery."],
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
