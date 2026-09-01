import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as builderApp from "../public/builder-studio/app.js";

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
  addChatAdvanceRequirement,
  actionableBlockingIssues,
  createBlankPhase,
  duplicatePhase,
  editChatAdvanceRequirementPhrases,
  reviewFindingTargets,
  runCreateDraftBuild,
  finalCheckDisplayState,
  saveDraft,
  stepPassingScore,
  standalonePublishChecks,
  updatePhaseStrongLearnerResponse,
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
  assert.match(html, /exact approved actions and outcome/i);
  assert.match(script, /exact approved actions and outcome/i);
  assert.match(script, /Final Conversation Partner response/);
  assert.match(script, /closing-partner-turn:/);
  assert.doesNotMatch(html, /id="deidentificationConfirmed"/);
  assert.doesNotMatch(html, /I confirm these conversation details are fictional or de-identified\./i);
});

test("distinguishes downloadable warnings from Scenario Factory readiness", () => {
  assert.deepEqual(
    finalCheckDisplayState({ issues: [], files: [{ channel: "chat" }] }),
    {
      headline: "Scenario Factory–ready",
      description: "Chat is ready to test with 0 failures and 0 warnings.",
    },
  );
  assert.deepEqual(
    finalCheckDisplayState({
      issues: [{ severity: "WARN", code: "manual_review", message: "Review this item." }],
      files: [{ channel: "chat" }],
    }),
    {
      headline: "Downloadable — needs review",
      description: "You can download this JSON, but it is not Scenario Factory–ready until the warnings are fixed.",
    },
  );
});
test("keeps internal Chat matching controls out of Review/Edit", () => {
  const script = readFileSync(new URL("public/builder-studio/app.js", root), "utf8");

  assert.doesNotMatch(script, /label: "Chat advance requirements"/);
  assert.doesNotMatch(script, /Add required concept/);
  assert.doesNotMatch(script, /Every required concept must match before Chat advances\./);
});

test("creates a draft without asking the author for a de-identification confirmation", async () => {
  let requestCount = 0;
  const statuses: string[] = [];
  const createDraftButton = { disabled: false, textContent: "Create draft" };
  const inputs = {
    conversationAboutInput: { value: "A fictional late-order conversation.", focus() {} },
    learnerApproachInput: { value: "Acknowledge the concern and explain the approved next step.", focus() {} },
  };

  const created = await runCreateDraftBuild({
    ...inputs,
    createDraftButton,
    reportStatus: (message: string) => statuses.push(message),
    requestDraft: async () => {
      requestCount += 1;
      return { scenario: { title: "Generated" } };
    },
  });

  assert.equal(created.status, "created");
  assert.equal(requestCount, 1);
  assert.deepEqual(statuses, []);
});

test("starts at a blank Build screen unless the URL explicitly requests a saved draft", () => {
  const shouldRestoreStandaloneDraftOnLaunch = (builderApp as unknown as {
    shouldRestoreStandaloneDraftOnLaunch?: (search: string) => boolean;
  }).shouldRestoreStandaloneDraftOnLaunch;

  assert.equal(typeof shouldRestoreStandaloneDraftOnLaunch, "function");
  assert.equal(shouldRestoreStandaloneDraftOnLaunch!(""), false);
  assert.equal(shouldRestoreStandaloneDraftOnLaunch!("?standalone=1"), false);
  assert.equal(shouldRestoreStandaloneDraftOnLaunch!("?standalone=1&resume=1"), true);
});

