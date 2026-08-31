import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { objectiveFingerprint } from "../lib/objective-approval";
import { createValidateHandler } from "../lib/scenario-validation";
import type { StudioDraft } from "../lib/scenario-contract";
import {
  authoringToStandaloneDraft,
  loadStandaloneDraft,
  saveStandaloneDraft,
  standaloneToAuthoringDraft,
} from "../public/builder-studio/src/standaloneAdapter.js";
import {
  actionableBlockingIssues,
  standalonePublishChecks,
} from "../public/builder-studio/app.js";

const root = new URL("../", import.meta.url);

test("ports the original complete Review/Edit surface into the standalone Builder", () => {
  const html = readFileSync(new URL("public/builder-studio/index.html", root), "utf8");
  const script = readFileSync(new URL("public/builder-studio/app.js", root), "utf8");

  assert.match(html, /id="reviewConversationSetup"/);
  assert.match(html, /id="setupObjectiveList"/);
  assert.match(html, /id="reviewConversationFlow"/);
  assert.match(html, /id="phaseList"/);
  assert.match(html, /id="reviewPractice"/);
  assert.match(html, /id="hotkeyLibrary"/);
  assert.match(html, /id="reviewFinalCheck"/);
  assert.match(html, /Now describe what the Learner should accomplish, how they should approach it, and anything they should avoid\./);
  assert.match(script, /Now describe what the Learner should accomplish, how they should approach it, and anything they should avoid\./);
  assert.match(script, /Final Conversation Partner response/);
  assert.match(script, /closing-partner-turn:/);
  assert.doesNotMatch(html, /id="deidentificationConfirmed"|By creating a draft, you confirm/i);
});

test("adapts the original final stage to local save and download without Test or Publish", () => {
  const html = readFileSync(new URL("public/builder-studio/index.html", root), "utf8");

  assert.match(html, /Step 3[\s\S]*Download/);
  assert.match(html, /Save Draft/);
  assert.match(html, /Download JSON/);
  assert.doesNotMatch(html, />Test</);
  assert.doesNotMatch(html, /simulatorPreviewFrame/);
  assert.doesNotMatch(html, /Publish conversation/);
  assert.doesNotMatch(html, /Conversation Library/);
});

test("bridges the original UI to standalone persistence and the existing backend", () => {
  const script = readFileSync(new URL("public/builder-studio/app.js", root), "utf8");
  const adapter = readFileSync(new URL("public/builder-studio/src/standaloneAdapter.js", root), "utf8");

  assert.match(adapter, /conversation-builder\.standalone-draft\.v1/);
  assert.match(script, /\/api\/builder\/generate/);
  assert.match(script, /\/api\/builder\/validate/);
  assert.match(script, /localStorage/);
  assert.doesNotMatch(script, /agentType:\s*"Core"/);
});

