const SECOND_PERSON_QUESTION = /^\s*(?:(?:what|which|where|when|why|how)\b|(?:have|has|did|do|does|can|could|would|will|are|is)\b)[^?]*\b(?:you|your)\b/i;
const PARTNER_DISCOVERY_INSTRUCTION = /\bask\s+(?:(?:the\s+)?learner\s+)?(?:what|which|where|whether|if|how)\b[^.?!]*\b(?:check(?:ed|ing)?|look(?:ed|ing)?|search(?:ed|ing)?|locat(?:e|ed|ing)|find|found|confirm(?:ed|ing)?|verif(?:y|ied|ying))\b/i;
const LEARNER_DISCOVERY_ACTION = /\b(?:ask|confirm|verify|determine|identify|find out)\b/i;
const LEARNER_ROLE_SOURCE = String.raw`(?:(?:the|a)\s+)?(?:learner|agent|representative|chewy (?:agent|representative))`;
const LEARNER_SUBJECT_RULE = new RegExp(String.raw`^\s*${LEARNER_ROLE_SOURCE}\s+(?:must\s+|should\s+|will\s+|can\s+)?`, "i");
const LEARNER_NEGATIVE_RULE = new RegExp(
  String.raw`^\s*${LEARNER_ROLE_SOURCE}\s+(?:(?:must|should|will|can|could|would|may|shall)\s+(?:not|never)|can(?:not|['’]t)|(?:could|would|should|must|will|shall)n['’]t|never)\s+(.+)$`,
  "i",
);
const LEARNER_AVOID_RULE = new RegExp(
  String.raw`^\s*${LEARNER_ROLE_SOURCE}\s+(?:(?:must|should|will|can)\s+)?avoid\s+(.+)$`,
  "i",
);
const AGENT_ONLY_ACTION_RULE = /^\s*(?:(?:do\s+not|don't|never|avoid)\s+)?(?:approv(?:e|es|ed|ing)|cancel(?:s|ed|ing)?|complet(?:e|es|ed|ing)|escalat(?:e|es|ed|ing)|initiat(?:e|es|ed|ing)|issu(?:e|es|ed|ing)|process(?:es|ed|ing)?|refund(?:s|ed|ing)?|replac(?:e|es|ed|ing)|reship(?:s|ped|ping)?|submit(?:s|ted|ting)?|transfer(?:s|red|ring)?|updat(?:e|es|ed|ing))\b[^.?!]{0,100}\b(?:account|case|compensation|credit|customer|discount|order|payment|policy|refund|replacement|request|resolution|shipment|ticket|transfer)\b/i;
const AGENT_RESOLUTION_ACTION_RULE = /^\s*(?:(?:do\s+not|don't|never|avoid)\s+)?(?:offer(?:s|ed|ing)?|provid(?:e|es|ed|ing))\b[^.?!]{0,80}\b(?:compensation|credit|discount|refund|replacement|resolution|reshipment)\b/i;
const CUSTOMER_DIRECTED_ACTION_RULE = /^\s*(?:(?:do\s+not|don't|never|avoid)\s+)?(?:advis(?:e|es|ed|ing)|explain(?:s|ed|ing)?|inform(?:s|ed|ing)?|notif(?:y|ies|ied|ying)|tell(?:s|ing)?|told)\s+(?:the\s+)?customer\b/i;
const CUSTOMER_RECIPIENT_ACTION_RULE = /^\s*(?:(?:do\s+not|don't|never|avoid)\s+)?(?:clarif(?:y|ies|ied|ying)|communicat(?:e|es|ed|ing)|describ(?:e|es|ed|ing)|explain(?:s|ed|ing)?|stat(?:e|es|ed|ing))\b[^.?!]{0,120}\b(?:for|to)\s+(?:the\s+)?customer\b/i;
const DIRECT_NEGATIVE_RULE = /^\s*(?:do\s+not|don't|never|avoid)\b/i;
const LEARNER_NEGATIVE_POLARITY_RULE = new RegExp(
  String.raw`^\s*${LEARNER_ROLE_SOURCE}\s+[^.?!]*?(?:\b(?:not|never|avoid(?:s|ed|ing)?|cannot|prohibit(?:s|ed|ing)?|forbid(?:s|den|ding)?)\b|\b[a-z]+n['’]t\b)`,
  "i",
);

const DISCOVERY_ACTIVITY_FAMILIES = [
  /\b(?:check(?:ed|ing)?|look(?:ed|ing)?|search(?:ed|ing)?|locat(?:e|ed|ing)|find|found)\b/i,
  /\b(?:confirm(?:ed|ing)?|verif(?:y|ied|ying))\b/i,
];

const SEMANTIC_DOMAINS = [
  /\b(?:package|parcel|order|delivery|shipment|tracking|porch|doorstep|mailroom|lobby|neighbor|delivery spots?|usual spots?|drop[- ]?off|location)\b/i,
  /\b(?:refund|reimbursement|credit|payment|posted|posting)\b/i,
  /\b(?:supervisor|manager|team lead|leadership)\b/i,
  /\b(?:address|street|residence|apartment|unit)\b/i,
  /\b(?:medication|prescription|pharmacy|clinic|veterinarian|vet)\b/i,
];

const TOPIC_STOP_WORDS = new Set([
  "already", "and", "are", "ask", "asked", "asking", "been", "can", "check", "checked", "checking", "confirm", "confirmed",
  "customer", "did", "does", "for", "from", "have", "has", "into", "learner", "that", "the", "what", "where", "whether",
  "which", "with", "you", "your",
]);

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function semanticDomainIndexes(value) {
  return SEMANTIC_DOMAINS.flatMap((pattern, index) => pattern.test(value) ? [index] : []);
}

function topicTokens(value) {
  const tokens = normalizeComparableText(value).split(" ");
  return new Set(tokens.filter((token) => token.length > 2 && !TOPIC_STOP_WORDS.has(token)));
}

function sharesDiscoverySubject(left, right) {
  const leftDomains = semanticDomainIndexes(left);
  const rightDomains = new Set(semanticDomainIndexes(right));
  if (leftDomains.some((domain) => rightDomains.has(domain))) return true;

  const leftTokens = topicTokens(left);
  return [...topicTokens(right)].some((token) => leftTokens.has(token));
}

function sharesDiscoveryActivity(left, right) {
  return DISCOVERY_ACTIVITY_FAMILIES.some((pattern) => pattern.test(left) && pattern.test(right));
}

export function customerFollowUpConflictsWithLearner(followUp, learnerActions) {
  const candidate = String(followUp || "").trim();
  if (!SECOND_PERSON_QUESTION.test(candidate) && !PARTNER_DISCOVERY_INSTRUCTION.test(candidate)) return false;
  return (Array.isArray(learnerActions) ? learnerActions : []).some((action) =>
    LEARNER_DISCOVERY_ACTION.test(action)
      && sharesDiscoveryActivity(candidate, action)
      && sharesDiscoverySubject(candidate, action)
  );
}

export function customerBehaviorRuleConflictsWithLearner(rule) {
  const candidate = String(rule || "").trim();
  if (!candidate) return false;
  if (LEARNER_SUBJECT_RULE.test(candidate)) return true;
  return AGENT_ONLY_ACTION_RULE.test(candidate)
    || AGENT_RESOLUTION_ACTION_RULE.test(candidate)
    || CUSTOMER_DIRECTED_ACTION_RULE.test(candidate)
    || CUSTOMER_RECIPIENT_ACTION_RULE.test(candidate);
}

export function customerBehaviorRuleIsNegativeGuardrail(rule) {
  return Boolean(customerBehaviorRuleToNegativeGuardrail(rule));
}

export function customerBehaviorRuleHasNegativeLearnerPolarity(rule) {
  return LEARNER_NEGATIVE_POLARITY_RULE.test(String(rule || "").trim());
}

export function customerBehaviorRuleToNegativeGuardrail(rule) {
  const candidate = String(rule || "").trim();
  if (!candidate || !customerBehaviorRuleConflictsWithLearner(candidate)) return "";
  if (DIRECT_NEGATIVE_RULE.test(candidate)) {
    if (/^(?:do\s+not|avoid)\b/i.test(candidate)) return candidate;
    const action = candidate.replace(/^\s*(?:don't|never)\s+/i, "");
    return action ? `Do not ${action.replace(/^./u, (character) => character.toLowerCase())}` : "";
  }
  const learnerNegative = candidate.match(LEARNER_NEGATIVE_RULE);
  if (learnerNegative) {
    const action = learnerNegative[1].trim();
    return action ? `Do not ${action.replace(/^./u, (character) => character.toLowerCase())}` : "";
  }
  const learnerAvoid = candidate.match(LEARNER_AVOID_RULE);
  if (!learnerAvoid) return "";
  const action = learnerAvoid[1].trim();
  return action ? `Avoid ${action.replace(/^./u, (character) => character.toLowerCase())}` : "";
}
