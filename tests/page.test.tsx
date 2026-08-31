import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "../app/page";

test("hosts the directly reused Builder experience in the Chewy shell", () => {
  const html = renderToStaticMarkup(<Home />);

  assert.match(html, /Conversation Builder/);
  assert.match(html, /Conversation Simulator/);
  assert.match(html, /builder-studio\/index\.html/);
});

test("removes the replacement mode-card and publishing experiences", () => {
  const html = renderToStaticMarkup(<Home />);

  assert.doesNotMatch(html, /Test in Rise/);
  assert.doesNotMatch(html, /Start new/);
  assert.doesNotMatch(html, /Improve existing JSON/);
  assert.doesNotMatch(html, /Create similar from JSON/);
  assert.doesNotMatch(html, /Publish conversation/);
  assert.doesNotMatch(html, /Back to My Conversations/);
});
