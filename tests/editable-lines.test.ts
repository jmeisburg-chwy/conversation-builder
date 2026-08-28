import assert from "node:assert/strict";
import test from "node:test";

import { parseEditableLines } from "../lib/editable-lines";

test("preserves a trailing line while the creator types a multi-line list", () => {
  assert.deepEqual(parseEditableLines("First item\n"), ["First item", ""]);
  assert.deepEqual(parseEditableLines("First item\nSecond item"), ["First item", "Second item"]);
});
