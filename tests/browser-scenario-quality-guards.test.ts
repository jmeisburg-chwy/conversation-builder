import assert from "node:assert/strict";
import test from "node:test";

import {
  customerBehaviorRuleConflictsWithLearner,
  customerBehaviorRuleHasNegativeLearnerPolarity,
  customerBehaviorRuleIsNegativeGuardrail,
  customerBehaviorRuleToNegativeGuardrail,
  customerFollowUpConflictsWithLearner,
} from "../public/builder-studio/src/scenarioQualityGuards.js";

const deliveryDiscovery = ["Ask what the customer has already checked for the package."];

test("detects instruction-form customer follow-ups that invert the Learner's delivery discovery", () => {
  for (const followUp of [
    "Ask the learner which delivery spots the customer checked.",
    "After acknowledging the concern, ask which delivery spots the customer checked.",
  ]) {
    assert.equal(customerFollowUpConflictsWithLearner(followUp, deliveryDiscovery), true, followUp);
  }
});

test("distinguishes customer disclosures from Chewy-agent actions", () => {
  assert.equal(customerBehaviorRuleConflictsWithLearner("Issue a full refund to the original payment card."), true);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Do not offer store credit."), true);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Explain the refund timeline to the customer."), true);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Explain the refund timeline to customer."), true);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Inform the customer that the refund will post in 3–5 business days."), true);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Provide the order date only if the learner asks."), false);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Offer a brief answer, then wait for the learner."), false);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Complete discovery across three separate replies, then wait."), false);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Update your tone from frustrated to relieved after the learner resolves the issue."), false);
  assert.equal(customerBehaviorRuleConflictsWithLearner("Escalate frustration if the learner repeats an unsupported promise."), false);
});

test("recognizes subject-led learner prohibitions as guardrails", () => {
  for (const rule of [
    "The learner must not offer store credit.",
    "The agent should not offer a replacement.",
    "A Chewy representative must never guarantee the refund timeline.",
    "The agent should avoid offering store credit.",
    "The learner must avoid guaranteeing delivery.",
  ]) {
    assert.equal(customerBehaviorRuleConflictsWithLearner(rule), true, rule);
    assert.equal(customerBehaviorRuleIsNegativeGuardrail(rule), true, rule);
  }
});

test("normalizes migrated learner prohibitions without changing their meaning", () => {
  assert.equal(
    customerBehaviorRuleToNegativeGuardrail("The learner must not offer store credit."),
    "Do not offer store credit.",
  );
  assert.equal(
    customerBehaviorRuleToNegativeGuardrail("Avoid offering a replacement."),
    "Avoid offering a replacement.",
  );
  assert.equal(
    customerBehaviorRuleToNegativeGuardrail("The agent should avoid offering store credit."),
    "Avoid offering store credit.",
  );
  assert.equal(
    customerBehaviorRuleToNegativeGuardrail("The learner must avoid guaranteeing delivery."),
    "Avoid guaranteeing delivery.",
  );
  assert.equal(customerBehaviorRuleToNegativeGuardrail("Never offer store credit."), "Do not offer store credit.");
  assert.equal(customerBehaviorRuleToNegativeGuardrail("Remain disappointed until the refund is confirmed."), "");
});

test("normalizes contracted and modal learner prohibitions without losing the guardrail", () => {
  const cases = [
    ["The agent can't offer store credit.", "Do not offer store credit."],
    ["The learner may not offer a replacement.", "Do not offer a replacement."],
    ["The representative could not guarantee the timeline.", "Do not guarantee the timeline."],
  ];

  for (const [rule, expected] of cases) {
    assert.equal(customerBehaviorRuleConflictsWithLearner(rule), true, rule);
    assert.equal(customerBehaviorRuleIsNegativeGuardrail(rule), true, rule);
    assert.equal(customerBehaviorRuleToNegativeGuardrail(rule), expected, rule);
  }
});

test("recognizes any learner-subject n't contraction so unmigrated guardrails fail closed", () => {
  for (const rule of [
    "The learner isn't allowed to offer store credit.",
    "The agent isn’t permitted to guarantee delivery.",
    "The agent aren't supposed to guarantee delivery.",
    "The representative wasn't permitted to offer a replacement.",
    "The learner weren't authorized to issue store credit.",
    "The agent needn't offer a discount.",
  ]) {
    assert.equal(customerBehaviorRuleConflictsWithLearner(rule), true, rule);
    assert.equal(customerBehaviorRuleHasNegativeLearnerPolarity(rule), true, rule);
  }
});

test("preserves customer reactions and questions with a different purpose", () => {
  for (const followUp of [
    "After the learner asks which delivery spots the customer checked, say they checked the porch.",
    "After the delivery window is explained, ask what happens next if it is late.",
    "Tell the learner the customer checked the porch and mailroom.",
    "Can you confirm whether the package is still expected tomorrow?",
    "Have you checked whether the refund posted?",
    "Have you checked with your supervisor?",
  ]) {
    assert.equal(customerFollowUpConflictsWithLearner(followUp, deliveryDiscovery), false, followUp);
  }
});