test("uses 100 as the missing-score baseline in Review/Edit", () => {
  assert.equal(stepPassingScore("", 1), 100);
  assert.equal(stepPassingScore("", -1), 99);
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

test("reports browser storage failures without blocking quiet autosave callers", async () => {
  const failures = [
    {
      name: "QuotaExceededError",
      getStorage: () => ({
        setItem() {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        },
      }),
    },
    {
      name: "SecurityError",
      getStorage: () => {
        throw new DOMException("Storage access denied", "SecurityError");
      },
    },
  ];

  for (const failure of failures) {
    const warnings: string[] = [];
    const toasts: string[] = [];
    const draftState = {
      draft: {},
      draftId: "",
      currentDraftActive: true,
      currentDraftUpdatedAt: "",
      savedDraft: null,
    };

    let callerContinued = false;
    const result = await saveDraft({
      quiet: true,
      draftState,
      getStorage: failure.getStorage,
      reportStatus: (message: string) => warnings.push(message),
      notify: (message: string) => toasts.push(message),
    });
    callerContinued = true;

    assert.equal(result.saved, false, failure.name);
    assert.equal(result.error?.name, failure.name);
    assert.equal(callerContinued, true);
    assert.deepEqual(warnings, [
      "Draft could not be saved in this browser. Validation and JSON download can continue, but download your JSON before leaving.",
    ]);
    assert.deepEqual(toasts, warnings);
  }
});

test("treats blocked browser storage as an empty bootstrap instead of throwing", () => {
  const loadSavedDraftSafely = (builderApp as unknown as {
    loadSavedDraftSafely?: (options: { getStorage: () => Storage }) => unknown;
  }).loadSavedDraftSafely;
  assert.equal(typeof loadSavedDraftSafely, "function");

  const result = loadSavedDraftSafely!({
    getStorage() {
      throw new DOMException("Storage access denied", "SecurityError");
    },
  });

  assert.equal(result, null);
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
  assert.equal(action.message, "Observable criteria must begin with an imperative action.");
});

test("keeps Continue to Download available when validation has advisory findings", () => {
  const button = { disabled: true };

  builderApp.configureReviewTestAffordance(button, {
    available: true,
    validationAttempted: true,
  });

  assert.equal(button.disabled, false);
});

test("describes failed validation as blocking download", () => {
  assert.deepEqual(builderApp.finalCheckDisplayState({
    issues: [{ severity: "FAIL", code: "future_check", message: "Review this detail." }],
  }), {
    headline: "Changes needed",
    description: "Fix the items below, then validate again.",
  });
});

test("withholds generated JSON files when validation has failures", () => {
  const files = builderApp.portableValidatedScenarioFiles({
    validation: {
      ok: false,
      issues: [{ severity: "FAIL", code: "future_check", message: "Review this detail." }],
      files: [{
        filename: "advisory_chat.json",
        scenario: { id: "advisory_chat", channels: ["chat"], title: "Advisory draft" },
      }],
    },
  });

  assert.equal(files.length, 0);
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

test("clears stale Chat advance requirements when the strong response changes", () => {
  const phase = {
    id: "resolve_delay",
    title: "Resolve the delay",
    partnerTurn: "My order is late. Can you help?",
    strongLearnerResponse: "Acknowledge the concern.",
    chatAdvanceRequirements: [
      { id: "acknowledgement", phrases: ["sorry", "understand the concern"] },
    ],
    coachGuidance: { title: "Resolve the delay", bullets: [] },
    evaluationLinks: [],
  };

  assert.deepEqual(
    updatePhaseStrongLearnerResponse(phase, "Acknowledge the concern."),
    phase,
  );
  assert.deepEqual(
    updatePhaseStrongLearnerResponse(phase, "Confirm the expected delivery date."),
    {
      ...phase,
      strongLearnerResponse: "Confirm the expected delivery date.",
      chatAdvanceRequirements: [],
    },
  );
  assert.equal(phase.chatAdvanceRequirements.length, 1);
});

test("lets authors complete blank Chat gates and duplicates groups with independent IDs", () => {
  const blank = createBlankPhase(2, { createId: (prefix: string) => `${prefix}_new` });
  assert.deepEqual(blank.chatAdvanceRequirements, []);

  const withGroup = addChatAdvanceRequirement(blank, {
    createId: () => "required_resolution",
  });
  const completed = editChatAdvanceRequirementPhrases(
    withGroup,
    "required_resolution",
    "Expected tomorrow\n delivery window \nEXPECTED TOMORROW",
  );
  assert.deepEqual(completed.chatAdvanceRequirements, [{
    id: "required_resolution",
    phrases: ["expected tomorrow", "delivery window"],
  }]);

  let nextId = 0;
  const phases = duplicatePhase([completed], 0, {
    createId: (prefix: string) => `${prefix}_${++nextId}`,
  });
  assert.equal(phases.length, 2);
  assert.notEqual(
    phases[0].chatAdvanceRequirements[0].id,
    phases[1].chatAdvanceRequirements[0].id,
  );
  assert.deepEqual(
    phases[1].chatAdvanceRequirements[0].phrases,
    ["expected tomorrow", "delivery window"],
  );
});

test("routes Chat gate findings to the matching phrase editor or visible add control", () => {
  const draft = {
    flow: {
      phases: [{
        id: "resolve_delay",
        chatAdvanceRequirements: [{
          id: "delivery_window",
          phrases: ["expected tomorrow", "delivery window"],
        }],
        coachGuidance: { bullets: [] },
        evaluationLinks: [],
      }],
    },
    evaluation: { objectives: [] },
  };
  const [phraseTarget] = reviewFindingTargets(draft, [{
    id: "specific-phrase",
    fieldPath: "flow.phases.0.chatAdvanceRequirements.0.phrases.0",
  }]);
  assert.equal(
    phraseTarget.focusKey,
    "chat-requirement-phrases:resolve_delay:delivery_window",
  );

  const [missingAction] = actionableBlockingIssues({
    issues: [{
      severity: "FAIL",
      code: "chat_advance_requirements_required",
      path: "draft.phases[0].chatAdvanceRequirements",
      message: "Each Chat phase needs explicit positive evidence before it can advance.",
    }],
  }, {
    draft: {
      ...draft,
      flow: {
        phases: [{
          ...draft.flow.phases[0],
          chatAdvanceRequirements: [],
        }],
      },
    },
  });
  assert.equal(
    missingAction.reviewFieldPath,
    "flow.phases.0.chatAdvanceRequirements",
  );
  assert.equal(missingAction.message, "Add the required Chat phrases for Phase 1.");
  assert.deepEqual(missingAction.reviewTarget, {
    phaseId: "resolve_delay",
    focusKey: "add-chat-requirement:resolve_delay",
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
      chatAdvanceRequirements: [
        {
          id: "acknowledgement",
          phrases: ["sorry the order is late", "understand the frustrating delay"],
        },
        {
          id: "delivery_window",
          phrases: ["expected tomorrow", "tomorrow by end of day"],
        },
      ],
      partnerResponse: "That answers my question. Thank you.",
      coachGuidance: ["Use expected timing language and the approved delivery date."],
      evaluationLinks: [{ objectiveId: "set_clear_expectations", criterionIds: ["set_clear_expectations_criterion_1"] }],
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

  assert.equal(response.status, 200, JSON.stringify(payload));
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
  restored!.draft.flow.phases[0] = updatePhaseStrongLearnerResponse(
    restored!.draft.flow.phases[0],
    "Acknowledge the concern and state the expected delivery window.",
  );
  saveStandaloneDraft(storage, restored!.draft);
  const stale = loadStandaloneDraft(storage);
  assert.deepEqual(stale?.draft.flow.phases[0].chatAdvanceRequirements, []);

  const staleRoundTrip = authoringToStandaloneDraft(stale?.draft);
  const staleResponse = await createValidateHandler()(new Request("http://localhost/api/builder/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draft: staleRoundTrip,
      deidentificationConfirmed: true,
      objectiveApproval: {
        required: true,
        approved: true,
        fingerprint: objectiveFingerprint(staleRoundTrip.objectives),
      },
    }),
  }));
  const stalePayload = await staleResponse.json();
  assert.equal(staleResponse.status, 422);
  assert.equal(
    stalePayload.issues.some((issue: { code: string }) =>
      issue.code === "chat_advance_requirements_required"
    ),
    true,
  );

  let revisedPhase = addChatAdvanceRequirement(stale!.draft.flow.phases[0], {
    createId: () => "acknowledgement",
  });
  revisedPhase = editChatAdvanceRequirementPhrases(
    revisedPhase,
    "acknowledgement",
    "sorry the order is late\nunderstand the frustrating delay",
  );
  revisedPhase = addChatAdvanceRequirement(revisedPhase, {
    createId: () => "delivery_window",
  });
  revisedPhase = editChatAdvanceRequirementPhrases(
    revisedPhase,
    "delivery_window",
    "expected tomorrow\ntomorrow by end of day",
  );
  stale!.draft.flow.phases[0] = revisedPhase;
  saveStandaloneDraft(storage, stale!.draft);
  const revised = loadStandaloneDraft(storage);
  assert.deepEqual(
    revised?.draft.flow.phases[0].chatAdvanceRequirements,
    revisedPhase.chatAdvanceRequirements,
  );
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
  assert.equal(revisedMatch.all.every((condition: { op: string }) => condition.op === "contains_any"), true);
  assert.equal(revisedMatch.all.every((condition: { phrases: string[] }) => condition.phrases.length > 0), true);
  assert.deepEqual(revisedMatch.any, []);
});
