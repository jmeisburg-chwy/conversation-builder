import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SCENARIO_FILE_BYTES, readScenarioUploads } from "../lib/scenario-upload";

test("reads bounded JSON scenario uploads", async () => {
  const parsed = await readScenarioUploads([{
    name: "scenario.json",
    size: 13,
    text: async () => '{"ok":true}',
  }]);

  assert.deepEqual(parsed, [{ ok: true }]);
});

test("rejects a scenario upload before reading when it exceeds the file limit", async () => {
  let read = false;

  await assert.rejects(
    readScenarioUploads([{
      name: "oversized.json",
      size: MAX_SCENARIO_FILE_BYTES + 1,
      text: async () => {
        read = true;
        return "{}";
      },
    }]),
    /smaller than/,
  );
  assert.equal(read, false);
});
