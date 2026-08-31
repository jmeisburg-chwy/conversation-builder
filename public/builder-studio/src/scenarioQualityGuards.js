const SECOND_PERSON_QUESTION = /^\s*(?:(?:what|which|where|when|why|how)\b|(?:have|has|did|do|does|can|could|would|will|are|is)\b)[^?]*\b(?:you|your)\b/i;
const PARTNER_DISCOVERY_INSTRUCTION = /\bask\s+(?:(?:the\s+)?learner\s+)?(?:what|which|where|whether|if|how)\b[^.?!]*\b(?:check(?:ed|ing)?|look(?:ed|ing)?|search(?:ed|ing)?|locat(?:e|ed|ing)|find|found|confirm(?:ed|ing)?|verif(?:y|ied|ying))\b/i;
const LEARNER_DISCOVERY_ACTION = /\b(?:ask|confirm|verify|determine|identify|find out)\b/i;

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
