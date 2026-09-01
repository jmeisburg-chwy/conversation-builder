import {
  customerBehaviorRuleConflictsWithLearner as sharedCustomerBehaviorRuleConflictsWithLearner,
  customerBehaviorRuleHasNegativeLearnerPolarity as sharedCustomerBehaviorRuleHasNegativeLearnerPolarity,
  customerBehaviorRuleIsNegativeGuardrail as sharedCustomerBehaviorRuleIsNegativeGuardrail,
  customerBehaviorRuleToNegativeGuardrail as sharedCustomerBehaviorRuleToNegativeGuardrail,
  customerFollowUpConflictsWithLearner as sharedCustomerFollowUpConflictsWithLearner,
} from "../public/builder-studio/src/scenarioQualityGuards.js";
import type { ChatAdvanceRequirementDraft } from "./scenario-contract";

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GENERIC_CHAT_GATE_PHRASES = new Set([
  "can help",
  "customer",
  "hello",
  "help",
  "help you",
  "hi",
  "issue",
  "ok",
  "okay",
  "process",
  "thank",
  "thank you",
  "thanks",
]);

const PROHIBITED_OPTION_ACTION = /^(?:approv(?:e|ed|ing)|choos(?:e|ing)|creat(?:e|ed|ing)|giv(?:e|ing)|issu(?:e|ed|ing)|offer(?:ed|ing)?|process(?:ed|ing)?|provid(?:e|ed|ing)|select(?:ed|ing)?|send(?:ing)?|use|using)\s+(.+)$/i;

export type ChatAdvanceRequirementQualityCode =
  | "chat_advance_requirement_alternatives"
  | "blank_chat_advance_phrase"
  | "brittle_chat_advance_phrase"
  | "generic_chat_advance_phrase"
  | "overlapping_chat_advance_phrase"
  | "prohibited_chat_advance_phrase";

export interface ChatAdvanceRequirementQualityFinding {
  code: ChatAdvanceRequirementQualityCode;
  requirementIndex: number;
  phraseIndex?: number;
}

