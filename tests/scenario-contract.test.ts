import assert from "node:assert/strict";
import test from "node:test";

import {
  composeScenarioFiles,
  importScenarioJson,
  validateScenarioFiles,
  type StudioDraft,
} from "../lib/scenario-contract";

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
        partnerResponse: "Yes, it's Milo's food order.",
        coachGuidance: ["Use Jordan's and Milo's names naturally."],
      },
      {
        id: "set_expectations",
        title: "Set expectations",
        learnerActions: ["Explain that the order is expected tomorrow by end of day without guaranteeing it."],
        partnerResponse: "Okay, I can wait until tomorrow.",
        coachGuidance: ["Use expected rather than guaranteed timing."],
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
      "Approved customer fact: The order is expected tomorrow by end of day.",
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

test("rejects structured guide bullets instead of stringifying them", () => {
  const [file] = composeScenarioFiles({ ...focusedDraft(), channels: ["voice"] });
  const sections = file.scenario.frontend.voice?.guideSections as Array<Record<string, unknown>>;
  sections[0].bullets = [{ text: "Parent guidance", children: ["Nested detail"] }];

  assert.throws(
    () => importScenarioJson(JSON.stringify(file.scenario), "improve"),
    /structured bullets.*cannot safely edit/i,
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

  assert.equal(file.scenario.evaluationCriteria.includes(""), false);
  assert.equal((file.scenario.chatConfig?.stepProgression[0].match as string[]).includes(""), false);
  assert.equal(JSON.stringify(file.scenario.frontend.chat).includes('"bullets":["'), true);
  assert.doesNotMatch(JSON.stringify(file.scenario), /""\s*,\s*""/);
});
