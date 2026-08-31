const SIGNIFICANT_TEMPLATE_CODEPOINT = /[\p{L}\p{N}\p{S}\p{M}]/u;
const BASE_SIGNIFICANT_TEMPLATE_CODEPOINT = /[\p{L}\p{N}\p{S}]/u;
const TEMPLATE_SYMBOL_CODEPOINT = /\p{S}/u;
const TEMPLATE_CONTIGUOUS_SCRIPT_CODEPOINT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;
const TEMPLATE_WORD_CODEPOINT = /[\p{L}\p{N}\p{M}]/u;
const TEMPLATE_SEPARATOR_CODEPOINT = /[\p{P}\p{Z}\s]/u;
const TEMPLATE_WHITESPACE_CODEPOINT = /[\p{Z}\s]/u;
const TEMPLATE_BARRIER_PREFIX = "\u0000";

function unicodeTemplateEdgeClass(codepoints, edge) {
  const step = edge === "start" ? 1 : -1;
  for (
    let index = edge === "start" ? 0 : codepoints.length - 1;
    index >= 0 && index < codepoints.length;
    index += step
  ) {
    const codepoint = codepoints[index];
    if (!BASE_SIGNIFICANT_TEMPLATE_CODEPOINT.test(codepoint)) {
      if (!SIGNIFICANT_TEMPLATE_CODEPOINT.test(codepoint) &&
          !TEMPLATE_SEPARATOR_CODEPOINT.test(codepoint)) return "none";
      continue;
    }
    if (TEMPLATE_SYMBOL_CODEPOINT.test(codepoint)) return "symbol";
    if (TEMPLATE_CONTIGUOUS_SCRIPT_CODEPOINT.test(codepoint)) return "continuous";
    return "word";
  }
  return "none";
}

function canonicalTemplateRepresentation(value) {
  const codepoints = [...String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")];
  const searchSequence = [];
  const compactSequence = [];
  const wordBefore = [];
  const wordAfter = [];
  let hasSignificant = false;
  codepoints.forEach((codepoint, index) => {
    if (!TEMPLATE_WHITESPACE_CODEPOINT.test(codepoint)) compactSequence.push(codepoint);
    if (SIGNIFICANT_TEMPLATE_CODEPOINT.test(codepoint)) {
      hasSignificant = true;
      searchSequence.push(codepoint);
    } else if (TEMPLATE_SEPARATOR_CODEPOINT.test(codepoint)) {
      return;
    } else {
      searchSequence.push(`${TEMPLATE_BARRIER_PREFIX}${codepoint}`);
    }
    wordBefore.push(TEMPLATE_WORD_CODEPOINT.test(codepoints[index - 1] || ""));
    wordAfter.push(TEMPLATE_WORD_CODEPOINT.test(codepoints[index + 1] || ""));
  });
  return {
    hasSignificant,
    searchSequence,
    compactSequence,
    wordBefore,
    wordAfter,
    startEdgeClass: unicodeTemplateEdgeClass(codepoints, "start"),
    endEdgeClass: unicodeTemplateEdgeClass(codepoints, "end"),
  };
}

function linearPrefixTable(pattern) {
  const prefixes = new Uint32Array(pattern.length);
  let matched = 0;
  for (let index = 1; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = prefixes[matched - 1];
    }
    if (pattern[index] === pattern[matched]) matched += 1;
    prefixes[index] = matched;
  }
  return prefixes;
}

function containsLinearSequence(candidate, pattern, accept = () => true) {
  if (!pattern.length || candidate.length < pattern.length) return false;
  const prefixes = linearPrefixTable(pattern);
  let matched = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    while (matched > 0 && candidate[index] !== pattern[matched]) {
      matched = prefixes[matched - 1];
    }
    if (candidate[index] === pattern[matched]) matched += 1;
    if (matched !== pattern.length) continue;
    const start = index - pattern.length + 1;
    if (accept(start, index)) return true;
    matched = prefixes[matched - 1];
  }
  return false;
}

function containsSelectedTemplate(candidate, templateValue) {
  const template = canonicalTemplateRepresentation(templateValue);
  if (template.hasSignificant) {
    const requiresStartBoundary = template.startEdgeClass === "word";
    const requiresEndBoundary = template.endEdgeClass === "word";
    return containsLinearSequence(
      candidate.searchSequence,
      template.searchSequence,
      (start, end) =>
        (!requiresStartBoundary || !candidate.wordBefore[start]) &&
        (!requiresEndBoundary || !candidate.wordAfter[end]),
    );
  }
  return containsLinearSequence(candidate.compactSequence, template.compactSequence);
}

export function containsAnyCompleteApprovedResponseTemplate(value, templateValues = []) {
  const candidate = canonicalTemplateRepresentation(value);
  return (Array.isArray(templateValues) ? templateValues : [templateValues])
    .some((template) => containsSelectedTemplate(candidate, template));
}
