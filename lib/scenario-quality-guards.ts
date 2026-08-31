import { customerFollowUpConflictsWithLearner as sharedCustomerFollowUpConflictsWithLearner } from "../public/builder-studio/src/scenarioQualityGuards.js";

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function repeatsOpening(openingLine: string, partnerResponse: string): boolean {
  const opening = normalizeComparableText(openingLine);
  const response = normalizeComparableText(partnerResponse);
  return Boolean(opening && response && opening === response);
}

export function customerFollowUpConflictsWithLearner(
  followUp: string,
  learnerActions: string[],
): boolean {
  return sharedCustomerFollowUpConflictsWithLearner(followUp, learnerActions);
}

const OUTCOME_ACTION_SOURCE = String.raw`(?:advis(?:e|es|ed|ing)|appl(?:y|ies|ied|ying)|approv(?:e|es|ed|ing)|arrang(?:e|es|ed|ing)|cancel(?:s|ed|ing)?|clos(?:e|es|ed|ing)|complet(?:e|es|ed|ing)|confirm(?:s|ed|ing)?|continu(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|declin(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|document(?:s|ed|ing)?|escalat(?:e|es|ed|ing)|explain(?:s|ed|ing)?|fil(?:e|es|ed|ing)|implement(?:s|ed|ing)?|initiat(?:e|es|ed|ing)|issu(?:e|es|ed|ing)|locat(?:e|es|ed|ing)|monitor(?:s|ed|ing)?|notif(?:y|ies|ied|ying)|offer(?:s|ed|ing)?|open(?:s|ed|ing)?|plac(?:e|es|ed|ing)|process(?:es|ed|ing)?|provid(?:e|es|ed|ing)|refund(?:s|ed|ing)?|replac(?:e|es|ed|ing)|requir(?:e|es|ed|ing)|reship(?:s|ped|ping)?|retain(?:s|ed|ing)?|return(?:s|ed|ing)?|schedul(?:e|es|ed|ing)|send(?:s|ing)?|sent|shar(?:e|es|ed|ing)|stat(?:e|es|ed|ing)|submit(?:s|ted|ting)?|tell(?:s|ing)?|told|transfer(?:s|red|ring)?|updat(?:e|es|ed|ing))`;
const OUTCOME_ACTION_AT_START_PATTERN = new RegExp(
  String.raw`^(\s*(?:(?:the\s+)?learner\s+(?:(?:must|should|will|can)\s+)?)?)(${OUTCOME_ACTION_SOURCE})\b`,
  "i",
);
const OUTCOME_ACTION_AFTER_LINK_PATTERN = new RegExp(
  String.raw`(\b(?:to|by|must|should|will|then)\s+)(${OUTCOME_ACTION_SOURCE})\b`,
  "i",
);
const UNRESOLVED_DISCRETION_PATTERN = new RegExp([
  String.raw`\b(?:if|when|as)\s+(?:appropriate|needed|necessary|applicable|possible)\b`,
  String.raw`\b(?:available|approved|possible)\b[^.?!]{0,40}\b(?:options?|choices?|next steps?)\b`,
  String.raw`\b(?:determine|choose|decide|identify|select)\b[^.?!]{0,50}\b(?:best|appropriate|approved)\b[^.?!]{0,30}\b(?:option|resolution|outcome|action|next step)\b`,
].join("|"), "i");
const RESULT_OPTION_PATTERN = /\b(?:options?|choices?|alternatives?)\b/i;
const RESOLVED_SELECTION_PATTERN = /\b(?:selected|chosen)\b/i;
const NEGATED_ALTERNATIVE_PATTERN = /\b(?:do\s+not|don't|never|without|no)\b[^.?!]{0,80}\bor\b/i;
const GENERIC_RESULT_PHRASE_PATTERN = /^(?:(?:an?|the|approved|available|appropriate|best|next)\s+)*(?:request|options?|choices?|alternatives?|next\s+steps?|details?|information|status|expectations?|resolution|outcome|actions?|process|path|support|help|plans?)\.?$/i;
const UNQUALIFIED_ARTIFACT_PATTERN = /^(?:(?:an?|the|approved|specific)\s+)?(?:[a-z][a-z'-]*\s+){0,3}(?:request|case|plan)\.?$/i;
const RECIPIENT_PADDING_PATTERN = /\s+(?:to|with|for)\s+(?:(?:a|the)\s+)?customer\.?$/i;
const DETAIL_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "is", "of", "on", "or", "the", "then", "to", "was", "with",
]);

function findOutcomeAction(value: string): { index: number; text: string } | null {
  for (const pattern of [OUTCOME_ACTION_AT_START_PATTERN, OUTCOME_ACTION_AFTER_LINK_PATTERN]) {
    const match = pattern.exec(value);
    if (match && match.index !== undefined) {
      return { index: match.index + match[1].length, text: match[2] };
    }
  }
  return null;
}

function hasResolvedSelection(value: string): boolean {
  return RESOLVED_SELECTION_PATTERN.test(value) && Boolean(findOutcomeAction(value));
}

function hasUnresolvedDecision(value: string): boolean {
  if (UNRESOLVED_DISCRETION_PATTERN.test(value)) return true;
  if (!RESULT_OPTION_PATTERN.test(value) || hasResolvedSelection(value)) return false;
  return !/\bno\b[^.?!]{0,30}\b(?:options?|choices?|alternatives?)\b/i.test(value);
}

function hasAmbiguousResolutionAlternative(value: string): boolean {
  if (hasResolvedSelection(value) || NEGATED_ALTERNATIVE_PATTERN.test(value)) return false;
  const alternatives = value.split(/\bor\b/i);
  if (alternatives.length < 2) return false;
  return alternatives.some((part, index) =>
    index < alternatives.length - 1
      && Boolean(findOutcomeAction(part))
      && Boolean(findOutcomeAction(alternatives[index + 1]))
  );
}

function hasDetailedOutcomeAction(value: string): boolean {
  const clauses = value.split(/(?:[.;!?]+|,\s+|\b(?:and\s+then|then|and|but)\b)/i);
  return clauses.some((clause) => {
    const action = findOutcomeAction(clause);
    if (!action) return false;

    const resultPhrase = clause.slice(action.index + action.text.length).trim();
    const outcomePhrase = resultPhrase.replace(RECIPIENT_PADDING_PATTERN, "").trim();
    if (!outcomePhrase || GENERIC_RESULT_PHRASE_PATTERN.test(outcomePhrase)) return false;
    if (UNQUALIFIED_ARTIFACT_PATTERN.test(outcomePhrase) && !/\d/.test(outcomePhrase)) return false;

    const detailWords = normalizeComparableText(outcomePhrase)
      .split(" ")
      .filter((word) => word && !DETAIL_STOP_WORDS.has(word));
    if (detailWords.length >= 2) return true;

    return /^(?:the|this|that|their|its|our|your|customer(?:s|'s))\s+/i.test(outcomePhrase);
  });
}

export function hasDeterministicResolutionText(value: string): boolean {
  const candidate = value.trim();
  return Boolean(candidate)
    && !hasUnresolvedDecision(candidate)
    && !hasAmbiguousResolutionAlternative(candidate)
    && hasDetailedOutcomeAction(candidate);
}

export function isNondeterministicResolutionText(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return false;
  if (hasUnresolvedDecision(candidate)) return true;
  if (hasAmbiguousResolutionAlternative(candidate)) return true;
  if (hasDeterministicResolutionText(candidate)) return false;
  if (/\binitiat(?:e|es|ed|ing)\s+(?:a |an |the )?resolution\b/i.test(candidate)) return true;
  if (/\bfollow\s+(?:(?:the\s+)?approved\s+(?:process|path|support path)|policy)\b/i.test(candidate)) return true;
  if (/\bdetermine\s+(?:the\s+)?(?:best|appropriate|approved)\s+(?:resolution|outcome|next step)\b/i.test(candidate)) return true;
  if (/\bresolve\s+(?:the\s+)?(?:issue|situation)\s+appropriately\b/i.test(candidate)) return true;
  return Boolean(findOutcomeAction(candidate)) || /\b(?:available|appropriate|approved)\s+(?:next steps?|options?)\b/i.test(candidate);
}

export function findNondeterministicResolutionStep(correctProcess: string[]): number {
  const ambiguousIndex = correctProcess.findIndex(hasAmbiguousResolutionAlternative);
  if (ambiguousIndex >= 0) return ambiguousIndex;
  if (correctProcess.some(hasDeterministicResolutionText)) return -1;
  const vagueIndex = correctProcess.findIndex(isNondeterministicResolutionText);
  if (vagueIndex >= 0) return vagueIndex;
  for (let index = correctProcess.length - 1; index >= 0; index -= 1) {
    if (correctProcess[index]?.trim()) return index;
  }
  return -1;
}