function overlapsByRiseSubstring(left: string, right: string): boolean {
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

const FULL_TURN_CHAT_GATE_START = /^(?:a|an|can|could|did|do|does|i|is|it|please|that|the|this|we|will|would|you|your)\b/i;
const LEARNER_ACTION_CHAT_GATE_START = /^(?:acknowledge|ask|clarify|confirm|describe|explain|inform|issue|offer|process|provide|recap|state|submit|tell|verify)\b/i;

function isBrittleChatAdvancePhrase(value: string): boolean {
  const candidate = value.trim();
  const tokens = normalizeComparableText(candidate).split(" ").filter(Boolean);
  if (tokens.length > 6) return true;
  return tokens.length > 4
    && (FULL_TURN_CHAT_GATE_START.test(candidate) || LEARNER_ACTION_CHAT_GATE_START.test(candidate));
}

function prohibitedGateConcepts(action: string): string[] {
  const normalized = normalizeComparableText(action)
    .replace(/^(?:do not|dont|never|avoid)\s+/, "")
    .trim();
  if (!normalized) return [];

  const concepts = [normalized];
  const optionAction = normalized.match(PROHIBITED_OPTION_ACTION);
  if (optionAction) {
    concepts.push(...optionAction[1]
      .split(/\s+(?:and|or)\s+/)
      .map((candidate) => candidate.replace(/^(?:a|an|the)\s+/, "").trim())
      .filter(Boolean));
  }
  return [...new Set(concepts)];
}

export function findChatAdvanceRequirementQualityFindings(
  requirements: ChatAdvanceRequirementDraft[],
  prohibitedActions: string[],
): ChatAdvanceRequirementQualityFinding[] {
  const findings: ChatAdvanceRequirementQualityFinding[] = [];
  const priorPhrases: Array<{ requirementIndex: number; normalized: string }> = [];
  const prohibitedConcepts = prohibitedActions.flatMap(prohibitedGateConcepts);

  requirements.forEach((requirement, requirementIndex) => {
    const normalizedPhrases = requirement.phrases.map((phrase) => normalizeComparableText(phrase));
    if (new Set(normalizedPhrases.filter(Boolean)).size < 2) {
      findings.push({ code: "chat_advance_requirement_alternatives", requirementIndex });
    }

    normalizedPhrases.forEach((normalized, phraseIndex) => {
      if (!normalized) {
        findings.push({ code: "blank_chat_advance_phrase", requirementIndex, phraseIndex });
        return;
      }
      if (GENERIC_CHAT_GATE_PHRASES.has(normalized)) {
        findings.push({ code: "generic_chat_advance_phrase", requirementIndex, phraseIndex });
      }
      if (isBrittleChatAdvancePhrase(requirement.phrases[phraseIndex])) {
        findings.push({ code: "brittle_chat_advance_phrase", requirementIndex, phraseIndex });
      }
      if (prohibitedConcepts.some((concept) => overlapsByRiseSubstring(normalized, concept))) {
        findings.push({ code: "prohibited_chat_advance_phrase", requirementIndex, phraseIndex });
      }
      if (priorPhrases.some((prior) =>
        prior.requirementIndex !== requirementIndex
        && overlapsByRiseSubstring(prior.normalized, normalized)
      )) {
        findings.push({ code: "overlapping_chat_advance_phrase", requirementIndex, phraseIndex });
      }
      priorPhrases.push({ requirementIndex, normalized });
    });
  });

  return findings;
}

export function repeatsOpening(openingLine: string, partnerResponse: string): boolean {
  const opening = normalizeComparableText(openingLine);
  const response = normalizeComparableText(partnerResponse);
  return Boolean(opening && response && opening === response);
}

const REQUIRED_PREFERENCE_DISCOVERY = /\b(?:ask|clarif(?:y|ies|ied|ying)|confirm(?:s|ed|ing)?|determin(?:e|es|ed|ing)|find out|verif(?:y|ies|ied|ying))\b/i;
const GENERIC_PREFERENCE_TOPIC = /\b(?:choice|option|outcome|preference|requested resolution|desired resolution|preferred resolution)\b/i;
const SUBJECT_PREFERENCE_DISCLOSURE = /\b(?:i|we)(?:(?:['’]d)\s+(?:just\s+)?like|\s+(?:just\s+)?(?:choose|need|prefer|request|want|would\s+like))\s+(.+?)([.!?]?)$/iu;
const OBJECT_PREFERENCE_DISCLOSURE = /^\s*(.+?)\s+is\s+what\s+(?:i|we)(?:(?:['’]d)\s+like|\s+(?:need|want|prefer|would\s+like))\s*([.!?]?)$/iu;
const EXPLICIT_NO_RESOLUTION_OPTION = /\bno(?:\s+to)?\s+(?:(?:a|an|the)\s+)?((?:store\s+credit|credit|exchange|refund|replacement|reshipment)(?:\s+(?:and|or)\s+(?:(?:a|an|the)\s+)?(?:store\s+credit|credit|exchange|refund|replacement|reshipment))*)$/i;
const DECLINED_PREFERENCE_PATTERNS = [
  /\b(?:i|we)\s+(?:do not|dont|did not|didnt|never)\s+(?:accept|choose|need|prefer|request|want)\s+(.+)$/i,
  /\b(?:i|we)\s+(?:decline|reject)\s+(.+)$/i,
  EXPLICIT_NO_RESOLUTION_OPTION,
];
const FOLLOW_UP_OPTION_REQUEST_PATTERNS = [
  /\bwhy\s+(?:cant|cannot)\s+(?:i|we)\s+(?:get|have|receive)\b/i,
  /\bwhy\s+(?:isnt|is not)\s+.+\b(?:available|possible)\b/i,
  /\bwhy\s+is\s+.+\bnot\s+(?:available|possible)\b/i,
  /\b(?:can|could|may|would)\s+(?:i|we)\s+(?:get|have|receive)\b/i,
  /\b(?:can|could|may|will|would)\s+you\s+(?:issue|offer|process|provide|replace|reship|send)\b/i,
  /\b(?:i|we)\s+(?:need|prefer|request|want|would like)\b/i,
  /\bwhat about\b/i,
  /\bis\b.+\b(?:available|possible)\b/i,
];
const INTENT_STOP_WORDS = new Set([
  "a", "about", "an", "and", "back", "be", "can", "cant", "card", "choose", "could", "customer", "damaged",
  "do", "does", "dont", "for", "full", "get", "have", "i", "if", "in", "is", "it", "just", "like", "may",
  "me", "my", "need", "of", "on", "or", "original", "please", "prefer", "receive", "request", "the", "this", "to",
  "want", "we", "what", "why", "with", "would", "you", "your",
]);

function intentTokens(value: string): Set<string> {
  return new Set(normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !INTENT_STOP_WORDS.has(token)));
}

function capturedIntentTokens(value: string, patterns: RegExp[]): Set<string> {
  const tokens = new Set<string>();
  value.split(/[.!?]+/u).forEach((sentence) => {
    const normalized = normalizeComparableText(sentence);
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) continue;
      intentTokens(match[1]).forEach((token) => tokens.add(token));
    }
  });
  return tokens;
}

interface ExplicitPreferenceDisclosure {
  intent: string;
  prefix: string;
  punctuation: string;
}

function explicitPreferenceDisclosure(sentence: string): ExplicitPreferenceDisclosure | undefined {
  const subject = sentence.match(SUBJECT_PREFERENCE_DISCLOSURE);
  if (subject?.index !== undefined) {
    return {
      intent: subject[1],
      prefix: sentence.slice(0, subject.index),
      punctuation: subject[2] || ".",
    };
  }
  const object = sentence.match(OBJECT_PREFERENCE_DISCLOSURE);
  if (!object) return undefined;
  return { intent: object[1], prefix: "", punctuation: object[2] || "." };
}

function explicitPreferenceTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  const sentences = value.match(/[^.!?]+[.!?]*/gu) ?? [value];
  sentences.forEach((sentence) => {
    const disclosure = explicitPreferenceDisclosure(sentence);
    if (!disclosure) return;
    intentTokens(disclosure.intent).forEach((token) => tokens.add(token));
  });
  return tokens;
}

function resolutionOptionConcept(token: string): string | undefined {
  if (/^credits?$/u.test(token)) return "credit";
  if (/^exchang(?:e|es|ed|ing)$/u.test(token)) return "exchange";
  if (/^refund(?:s|ed|ing)?$/u.test(token)) return "refund";
  if (/^replac(?:e|es|ed|ing|ement|ements)$/u.test(token)
    || /^reship(?:s|ped|ping|ment|ments)?$/u.test(token)) return "replacement";
  return undefined;
}

function resolutionOptionConcepts(tokens: Set<string>): Set<string> {
  return new Set([...tokens].map(resolutionOptionConcept).filter((value): value is string => Boolean(value)));
}

export function openingPreanswersRequiredPreference(openingLine: string, learnerActions: string[]): boolean {
  const learnerAction = learnerActions.join(" ");
  if (!REQUIRED_PREFERENCE_DISCOVERY.test(learnerAction)) return false;
  const openingPreference = explicitPreferenceTokens(openingLine);
  if (!openingPreference.size) return false;
  const actionTokens = intentTokens(learnerAction);
  return GENERIC_PREFERENCE_TOPIC.test(learnerAction)
    || [...openingPreference].some((token) => actionTokens.has(token));
}

export function removePreansweredPreferenceFromOpening(
  openingLine: string,
  learnerActions: string[],
): string {
  if (!openingPreanswersRequiredPreference(openingLine, learnerActions)) return openingLine;
  const learnerAction = learnerActions.join(" ");
  const actionTokens = intentTokens(learnerAction);
  const discoversGenericPreference = GENERIC_PREFERENCE_TOPIC.test(learnerAction);
  const sentences = openingLine.match(/[^.!?]+[.!?]*/gu) ?? [openingLine];
  const repaired = sentences.flatMap((sentence) => {
    const preference = explicitPreferenceDisclosure(sentence);
    if (!preference) return [sentence.trim()];
    const preferenceTokens = intentTokens(preference.intent);
    if (!discoversGenericPreference
      && ![...preferenceTokens].some((token) => actionTokens.has(token))) return [sentence.trim()];

    const prefix = preference.prefix
      .replace(/(?:[,;:]\s*)?(?:and|but|so)\s*$/iu, "")
      .trim();
    if (!prefix) return [];
    return [`${prefix.replace(/[,;:\s]+$/u, "")}${preference.punctuation}`];
  }).filter(Boolean);
  return repaired.join(" ").replace(/\s+/gu, " ").trim();
}

export function customerFollowUpContradictsRejectedOption(
  followUp: string,
  intentSources: string[],
): boolean {
  const normalizedFollowUp = normalizeComparableText(followUp);
  if (!FOLLOW_UP_OPTION_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedFollowUp))) return false;
  const declined = resolutionOptionConcepts(
    capturedIntentTokens(intentSources.join(". "), DECLINED_PREFERENCE_PATTERNS),
  );
  if (!declined.size) return false;
  const requested = resolutionOptionConcepts(intentTokens(followUp));
  return [...declined].some((token) => requested.has(token));
}

export function customerFollowUpConflictsWithLearner(
  followUp: string,
  learnerActions: string[],
): boolean {
  return sharedCustomerFollowUpConflictsWithLearner(followUp, learnerActions);
}

export function customerBehaviorRuleConflictsWithLearner(rule: string): boolean {
  return sharedCustomerBehaviorRuleConflictsWithLearner(rule);
}

export function customerBehaviorRuleIsNegativeGuardrail(rule: string): boolean {
  return sharedCustomerBehaviorRuleIsNegativeGuardrail(rule);
}

export function customerBehaviorRuleHasNegativeLearnerPolarity(rule: string): boolean {
  return sharedCustomerBehaviorRuleHasNegativeLearnerPolarity(rule);
}

export function customerBehaviorRuleToNegativeGuardrail(rule: string): string {
  return sharedCustomerBehaviorRuleToNegativeGuardrail(rule);
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
