import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultStudioDraft,
  createStudioDraftFromGeneration,
  normalizeStudioDraft,
} from "../public/builder-studio/src/scenarioStudio.js";

test("defaults a new Review/Edit draft passing score to 100", () => {
  const draft = createDefaultStudioDraft({
    material: "A fictional customer needs help with a delayed dog food order.",
  });

  assert.equal(draft.evaluation.passingScore, 100);
});

test("defaults a normalized Review/Edit draft with no passing score to 100", () => {
  const draft = normalizeStudioDraft({
    source: {
      material: "A fictional customer needs help with a delayed dog food order.",
    },
    evaluation: {
      objectives: [],
    },
  });

  assert.equal(draft.evaluation.passingScore, 100);
});

test("defaults a generated Review/Edit draft passing score to 100", () => {
  const draft = createStudioDraftFromGeneration({
    conversation: {
      title: "Delayed Dog Food Order",
      description: "Practice resolving a delayed dog food order.",
      teamAudience: "Customer Care",
      topic: "Delivery / Tracking",
      subtopic: "Late delivery",
    },
    partner: {
      name: "Jordan",
      role: "Customer",
      mood: "Concerned",
      openingLine: "My dog food order is late. Can you help?",
      closingLine: "Thank you for explaining.",
      behaviorRules: [],
    },
    phases: [{
      id: "set_expectations",
      title: "Set expectations",
      partnerTurn: "My dog food order is late. Can you help?",
      strongLearnerResponse: "Explain the expected delivery date.",
      guidance: [{ id: "expected_date", text: "Use the approved expected date." }],
      evaluationLinks: [],
    }],
    objectives: [{
      id: "set_expectations",
      label: "Set expectations",
      description: "Explain the expected delivery date.",
      criteria: [{ id: "expected_date", text: "Explain the expected delivery date." }],
    }],
  }, {
    conversationAbout: "A fictional customer needs help with a delayed dog food order.",
    learnerApproach: "Explain the expected delivery date without guaranteeing it.",
  }, {
    familySuffix: "deadbeef",
  });

  assert.equal(draft.evaluation.passingScore, 100);
});
