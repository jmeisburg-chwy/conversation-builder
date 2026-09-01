import assert from "node:assert/strict";
import test from "node:test";

import { composeWithCanonicalFidelity } from "../public/builder-studio/src/scenarioFidelity.js";

type MatchCondition = { op: string; phrases: string[] };
type Match = { all: MatchCondition[]; any: MatchCondition[]; none?: MatchCondition[] };

function progression(match: Match, label = "Generated phase") {
  return [{
    id: 0,
    label,
    match,
    customerResponse: "Thank you.",
    scenarioPathHint: "chatConfig.stepProgression[0]",
  }];
}

function chatScenario(steps: ReturnType<typeof progression>) {
  return {
    id: "refund_chat",
    channels: ["chat"],
    chatConfig: { stepProgression: structuredClone(steps) },
    simulation: { stateModel: { chatStepProgression: structuredClone(steps) } },
  };
}

const positiveMatch: Match = {
  all: [{ op: "contains_any", phrases: ["refund completed"] }],
  any: [],
};
const generatedNegative = [{
  op: "contains_any",
  phrases: ["store credit", "replace", "exchange"],
}];

function compose(canonicalMatch: Match, generatedMatch: Match = { ...positiveMatch, none: generatedNegative }) {
  const canonical = chatScenario(progression(canonicalMatch, "Canonical phase"));
  const generated = chatScenario(progression(generatedMatch));
  return composeWithCanonicalFidelity({
    baselineDraft: {},
    canonicalScenarios: [canonical],
    baselineGeneratedScenarios: [structuredClone(generated)],
    generatedScenarios: [generated],
  })[0];
}

test("preserves newly composed negative Chat gates when canonical fidelity has no none field", () => {
  const output = compose(positiveMatch);

  assert.deepEqual(output.chatConfig.stepProgression[0].match.none, generatedNegative);
  assert.deepEqual(output.simulation.stateModel.chatStepProgression[0].match.none, generatedNegative);
});

test("preserves a valid optional canonical none field when generated output omits it", () => {
  const canonicalNegative = [{ op: "contains_any", phrases: ["store credit"] }];
  const output = compose({ ...positiveMatch, none: canonicalNegative }, positiveMatch);

  assert.deepEqual(output.chatConfig.stepProgression[0].match.none, canonicalNegative);
});

test("rejects canonical fidelity when its optional none field is malformed", () => {
  const invalidCanonical = {
    ...positiveMatch,
    none: [{ op: "contains_any", phrases: [] }],
  };
  const output = compose(invalidCanonical);

  assert.equal(output.chatConfig.stepProgression[0].label, "Generated phase");
  assert.deepEqual(output.chatConfig.stepProgression[0].match.none, generatedNegative);
});