test("keeps standalone bootstrap safe after removing the simulator preview", () => {
  const script = readFileSync(new URL("public/builder-studio/app.js", root), "utf8");

  assert.match(
    script,
    /function updatePreviewButtonLabel\(options = \{\}\) \{\s+if \(!elements\.playPreviewButton\) return;/,
  );
});

test("maps standalone validation paths back to the original Review/Edit controls", () => {
  const [action] = actionableBlockingIssues({
    issues: [{
      severity: "FAIL",
      code: "non_imperative_criterion",
      fieldPath: "draft.objectives[1].criteria[2]",
      message: "Observable criteria must begin with an imperative action.",
    }],
  });

  assert.equal(action.reviewFieldPath, "evaluation.objectives.1.criteria.2.text");
  assert.equal(action.actionLabel, "Review objectives");
  assert.equal(action.message, "Add at least one evaluation criterion.");
});

test("routes five-blocker corrections to the earned turn and preserves their actionable fix", () => {
  const [repeatedTurn, resolution] = actionableBlockingIssues({
    issues: [
      {
        severity: "FAIL",
        code: "repeated_customer_opening",
        path: "draft.phases[0].partnerResponse",
        message: "The first Conversation Partner response repeats the opening line.",
        fix: "Write what the Conversation Partner says after the Learner completes Phase 1.",
      },
      {
        severity: "FAIL",
        code: "nondeterministic_resolution",
        path: "draft.correctProcess[1]",
        message: "The correct process does not define one approved outcome.",
        fix: "Replace general options or next steps with the exact authorized action and expected result.",
      },
    ],
  });

  assert.equal(repeatedTurn.reviewFieldPath, "flow.phases.1.partnerTurn");
  assert.equal(repeatedTurn.actionLabel, "Edit phase 2");
  assert.equal(repeatedTurn.message, "Write what the Conversation Partner says after the Learner completes Phase 1.");
  assert.equal(resolution.reviewFieldPath, "flow.phases.1.strongLearnerResponse");
  assert.equal(resolution.actionLabel, "Edit phase 2");
  assert.equal(resolution.message, "Replace general options or next steps with the exact authorized action and expected result.");
});

test("routes a one-phase repeated opening to an editable closing response", () => {
  const [action] = actionableBlockingIssues({
    issues: [{
      severity: "FAIL",
      code: "repeated_customer_opening",
      path: "draft.phases[0].partnerResponse",
      message: "The first Conversation Partner response repeats the opening line.",
      fix: "Write what the Conversation Partner says after the Learner completes Phase 1.",
    }],
  }, {
    draft: {
      flow: {
        phases: [{ id: "resolve_delay" }],
        closingPartnerTurn: "My order is late. Can you help?",
      },
      evaluation: { objectives: [] },
    },
  });

  assert.equal(action.reviewFieldPath, "flow.closingPartnerTurn");
  assert.equal(action.actionLabel, "Edit final response");
  assert.deepEqual(action.reviewTarget, {
    phaseId: "resolve_delay",
    focusKey: "closing-partner-turn:resolve_delay",
  });
});

test("marks Personal information as needing attention for standalone privacy issues", () => {
  assert.deepEqual(standalonePublishChecks({
    fail: 1,
    issues: [{ code: "privacy_street_address" }],
  }), {
    authoritative: "attention",
    privacy: "attention",
  });
  assert.deepEqual(standalonePublishChecks({
    fail: 1,
    issues: [{ code: "required_value" }],
  }), {
    authoritative: "attention",
    privacy: "passed",
  });
});

test("persists an original Review/Edit draft and validates simulator-ready downloads after an edit", async () => {
  const generated: StudioDraft = {
    baseId: "late_order_recovery",
    title: "Late Order Recovery",
    description: "Practice resolving a delayed order without overpromising.",
    learnerGoal: "Acknowledge the concern, explain the approved resolution, and recap the next step.",
    channels: ["chat", "voice"],
    agentType: "Core",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    teamAudience: "Customer Care",
    customer: {
      name: "Jordan",
      petName: "Milo",
      tone: "Concerned but cooperative",
      goal: "Understand when Milo's food will arrive.",
      openingLine: "Milo's food should have arrived yesterday. Can you help?",
      facts: ["The order is expected tomorrow by end of day."],
      revealOnlyWhenAsked: ["Milo has food for two more days."],
      objections: ["Can you guarantee it will arrive tomorrow?"],
      behaviorRules: ["Remain the customer throughout the conversation."],
      conditionalFollowUps: ["After the delivery date is explained, ask what happens next."],
      closingLine: "That answers my question. Thank you.",
    },
    correctProcess: ["Acknowledge the concern.", "Explain the expected delivery window."],
    prohibitedActions: [],
    phases: [{
      id: "resolve_delay",
      title: "Resolve the delay",
      learnerActions: ["Acknowledge the concern and explain the expected delivery window."],
      partnerResponse: "That answers my question. Thank you.",
      coachGuidance: ["Use expected rather than guaranteed timing."],
    }],
    objectives: [{
      id: "set_clear_expectations",
      label: "Set clear expectations",
      description: "Explain the delivery status accurately.",
      criteria: ["State the expected delivery window."],
    }],
    objectiveApprovalRequired: false,
    compatibilityFacts: {
      address: "",
      medication: "",
      urgency: "Milo has food for two more days.",
      medicationOrProduct: "Dog food",
      clinic: "",
    },
    chat: { hotkeyProfile: "core", standardText: [], standardTextDecision: "none" },
    voice: { selectedVoice: "marin", speed: 1 },
  };
  const authoring = standaloneToAuthoringDraft(generated, {
    conversationAbout: generated.description,
    learnerApproach: generated.learnerGoal,
  });
  authoring.scenario.title = "Late Order Recovery — Revised";

  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  saveStandaloneDraft(storage, authoring);
  const restored = loadStandaloneDraft(storage);
  assert.equal(restored?.draft.scenario.title, "Late Order Recovery — Revised");

  const roundTrip = authoringToStandaloneDraft(restored?.draft);
  const response = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: roundTrip,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(roundTrip.objectives),
      },
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.files.map((file: { filename: string }) => file.filename), [
    "late_order_recovery_chat.json",
    "late_order_recovery_voice.json",
  ]);
  assert.deepEqual(payload.files.map((file: { scenario: { channels: string[] } }) => file.scenario.channels), [
    ["chat"],
    ["voice"],
  ]);
  assert.equal(payload.files[0].scenario.coaching.gradingModel.mode, "focused_learning_objectives");

  const firstChatJson = JSON.stringify(payload.files[0].scenario);
  restored!.draft.flow.phases[0].strongLearnerResponse =
    "Acknowledge the concern and state the expected delivery window.";
  saveStandaloneDraft(storage, restored!.draft);
  const revised = loadStandaloneDraft(storage);
  const revisedRoundTrip = authoringToStandaloneDraft(revised?.draft);
  const revisedResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: revisedRoundTrip,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(revisedRoundTrip.objectives),
      },
    }),
  }));
  const revisedPayload = await revisedResponse.json();
  const revisedMatch = revisedPayload.files[0].scenario.chatConfig.stepProgression[0].match;

  assert.equal(revisedResponse.status, 200);
  assert.notEqual(JSON.stringify(revisedPayload.files[0].scenario), firstChatJson);
  assert.equal(Array.isArray(revisedMatch), false);
  assert.equal(revisedMatch.any[0].op, "contains_any");
  assert.equal(revisedMatch.any[0].phrases.length > 0, true);
});
