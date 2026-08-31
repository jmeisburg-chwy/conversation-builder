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

const root = new URL("../", import.meta.url);

test("ports the original complete Review/Edit surface into the standalone Builder", () => {
  const html = readFileSync(new URL("public/builder-studio/index.html", root), "utf8");

  assert.match(html, /id="reviewConversationSetup"/);
  assert.match(html, /id="setupObjectiveList"/);
  assert.match(html, /id="reviewConversationFlow"/);
  assert.match(html, /id="phaseList"/);
  assert.match(html, /id="reviewPractice"/);
  assert.match(html, /id="hotkeyLibrary"/);
  assert.match(html, /id="reviewFinalCheck"/);
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
});
