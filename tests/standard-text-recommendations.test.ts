import assert from "node:assert/strict";
import test from "node:test";

import library from "../lib/hotkey-library.json" with { type: "json" };
import { recommendImportedStandardText, recommendStandardText } from "../lib/standard-text-recommendations";

test("recommends one to three exact approved Standard Text entries for chat review", () => {
  const recommendations = recommendStandardText({
    agentType: "Core",
    title: "Late dog food delivery",
    description: "Resolve a delayed delivery and explain tracking expectations.",
    learnerGoal: "Set accurate delivery expectations without guarantees.",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    correctProcess: ["Explain the expected delivery window and next step."],
  });

  assert.equal(recommendations.length >= 1 && recommendations.length <= 3, true);
  for (const recommendation of recommendations) {
    const source = library.records.find((record) => record.hotkey === recommendation.hotkey && record.agent_role === "core");
    assert.ok(source);
    assert.equal(recommendation.template, source.canned_text);
    assert.match(recommendation.recommendationReason || "", /Matches/);
  }
});

test("does not recommend unrelated records from one generic token", () => {
  const recommendations = recommendStandardText({
    agentType: "Core",
    title: "Missing food refund",
    description: "A customer needs a refund for missing food.",
    learnerGoal: "Resolve the missing-food refund.",
    topic: "Refund",
    subtopic: "Missing food",
    correctProcess: ["Process the approved refund."],
  });

  assert.deepEqual(recommendations, []);
});

test("excludes specialized or action-changing templates from a late-delivery recommendation", () => {
  const recommendations = recommendStandardText({
    agentType: "Core",
    title: "Late delivery",
    description: "A dog food order is expected tomorrow.",
    learnerGoal: "Explain expected timing without a guarantee.",
    topic: "Delivery / Tracking",
    subtopic: "Late delivery",
    correctProcess: ["Explain the expected delivery date."],
  });

  assert.equal(recommendations.length > 0, true);
  assert.equal(recommendations.some((item) => /Dropshipped|Fresh\/Frozen|Refund\/Replacement/i.test(item.category)), false);
  assert.equal(recommendations.some((item) => /replacement order|prescription medication/i.test(item.template)), false);
});

test("recommends only the uploaded hotkey for imports and refreshes it from the current library", () => {
  const source = library.records.find((record) => record.agent_role === "core" && record.hotkey === "de3");
  assert.ok(source);
  const recommendations = recommendImportedStandardText([{
    hotkey: "de3",
    category: "Shipping",
    template: "Older approved DE3 wording.",
    insertionMoment: "After confirming the approved partial refund.",
    customization: "Customize the amount.",
    notes: [],
    approvedGuidance: "",
  }], "core");

  assert.deepEqual(recommendations.map((item) => item.hotkey), ["de3"]);
  assert.equal(recommendations[0].template, source.canned_text);
  assert.match(recommendations[0].recommendationReason || "", /uploaded scenario/);
});
