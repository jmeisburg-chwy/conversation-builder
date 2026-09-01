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

test("strips unsupported generated negative Chat gates", () => {
  const output = compose(positiveMatch);

  assert.deepEqual(output.chatConfig.stepProgression[0].match, positiveMatch);
  assert.deepEqual(output.simulation.stateModel.chatStepProgression[0].match, positiveMatch);
});

test("strips unsupported canonical negative Chat gates", () => {
  const canonicalNegative = [{ op: "contains_any", phrases: ["store credit"] }];
  const output = compose({ ...positiveMatch, none: canonicalNegative }, positiveMatch);

  assert.deepEqual(output.chatConfig.stepProgression[0].match, positiveMatch);
  assert.deepEqual(output.simulation.stateModel.chatStepProgression[0].match, positiveMatch);
});

test("ignores malformed unsupported canonical negative Chat gates", () => {
  const invalidCanonical = {
    ...positiveMatch,
    none: [{ op: "contains_any", phrases: [] }],
  };
  const output = compose(invalidCanonical);

  assert.equal(output.chatConfig.stepProgression[0].label, "Canonical phase");
  assert.deepEqual(output.chatConfig.stepProgression[0].match, positiveMatch);
  assert.deepEqual(output.simulation.stateModel.chatStepProgression[0].match, positiveMatch);
});
