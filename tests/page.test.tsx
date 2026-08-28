import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "../app/page";

test("shows the standalone three-step Rise builder entry experience", () => {
  const html = renderToStaticMarkup(<Home />);

  assert.match(html, /Conversation Builder/);
  assert.match(html, /Build/);
  assert.match(html, /Review\/Edit/);
  assert.match(html, /Test in Rise/);
  assert.match(html, /Start new/);
  assert.match(html, /Improve existing JSON/);
  assert.match(html, /Create similar from JSON/);
  assert.match(html, /Learning objective/);
  assert.match(html, /Correct process/);
  assert.match(html, /fictional or de-identified/);
  assert.match(html, /Create draft with Coach Chewy/);
});
