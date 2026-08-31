import assert from "node:assert/strict";
import test from "node:test";

import { customerFollowUpConflictsWithLearner } from "../public/builder-studio/src/scenarioQualityGuards.js";

const deliveryDiscovery = ["Ask what the customer has already checked for the package."];

test("detects instruction-form customer follow-ups that invert the Learner's delivery discovery", () => {
  for (const followUp of [
    "Ask the learner which delivery spots the customer checked.",
    "After acknowledging the concern, ask which delivery spots the customer checked.",
  ]) {
    assert.equal(customerFollowUpConflictsWithLearner(followUp, deliveryDiscovery), true, followUp);
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
