import {
  customerBehaviorRuleConflictsWithLearner as sharedCustomerBehaviorRuleConflictsWithLearner,
  customerBehaviorRuleHasNegativeLearnerPolarity as sharedCustomerBehaviorRuleHasNegativeLearnerPolarity,
  customerBehaviorRuleIsNegativeGuardrail as sharedCustomerBehaviorRuleIsNegativeGuardrail,
  customerBehaviorRuleToNegativeGuardrail as sharedCustomerBehaviorRuleToNegativeGuardrail,
  customerFollowUpConflictsWithLearner as sharedCustomerFollowUpConflictsWithLearner,
} from "../public/builder-studio/src/scenarioQualityGuards.js";
import type { ChatAdvanceRequirementDraft, ObjectiveDraft, PhaseDraft } from "./scenario-contract";

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
  | "chat_advance_phrase_concept_mismatch"
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

type ChatRequirementConcept =
  | "amount"
  | "destination"
  | "timeline"
  | "completion"
  | "closing"
  | "empathy"
  | "question_intent"
  | "preference"
  | "refund";

function chatRequirementConcept(requirementId: string): ChatRequirementConcept | undefined {
  const id = normalizeComparableText(requirementId);
  if (/\b(?:amount|price|total)\b/u.test(id)) return "amount";
  if (/\b(?:card|destination|method|payment)\b/u.test(id)) return "destination";
  if (/\b(?:duration|timeframe|timeline|timing|window)\b/u.test(id)) return "timeline";
  if (/\b(?:complete|completed|completion|confirm outcome|recap|review outcome|summarize|summary)\b/u.test(id)) return "completion";
  if (/\b(?:close|closing|farewell)\b/u.test(id)) return "closing";
  if (/\b(?:acknowledge|acknowledgement|empathy|empathetic|inconvenience|recognize)\b/u.test(id)) return "empathy";
  if (/\b(?:question|questioning)\b/u.test(id)) return "question_intent";
  if (/\b(?:choice|prefer|preference)\b/u.test(id)) return "preference";
  if (id === "refund" || id === "refund action" || id === "refund resolution") return "refund";
  return undefined;
}

function phraseExpressesRequirementConcept(requirementId: string, phrase: string): boolean {
  const concept = chatRequirementConcept(requirementId);
  if (!concept) return true;
  const normalized = normalizeComparableText(phrase);
  if (concept === "amount") {
    return /(?:\$\s*)?\d+\.\d{2}\b/u.test(phrase) || /\b(?:amount|price|total)\b/u.test(normalized);
  }
  if (concept === "destination") {
    return /\b(?:destination|original card|original payment|payment card|payment method)\b/u.test(normalized);
  }
  if (concept === "timeline") {
    return /\b(?:business days?|days?|duration|end of day|hours?|timeframe|timeline|timing|today|tomorrow|weeks?)\b/u.test(normalized);
  }
  if (concept === "completion") {
    return /\b(?:complete|completed|confirmed|issued|placed|processed|recap|refunded|review|sent|submitted|summarize|summary|transferred)\b/u.test(normalized);
  }
  if (concept === "closing") return /\b(?:anything else|appreciate|close|closing|thank|thanks)\b/u.test(normalized);
  if (concept === "empathy") {
    return /\b(?:acknowledge|apologize|apology|concern|empathy|frustrat\w*|inconvenience|recognize|see|sorry|sounds|understand)\b/u.test(normalized);
  }
  if (concept === "question_intent") {
    return /\b(?:ask|can i|do you want|may i|would you like|would you prefer)\b/u.test(normalized);
  }
  if (concept === "preference") {
    if (/\b(?:choice|prefer\w*|request\w*|want|whether)\b/u.test(normalized)) return true;
    const optionConcepts = resolutionOptionConcepts(intentTokens(normalized));
    if (!optionConcepts.size) return false;
    if (/\b(?:ask|confirm)\b/u.test(normalized)) return true;
    const downstreamDetail = /(?:\$\s*)?\d+\.\d{2}\b/u.test(phrase)
      || /\b(?:amount|business days?|card|completed|confirmed|destination|hours?|issued|method|payment|processed|timeline|timing|weeks?)\b/u.test(normalized);
    return !downstreamDetail;
  }
  if (concept === "refund") return /\brefund\w*\b/u.test(normalized);
  return /\brefund\b/u.test(normalized);
}

type ProhibitionAllowlistKind = "amount" | "timeline" | "resolution";

interface ProhibitionAllowlistConstraint {
  kind: ProhibitionAllowlistKind;
  allowed: Set<string>;
}

const PROHIBITION_ALLOWLIST_DELIMITER = /\b(?:(?:anything\s+)?other\s+than|different\s+from|except)\b/iu;

function canonicalAmount(value: string): string | undefined {
  const amount = Number.parseFloat(value.replace(/,/gu, ""));
  return Number.isFinite(amount) ? amount.toFixed(2) : undefined;
}

function amountValues(value: string): Set<string> {
  const amounts = new Set<string>();
  for (const match of value.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gu)) {
    const amount = canonicalAmount(match[1]);
    if (amount) amounts.add(amount);
  }
  for (const match of value.matchAll(/\b(\d+(?:,\d{3})*\.\d{2})\b/gu)) {
    const amount = canonicalAmount(match[1]);
    if (amount) amounts.add(amount);
  }
  return amounts;
}

function canonicalTimelineUnit(value: string): string {
  const normalized = normalizeComparableText(value);
  if (normalized.startsWith("business day")) return "business days";
  if (normalized.startsWith("day")) return "days";
  if (normalized.startsWith("hour")) return "hours";
  return "weeks";
}

function timelineValues(value: string): Set<string> {
  const timelines = new Set<string>();
  const rangePattern = /\b(\d+)\s*(?:-|–|—|to)\s*(\d+)\s+(business\s+days?|days?|hours?|weeks?)\b/giu;
  for (const match of value.matchAll(rangePattern)) {
    timelines.add(`${match[1]}-${match[2]} ${canonicalTimelineUnit(match[3])}`);
  }

  const withoutRanges = value.replace(rangePattern, " ");
  for (const match of withoutRanges.matchAll(/\b(\d+)\s+(business\s+days?|days?|hours?|weeks?)\b/giu)) {
    timelines.add(`${match[1]} ${canonicalTimelineUnit(match[2])}`);
  }

  const normalized = normalizeComparableText(value);
  if (/\bend of day\b/u.test(normalized)) timelines.add("end of day");
  if (/\bsame day\b/u.test(normalized)) timelines.add("same day");
  if (/\btoday\b/u.test(normalized)) timelines.add("today");
  if (/\btomorrow\b/u.test(normalized)) timelines.add("tomorrow");
  if (/\b(?:immediate|immediately|instant|instantly)\b/u.test(normalized)) timelines.add("immediate");
  return timelines;
}

function resolutionValues(value: string): Set<string> {
  return resolutionOptionConcepts(intentTokens(value));
}

function prohibitionAllowlistConstraints(action: string): ProhibitionAllowlistConstraint[] {
  const delimiter = action.match(PROHIBITION_ALLOWLIST_DELIMITER);
  if (!delimiter || delimiter.index === undefined) return [];
  const allowedText = action.slice(delimiter.index + delimiter[0].length);
  const constraints: ProhibitionAllowlistConstraint[] = [];
  const amounts = amountValues(allowedText);
  const timelines = timelineValues(allowedText);
  const resolutions = resolutionValues(allowedText);
  if (amounts.size) constraints.push({ kind: "amount", allowed: amounts });
  if (timelines.size) constraints.push({ kind: "timeline", allowed: timelines });
  if (resolutions.size) constraints.push({ kind: "resolution", allowed: resolutions });
  return constraints;
}

function violatesProhibitionAllowlist(
  phrase: string,
  constraint: ProhibitionAllowlistConstraint,
): boolean {
  const actual = constraint.kind === "amount"
    ? amountValues(phrase)
    : constraint.kind === "timeline"
      ? timelineValues(phrase)
      : resolutionValues(phrase);
  return actual.size > 0 && [...actual].some((value) => !constraint.allowed.has(value));
}

const EXPLICIT_NEGATIVE_CLAUSE_START = /^\s*(?:do not|don't|dont|never|avoid)\b/iu;
const ACTION_LED_RESOLUTION_CLAUSE_START = /^\s*(?:(?:appl\w*|approv\w*|arrang\w*|authoriz\w*|carry out|complet\w*|creat\w*|execut\w*|finaliz\w*|giv\w*|guarantee\w*|initiat\w*|issu\w*|mention\w*|move forward with|offer\w*|perform\w*|plac\w*|present\w*|proceed with|process\w*|promis\w*|propos\w*|provid\w*|recommend\w*|releas\w*|schedul\w*|select\w*|send\w*|set up|start\w*|submi\w*|suggest\w*|trigger\w*|us\w*)\b.{0,60}\b(?:store credit|refund\w*|replac\w*|reship\w*)\b|(?:refund\w*|replac\w*|reship\w*)\b)/iu;
const TEMPORAL_RESOLUTION_CLAUSE_START = /^\s*(?:[a-z'’-]+\s+){0,6}(?:refund\w*|replac\w*|reship\w*)\b.{0,80}\b(?:before|prior\s+to|until|unless|without)\b/iu;
const RESOLUTION_SEQUENCE_MARKER = /\b(?:before|prior to|until|unless|without)\b/u;
const RESOLUTION_SEQUENCE_HEAD = /\b(?:refund\w*|replac\w*|reship\w*)\b/u;
const DIRECT_NEGATIVE_SEQUENCE_START = /^(?:do not|dont|never|avoid)\b/u;
const NON_CUSTOMER_PREREQUISITE = /\b(?:billing|customer care|customer service|customer support|department|director|eligibility|finance|fraud|leader|legal|manager|operations|policy|qa|shipping|supervisor|support|system|team|tool|tracking|triage|validation|verification)\b/u;
const CONSTRAINED_SEQUENCE_HEAD = /(?:\$\s*\d|\b\d+(?:\.\d+)?\b|\b(?:account|alternative|card|destination|different|excess|exchange|gift card|half|incorrect|less than|maximum|minimum|more than|original payment|partial|percent|percentage|portion|store credit|up to|wrong)\b)/u;
const NEGATED_CUSTOMER_DECISION = /\b(?:(?:did|do|does|would) not|didnt|doesnt|dont|never|no (?:refund|replacement|reshipment)|reject\w*|declin\w*)\b/u;
const COMPOUND_SEQUENCE_HEAD = /[,;:!?]|\b(?:also|and|but|or|then)\b/iu;

function splitProhibitedActionClauses(action: string): string[] {
  return action
    .split(/;|(?<!\d)\.(?!\d)/u)
    .flatMap((sentence) => {
      const clauses: string[] = [];
      let clauseStart = 0;
      const markerIndex = sentence.search(/\b(?:before|prior\s+to|until|unless|without)\b/iu);
      for (const conjunction of sentence.matchAll(/\b(?:and|but|or)\b/giu)) {
        const index = conjunction.index ?? 0;
        const remainder = sentence.slice(index + conjunction[0].length);
        const explicitNegative = EXPLICIT_NEGATIVE_CLAUSE_START.test(remainder);
        const actionLedResolution = ACTION_LED_RESOLUTION_CLAUSE_START.test(remainder)
          || TEMPORAL_RESOLUTION_CLAUSE_START.test(remainder);
        if (!explicitNegative && !(actionLedResolution && (markerIndex < 0 || index < markerIndex))) {
          continue;
        }
        clauses.push(sentence.slice(clauseStart, index));
        clauseStart = index + conjunction[0].length;
      }
      clauses.push(sentence.slice(clauseStart));
      return clauses;
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function customerConfirmationSignal(
  rawTail: string,
  customerName: string | undefined,
  allowPronounActor: boolean,
): boolean {
  const normalizedTail = normalizeComparableText(rawTail);
  const normalizedName = normalizeComparableText(customerName ?? "");
  const name = normalizedName ? escapeRegExp(normalizedName) : "(?!)";
  const role = "(?:the )?(?:customer|conversation partner|partner)";
  const namedOrRoleActor = `(?:${role}|${name})`;
  const pronounActor = "(?:he|she|they)";
  const actor = allowPronounActor
    ? `(?:${namedOrRoleActor}|${pronounActor})`
    : namedOrRoleActor;
  const safeOption = "(?:it|one|that|this|(?:(?:a|an|the) )?(?:full )?refund|(?:(?:a|an|the) )?(?:(?:free|no cost) )?(?:replacement|reshipment)|(?:(?:a|an|the|his|her|their) )?(?:choice|option|preference|request|selection))";
  const nestedDecision = `${pronounActor} (?:accept\\w*|approv\\w*|authoriz\\w*|choos\\w*|prefer\\w*|request\\w*|select\\w*|want\\w*) ${safeOption}`;
  const optionalDecision = `(?:accept\\w*|agree\\w*|approv\\w*|authoriz\\w*|confirm\\w*|consent\\w*)(?: (?:(?:to )?${safeOption}|(?:that )?${nestedDecision}))?`;
  const requiredDecision = `(?:choos\\w*|prefer\\w*|request\\w*|select\\w*|want\\w*) ${safeOption}`;
  const explicitPermission = "(?:giv\\w* (?:(?:a|the|his|her|their) )?(?:(?:clear|explicit|express) )?(?:go ahead|permission)|grant\\w*(?: permission)?|provid\\w* (?:(?:clear|explicit|express) )?(?:approval|confirmation|consent|permission)|s(?:ay|ays|aid) yes)";
  const adverbs = "(?:(?:clearly|directly|explicitly|first|verbally) )*";
  const decision = `${adverbs}(?:${optionalDecision}|${requiredDecision}|${nestedDecision}|${explicitPermission})`;
  const actorDecision = new RegExp(`^(?:(?:after|once) )?${actor} ${decision}(?: and ${decision})*$`, "u");
  if (actorDecision.test(normalizedTail)) return true;

  const modifier = "(?:(?:clear|direct|explicit|express|verbal) )?";
  const decisionNoun = "(?:agreement|approval|authorization|choice|confirmation|consent|permission|preference|request|selection)";
  const rolePossessive = "(?:the )?(?:customers|conversation partners|partners)";
  const namedPossessive = `${name}s`;
  const possessor = `(?:${rolePossessive}|${namedPossessive})`;
  const possessiveDecision = new RegExp(`^(?:(?:after|confirming|obtaining|receiving) )*${possessor} ${modifier}${decisionNoun}$`, "u");
  if (possessiveDecision.test(normalizedTail)) return true;

  const roleDecision = new RegExp(`^(?:(?:after|obtaining|receiving) )*${modifier}${role} (?:confirmation|consent|permission)$`, "u");
  if (roleDecision.test(normalizedTail)) return true;

  const decisionFromActor = new RegExp(`^(?:(?:after|obtaining|receiving) )*${modifier}${decisionNoun}(?: (?:has been|is|was) received)? (?:by|from) ${namedOrRoleActor}$`, "u");
  if (decisionFromActor.test(normalizedTail)) return true;

  if (allowPronounActor) {
    const pronounPossessive = new RegExp(`^(?:(?:after|obtaining|receiving) )*(?:his|her|their) ${modifier}${decisionNoun}$`, "u");
    if (pronounPossessive.test(normalizedTail)) return true;
  }

  const confirmingWhether = new RegExp(`^confirming whether ${actor} ${decision}$`, "u");
  return confirmingWhether.test(normalizedTail);
}

function sequenceHeadReferencesCustomer(normalizedHead: string, customerName?: string): boolean {
  if (/\b(?:customers?|conversation partners?|partners?)\b/u.test(normalizedHead)) return true;
  const customer = normalizeComparableText(customerName ?? "");
  if (!customer) return false;
  const name = escapeRegExp(customer);
  return new RegExp(`\\b${name}s?\\b`, "u").test(normalizedHead);
}

function sequenceHeadHasUnknownCapitalizedTerm(rawHead: string, customerName?: string): boolean {
  const customerTokens = new Set([
    "conversation",
    "customer",
    "partner",
    ...normalizeComparableText(customerName ?? "").split(" ").filter(Boolean),
  ]);
  const action = rawHead.replace(/^\s*(?:do not|don't|dont|never|avoid)\s+/iu, "").trim();
  return [...action.matchAll(/\b[A-Z][a-z]+\b/gu)].some((match) =>
    (match.index ?? 0) > 0 && !customerTokens.has(normalizeComparableText(match[0]))
  );
}

function safeResolutionSequenceHead(normalizedHead: string, customerName?: string): boolean {
  const customer = escapeRegExp(normalizeComparableText(customerName ?? ""));
  const customerReference = [
    "conversation partner",
    "customer",
    "her",
    "him",
    "partner",
    "them",
    ...(customer ? [customer] : []),
  ].join("|");
  const customerPossessive = [
    "conversation partners",
    "customers",
    "her",
    "his",
    "partners",
    "their",
    ...(customer ? [`${customer}s`] : []),
  ].join("|");
  const action = "(?:appl\\w*|approv\\w*|authoriz\\w*|carry out|complet\\w*|creat\\w*|execut\\w*|finaliz\\w*|giv\\w*|guarantee\\w*|initiat\\w*|issu\\w*|move forward with|perform\\w*|plac\\w*|proceed with|process\\w*|promis\\w*|provid\\w*|releas\\w*|send\\w*|set up|start\\w*|submi\\w*|trigger\\w*)";
  const recipient = `(?:(?:the )?(?:${customerReference}) )?`;
  const refund = `(?:(?:the )?(?:${customerPossessive}) )?(?:(?:a|an|the) )?(?:full )?refund(?: (?:order|request|transaction))?`;
  const replacement = `(?:(?:the )?(?:${customerPossessive}) )?(?:(?:a|an|the) )?(?:(?:free|no cost) )?(?:replacement|reshipment)(?: (?:order|request|transaction))?`;
  const actionHead = new RegExp(`^${action} ${recipient}(?:${refund}|${replacement})$`, "u");
  const bridgedRecipientHead = new RegExp(`^${action} (?:the )?(?:${customerReference}) with (?:${refund}|${replacement})$`, "u");
  const postposedRecipientHead = new RegExp(`^${action} (?:${refund}|${replacement}) to (?:the )?(?:${customerReference})$`, "u");
  const directRefund = new RegExp(`^refund\\w*(?: (?:the )?(?:${customerReference}))?(?: in full)?$`, "u");
  const directReplacement = new RegExp(`^(?:replac\\w*|reship\\w*)(?: (?:the )?(?:${customerReference}|item|order|product))?$`, "u");
  return actionHead.test(normalizedHead)
    || bridgedRecipientHead.test(normalizedHead)
    || postposedRecipientHead.test(normalizedHead)
    || directRefund.test(normalizedHead)
    || directReplacement.test(normalizedHead);
}

function safeResolutionOperationClause(
  normalizedClause: string,
  customerName?: string,
): boolean {
  const customer = escapeRegExp(normalizeComparableText(customerName ?? ""));
  const customerReference = [
    "conversation partner",
    "customer",
    "her",
    "him",
    "partner",
    "them",
    ...(customer ? [customer] : []),
  ].join("|");
  const customerPossessive = [
    "conversation partners",
    "customers",
    "her",
    "his",
    "partners",
    "their",
    ...(customer ? [`${customer}s`] : []),
  ].join("|");
  const action = "(?:appl\\w*|approv\\w*|arrang\\w*(?: for)?|authoriz\\w*|carry out|complet\\w*|creat\\w*|execut\\w*|finaliz\\w*|giv\\w*|initiat\\w*|issu\\w*|move forward with|offer\\w*|perform\\w*|plac\\w*|present\\w*|proceed with|process\\w*|propos\\w*|provid\\w*|recommend\\w*|releas\\w*|schedul\\w*|select\\w*|send\\w*|set up|start\\w*|submi\\w*|suggest\\w*|trigger\\w*|us\\w*)";
  const recipient = `(?:(?:the )?(?:${customerReference}) )?`;
  const approval = "(?:(?:approved|authorized) )*";
  const refund = `(?:(?:the )?(?:${customerPossessive}) )?(?:(?:a|an|the) )?${approval}(?:full )?refund(?: (?:order|request|transaction))?(?: (?:back )?to (?:(?:the )?(?:${customerPossessive}) )?(?:the )?original (?:card|payment card|payment method))?`;
  const replacementCore = `(?:(?:the )?(?:${customerPossessive}) )?(?:(?:a|an|the) )?${approval}(?:(?:free|no cost) )?(?:replacement|reshipment)(?: (?:item|order|product|request|shipment|transaction))?`;
  const systemChannel = "(?: (?:in|through|using|via) (?:(?:the )?(?:oms|system|tool)))?";
  const replacement = `${replacementCore}${systemChannel}`;
  const alternative = "(?:(?:a|an|the) )?(?:exchange|store credit)";
  const outcome = `(?:${refund}|${replacement}|${alternative})`;
  const directRefund = new RegExp(`^refund\\w*(?: (?:the )?(?:${customerReference}))?(?: in full)?$`, "u");
  const directReplacement = new RegExp(`^(?:replac\\w*|reship\\w*)(?: (?:the )?(?:${customerReference}|item|order|product))?$`, "u");
  return new RegExp(`^${action} ${recipient}${outcome}$`, "u").test(normalizedClause)
    || new RegExp(`^${action} (?:the )?(?:${customerReference}) with ${outcome}$`, "u").test(normalizedClause)
    || new RegExp(`^${action} ${outcome} (?:for|to) (?:the )?(?:${customerReference})$`, "u").test(normalizedClause)
    || new RegExp(`^${action} ${replacementCore} (?:for|to) (?:the )?(?:${customerReference})${systemChannel}$`, "u").test(normalizedClause)
    || directRefund.test(normalizedClause)
    || directReplacement.test(normalizedClause);
}

function resolutionCommunicationGatePhrases(normalizedClause: string): string[] {
  const match = normalizedClause.match(/^(guarantee\w*|mention\w*|promis\w*)\s+(?:(?:a|an|the) )?(?:full )?(refund\w*|replac\w*|reship\w*|store credit|exchange)$/u);
  if (!match) return [];
  const verb = match[1];
  const rawOption = match[2];
  const option = /^refund/u.test(rawOption)
    ? "refund"
    : /^replac/u.test(rawOption)
      ? "replacement"
      : /^reship/u.test(rawOption)
        ? "reshipment"
        : rawOption;
  const determiners = option === "store credit" ? [""] : ["", "a ", "the "];
  const modifiers = option === "refund" ? ["", "full "] : [""];
  const recipients = /^mention/u.test(verb) ? [""] : ["", "you "];
  const phrases = new Set<string>([normalizedClause]);
  recipients.forEach((recipient) => {
    determiners.forEach((determiner) => {
      modifiers.forEach((modifier) => phrases.add(`${verb} ${recipient}${determiner}${modifier}${option}`));
    });
  });
  return [...phrases];
}

function safeResolutionCommunicationClause(normalizedClause: string): boolean {
  return resolutionCommunicationGatePhrases(normalizedClause).length > 0;
}

const RESOLUTION_REFERENCE_CLAUSE_START = /^(?:creat\w*|giv\w*|guarantee\w*|issu\w*|mention\w*|offer\w*|present\w*|promis\w*|propos\w*|provid\w*|recommend\w*|select\w*|send\w*|suggest\w*|us\w*)\b/u;

function resolutionReferenceGatePhrases(normalizedClause: string): string[] {
  const compact = normalizedClause
    .replace(/\b(?:a|an|the)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const articleExpanded = compact.replace(
    /\b(refund\w*|replac\w*|reship\w*)\b/u,
    "the $1",
  );
  return [...new Set([normalizedClause, compact, articleExpanded].filter(Boolean))];
}

function isSimpleResolutionSequenceHead(
  rawHead: string,
  normalizedHead: string,
  customerName?: string,
): boolean {
  const tokens = normalizedHead.split(" ").filter(Boolean);
  return tokens.length > 0
    && tokens.length <= 8
    && !COMPOUND_SEQUENCE_HEAD.test(rawHead)
    && !NON_CUSTOMER_PREREQUISITE.test(normalizedHead)
    && !sequenceHeadHasUnknownCapitalizedTerm(rawHead, customerName)
    && safeResolutionSequenceHead(normalizedHead, customerName);
}

function earnedPreferenceSequenceOption(
  action: string,
  inheritedNegative = false,
  customerName?: string,
): string | undefined {
  const normalized = normalizeComparableText(action);
  if (!inheritedNegative && !DIRECT_NEGATIVE_SEQUENCE_START.test(normalized)) return undefined;
  const marker = normalized.match(RESOLUTION_SEQUENCE_MARKER);
  if (!marker || marker.index === undefined) return undefined;
  const head = normalized.slice(0, marker.index);
  const tail = normalized.slice(marker.index + marker[0].length);
  if (!RESOLUTION_SEQUENCE_HEAD.test(head)) return undefined;

  const actionHead = head.replace(/^(?:do not|dont|never|avoid)\s+/, "").trim();
  const rawMarker = action.match(/\b(?:before|prior\s+to|until|unless|without)\b/iu);
  const rawHead = rawMarker?.index === undefined ? "" : action.slice(0, rawMarker.index);
  if (CONSTRAINED_SEQUENCE_HEAD.test(actionHead)
    || !isSimpleResolutionSequenceHead(rawHead, actionHead, customerName)) {
    return undefined;
  }

  const headOptions = resolutionOptionConcepts(intentTokens(head));
  const tailOptions = resolutionOptionConcepts(intentTokens(tail));
  if (headOptions.size !== 1) return undefined;
  if (NEGATED_CUSTOMER_DECISION.test(tail)
    || CONSTRAINED_SEQUENCE_HEAD.test(tail)
    || tailOptions.size > 1) return undefined;
  if (headOptions.size > 0 && tailOptions.size > 0
    && [...headOptions].every((option) => !tailOptions.has(option))) return undefined;

  const rawTail = action.match(/\b(?:before|prior\s+to|until|unless|without)\b([\s\S]*)$/iu)?.[1] ?? "";
  const hasCustomerConfirmation = customerConfirmationSignal(
    rawTail,
    customerName,
    sequenceHeadReferencesCustomer(actionHead, customerName),
  );
  if (NON_CUSTOMER_PREREQUISITE.test(tail)) return undefined;
  return hasCustomerConfirmation ? [...headOptions][0] : undefined;
}

function unresolvedTemporalResolutionOption(
  action: string,
  inheritedNegative = false,
): string | undefined {
  const normalized = normalizeComparableText(action);
  if (!inheritedNegative && !DIRECT_NEGATIVE_SEQUENCE_START.test(normalized)) return undefined;
  const marker = normalized.match(RESOLUTION_SEQUENCE_MARKER);
  if (!marker || marker.index === undefined) return undefined;
  const head = normalized.slice(0, marker.index);
  const options = resolutionOptionConcepts(intentTokens(head));
  return options.size === 1 ? [...options][0] : undefined;
}

interface ProhibitedGateRule {
  concept: string;
  bareResolutionException?: string;
}

function bareResolutionConcept(value: string): string | undefined {
  const normalized = normalizeComparableText(value);
  if (/^(?:(?:a|the) )?(?:full )?refund(?: in full)?$/u.test(normalized)) return "refund";
  if (/^(?:(?:a|the) )?(?:replac\w*|reship\w*)$/u.test(normalized)) return "replacement";
  return undefined;
}

function prohibitedGateRulesForClause(
  action: string,
  inheritedNegative = false,
  customerName?: string,
): ProhibitedGateRule[] {
  if (prohibitionAllowlistConstraints(action).length > 0) return [];
  const normalized = normalizeComparableText(action)
    .replace(/^(?:do not|dont|never|avoid)\s+/, "")
    .replace(/\b(?:anything )?other than\b.*$/u, "")
    .replace(/\b(?:different from|except)\b.*$/u, "")
    .trim();
  if (!normalized) return [];

  // An earned-preference ordering rule does not prohibit the approved
  // resolution itself. The phase sequence enforces that the learner asks and
  // receives the customer's answer before a later outcome phase can advance.
  // Keep other prerequisites (for example, manager approval) fail-closed.
  const earnedPreferenceOption = earnedPreferenceSequenceOption(
    action,
    inheritedNegative,
    customerName,
  );
  if (earnedPreferenceOption) {
    const marker = normalized.match(RESOLUTION_SEQUENCE_MARKER);
    const actionHead = marker?.index === undefined
      ? normalized
      : normalized.slice(0, marker.index).trim();
    if (bareResolutionConcept(actionHead) === earnedPreferenceOption) return [];
    const compactActionHead = actionHead
      .replace(/\b(?:a|an|the)\b/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const canonicalActionHead = compactActionHead
      .replace(/\b(?:free|full|no cost)\b/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    return [...new Set([
      actionHead,
      compactActionHead,
      canonicalActionHead,
    ].filter(Boolean))].map((concept) => ({
      concept,
      bareResolutionException: earnedPreferenceOption,
    }));
  }

  const concepts = [normalized];
  const unresolvedTemporalOption = unresolvedTemporalResolutionOption(action, inheritedNegative);
  if (unresolvedTemporalOption === "refund") concepts.push("refund");
  if (unresolvedTemporalOption === "replacement") {
    concepts.push("replace", "replacement", "reship", "reshipment");
  }
  const optionAction = normalized.match(PROHIBITED_OPTION_ACTION);
  if (optionAction) {
    concepts.push(...optionAction[1]
      .split(/\s+(?:and|or)\s+/)
      .map((candidate) => candidate.replace(/^(?:a|an|the)\s+/, "").trim())
      .filter(Boolean));
  }
  if (/^refund\w*\b/u.test(normalized)) concepts.push("refund");
  if (/^(?:replac\w*|reship\w*)\b/u.test(normalized)) {
    concepts.push("replace", "replacement", "reship", "reshipment");
  }
  if (safeResolutionCommunicationClause(normalized)) {
    concepts.push(...resolutionCommunicationGatePhrases(normalized));
  }
  const safeOperation = safeResolutionOperationClause(normalized, customerName);
  if (!safeOperation
    && RESOLUTION_REFERENCE_CLAUSE_START.test(normalized)
    && resolutionOptionConcepts(intentTokens(normalized)).size > 0) {
    concepts.push(...resolutionReferenceGatePhrases(normalized));
  }
  if (safeOperation) {
    const actionOptions = resolutionOptionConcepts(intentTokens(normalized));
    if (actionOptions.has("refund")) concepts.push("refund");
    if (actionOptions.has("replacement")) {
      concepts.push("replace", "replacement", "reship", "reshipment");
    }
    if (actionOptions.has("credit")) concepts.push("store credit");
  }
  return [...new Set(concepts)].map((concept) => ({ concept }));
}

function prohibitedGateRules(action: string, customerName?: string): ProhibitedGateRule[] {
  const inheritedNegative = DIRECT_NEGATIVE_SEQUENCE_START.test(normalizeComparableText(action));
  const rules = splitProhibitedActionClauses(action)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .flatMap((clause) => prohibitedGateRulesForClause(clause, inheritedNegative, customerName));
  return [...new Map(rules.map((rule) => [
    `${rule.concept}\u0000${rule.bareResolutionException ?? ""}`,
    rule,
  ])).values()];
}

export function findChatAdvanceRequirementQualityFindings(
  requirements: ChatAdvanceRequirementDraft[],
  prohibitedActions: string[],
  customerName: string,
): ChatAdvanceRequirementQualityFinding[] {
  const findings: ChatAdvanceRequirementQualityFinding[] = [];
  const priorPhrases: Array<{ requirementIndex: number; normalized: string }> = [];
  const prohibitedRules = prohibitedActions.flatMap((action) =>
    prohibitedGateRules(action, customerName)
  );
  const prohibitionAllowlists = prohibitedActions.flatMap(prohibitionAllowlistConstraints);

  requirements.forEach((requirement, requirementIndex) => {
    const requirementConcept = chatRequirementConcept(requirement.id)
      ?? inferredChatRequirementConceptFromPhrases(requirement.phrases);
    const normalizedPhrases = requirement.phrases.map((phrase) => normalizeComparableText(phrase));
    const runtimeDistinctPhrases = new Set(
      requirement.phrases.map((phrase) => phrase.trim().toLowerCase()).filter(Boolean),
    );
    if (runtimeDistinctPhrases.size < 2 && requirementConcept !== "refund") {
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
      if (!phraseExpressesRequirementConcept(requirement.id, requirement.phrases[phraseIndex])) {
        findings.push({ code: "chat_advance_phrase_concept_mismatch", requirementIndex, phraseIndex });
      }
      if (prohibitedRules.some((rule) =>
        overlapsByRiseSubstring(normalized, rule.concept)
        && !(rule.bareResolutionException !== undefined
          && bareResolutionConcept(normalized) === rule.bareResolutionException)
      )
        || prohibitionAllowlists.some((constraint) =>
          violatesProhibitionAllowlist(requirement.phrases[phraseIndex], constraint)
        )) {
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

function learnerActionsDiscoverPreference(learnerActions: string[], preferenceTokens: Set<string>): boolean {
  const learnerAction = learnerActions.join(" ");
  if (!REQUIRED_PREFERENCE_DISCOVERY.test(learnerAction)
    && !/\b(?:do|would)\s+you\s+(?:prefer|want|would like)\b/iu.test(learnerAction)) return false;
  if (GENERIC_PREFERENCE_TOPIC.test(learnerAction)) return true;
  const actionTokens = intentTokens(learnerAction);
  return [...preferenceTokens].some((token) => actionTokens.has(token));
}

const OPERATIONAL_OUTCOME_ACTION_VERB = /\b(?:complet(?:e|es|ed|ing)|issu(?:e|es|ed|ing)|process(?:es|ed|ing)?)\b/iu;
const DIRECT_OPERATIONAL_IMPERATIVE = /(?:^|\bthen\s+)(?:refund|replace|reship|transfer)\b/iu;
const POST_ANSWER_LANGUAGE = /\b(?:clos(?:e|es|ed|ing)|recap(?:s|ped|ping)?|summar(?:ize|izes|ized|izing|y)|thank(?:s|ed|ing)?)\b/iu;
const CONFIRMED_OUTCOME_LANGUAGE = /(?:\bconfirmed\b.{0,60}\b(?:credit|exchange|refund|replacement|transfer)\b|\b(?:credit|exchange|refund|replacement|transfer)\b.{0,60}\bconfirmed\b)/iu;

function phaseHasPostAnswerEvidence(phase: PhaseDraft): boolean {
  const learnerActions = phase.learnerActions.join(" ");
  if (OPERATIONAL_OUTCOME_ACTION_VERB.test(learnerActions)
    || DIRECT_OPERATIONAL_IMPERATIVE.test(learnerActions)
    || POST_ANSWER_LANGUAGE.test(learnerActions)
    || CONFIRMED_OUTCOME_LANGUAGE.test(learnerActions)) return true;
  return (phase.chatAdvanceRequirements ?? []).some((requirement) => {
    const concept = chatRequirementConcept(requirement.id);
    return concept === "completion"
      || concept === "closing"
      || requirement.phrases.some((phrase) =>
        POST_ANSWER_LANGUAGE.test(phrase) || CONFIRMED_OUTCOME_LANGUAGE.test(phrase)
      );
  });
}

export function findPreferenceResponseOrderConflicts(openingLine: string, phases: PhaseDraft[]): number[] {
  const knownPreferenceConcepts = resolutionOptionConcepts(explicitPreferenceTokens(openingLine));
  const conflicts: number[] = [];
  phases.forEach((phase, phaseIndex) => {
    const partnerPreference = explicitPreferenceTokens(phase.partnerResponse);
    const partnerPreferenceConcepts = resolutionOptionConcepts(partnerPreference);
    const introducesPreference = [...partnerPreferenceConcepts]
      .some((concept) => !knownPreferenceConcepts.has(concept));
    if (introducesPreference
      && learnerActionsDiscoverPreference(phase.learnerActions, partnerPreference)
      && phaseHasPostAnswerEvidence(phase)) conflicts.push(phaseIndex);
    partnerPreferenceConcepts.forEach((concept) => knownPreferenceConcepts.add(concept));
  });
  return conflicts;
}

type OperationalCriterionConcept = "outcome" | "refund" | "replacement" | "transfer";

function operationalCriterionConcept(criterion: string): OperationalCriterionConcept | undefined {
  const normalized = normalizeComparableText(criterion);
  if (/^(?:avoid|do not|dont|never)\b/u.test(normalized)) return undefined;
  const leadingAction = normalized.match(/^(?:show this behavior\s+)?(complet\w*|issu\w*|process\w*|refund\w*|replac\w*|reship\w*|transfer\w*)\b/u);
  if (!leadingAction) return undefined;
  if (/\brefund\w*\b/u.test(normalized)) return "refund";
  if (/\b(?:replac\w*|reship\w*)\b/u.test(normalized)) return "replacement";
  if (/\btransfer\w*\b/u.test(normalized)) return "transfer";
  return "outcome";
}

function phaseOperationalConcepts(learnerActions: string[]): Set<OperationalCriterionConcept> {
  const concepts = new Set<OperationalCriterionConcept>();
  learnerActions.forEach((learnerAction) => {
    const clauses = learnerAction.split(/[,;!?]+|(?<!\d)\.(?!\d)|\b(?:and then|then|before|after|while)\b/iu);
    clauses.forEach((clause) => {
      const normalized = normalizeComparableText(clause);
      const actionBeforeOutcome = /\b(?:appl\w*|complet\w*|execut\w*|issu\w*|process\w*|provid\w*)\b/gu;
      for (const match of normalized.matchAll(actionBeforeOutcome)) {
        const remainder = normalized.slice((match.index ?? 0) + match[0].length);
        if (/^.{0,80}\brefund\w*\b/u.test(remainder)) concepts.add("refund");
        if (/^.{0,80}\b(?:replac\w*|reship\w*)\b/u.test(remainder)) concepts.add("replacement");
        if (/^.{0,80}\btransfer\w*\b/u.test(remainder)) concepts.add("transfer");
      }
      if (DIRECT_OPERATIONAL_IMPERATIVE.test(normalized)) {
        if (/^(?:then )?refund\b/u.test(normalized)) concepts.add("refund");
        if (/^(?:then )?(?:replace|reship)\b/u.test(normalized)) concepts.add("replacement");
        if (/^(?:then )?transfer\b/u.test(normalized)) concepts.add("transfer");
      }
      if (!/\b(?:refund\w*|replac\w*|reship\w*|transfer\w*)\b/u.test(normalized)
        && OPERATIONAL_OUTCOME_ACTION_VERB.test(normalized)) concepts.add("outcome");
    });
  });
  return concepts;
}

function detectedResolutionOption(value: string): "credit" | "exchange" | "refund" | "replacement" | undefined {
  const normalized = normalizeComparableText(value);
  if (/\brefund\w*\b/u.test(normalized)) return "refund";
  if (/\b(?:replac\w*|reship\w*)\b/u.test(normalized)) return "replacement";
  if (/\bstore credit\b/u.test(normalized)) return "credit";
  if (/\bexchang\w*\b/u.test(normalized)) return "exchange";
  return undefined;
}

const NATURAL_EMPATHY_PHRASES = [
  "i'm sorry",
  "i’m sorry",
  "i am sorry",
  "sorry your",
  "sorry the",
  "sorry about",
  "i understand",
  "we understand",
  "i see your",
  "i see the",
  "i see how",
  "i see why",
  "i see that",
  "that sounds frustrating",
  "sounds frustrating",
];
const QUESTION_INTENT_PHRASES = [
  "would you like",
  "do you want",
  "would you prefer",
  "can i process",
  "can i issue",
  "can i provide",
  "can i complete",
  "can i send",
  "may i process",
  "may i issue",
  "may i provide",
  "may i complete",
  "may i send",
];
const COMPLETED_REFUND_ACTION_PHRASES = [
  "refund was issued",
  "refund has been issued",
  "issued your refund",
  "issued the refund",
  "refund was processed",
  "refund has been processed",
  "processed your refund",
  "processed the refund",
  "refund was completed",
  "refund has been completed",
  "completed your refund",
  "completed the refund",
  "refund was sent",
  "refund has been sent",
  "sent your refund",
  "sent the refund",
  "i've refunded",
  "i’ve refunded",
  "i have refunded",
  "i refunded",
  "we refunded",
];

function completedRefundActionPhrases(amount?: string): string[] {
  return [
    ...COMPLETED_REFUND_ACTION_PHRASES,
    ...(amount
      ? [
          `of ${amount} has been sent`,
          `of ${amount} was sent`,
        ]
      : []),
  ];
}
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function refundAmountEvidencePhrases(amount: string): string[] {
  return [
    `${amount} refund`,
    `full refund of ${amount} has`,
    `full refund of ${amount} was`,
    `refund amount is ${amount}.`,
    `refund amount is ${amount},`,
    `refund is ${amount}.`,
    `refund is ${amount},`,
  ];
}

function compileTimelineRequirement(
  learnerText: string,
  option: ReturnType<typeof detectedResolutionOption> = detectedResolutionOption(learnerText),
): ChatAdvanceRequirementDraft | undefined {
  const timelineId = `${option ?? "outcome"}_timeline`;
  const businessDayRange = learnerText.match(/\b(\d+)\s*(-|–|to)\s*(\d+)\s+((?:business[\s-]*)?days?)\b/iu);
  if (businessDayRange) {
    const normalizedUnit = businessDayRange[4].toLowerCase().replace(/-/gu, " ").replace(/\s+/gu, " ");
    const unit = normalizedUnit.startsWith("business") ? "business days" : "days";
    const asciiRange = `${businessDayRange[1]}-${businessDayRange[3]} ${unit}`;
    const enDashRange = `${businessDayRange[1]}–${businessDayRange[3]} ${unit}`;
    const toRange = `${businessDayRange[1]} to ${businessDayRange[3]} ${unit}`;
    const lowerWord = NUMBER_WORDS[Number(businessDayRange[1])];
    const upperWord = NUMBER_WORDS[Number(businessDayRange[3])];
    const wordRange = lowerWord && upperWord ? `${lowerWord} to ${upperWord} ${unit}` : "";
    return { id: timelineId, phrases: [asciiRange, enDashRange, toRange, wordRange].filter(Boolean) };
  }

  const quantified = learnerText.match(/\b(\d+)\s+(business days?|days?|hours?|weeks?)\b/iu);
  if (quantified) {
    const unit = quantified[2].toLowerCase();
    const singularUnit = unit
      .replace(/days$/u, "day")
      .replace(/hours$/u, "hour")
      .replace(/weeks$/u, "week");
    return {
      id: timelineId,
      phrases: [`${quantified[1]} ${unit}`, `${quantified[1]}-${singularUnit}`],
    };
  }

  const normalized = normalizeComparableText(learnerText);
  if (/\bend of day\b/u.test(normalized)) {
    return { id: timelineId, phrases: ["end of day", "by end of day"] };
  }
  const namedDay = normalized.match(/\b(today|tomorrow)\b/u)?.[1];
  return namedDay
    ? { id: timelineId, phrases: [namedDay, `by ${namedDay}`] }
    : undefined;
}

function appendUniquePhrases(existing: string[], aliases: string[]): string[] {
  const merged = [...existing];
  const seen = new Set(existing.map((phrase) => phrase.trim().toLowerCase()).filter(Boolean));
  aliases.forEach((phrase) => {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized || seen.has(normalized) || [...seen].some((candidate) => normalized.includes(candidate))) return;
    seen.add(normalized);
    merged.push(phrase);
  });
  return merged;
}

function inferredChatRequirementConceptFromPhrases(
  phrases: string[],
): ChatRequirementConcept | undefined {
  const candidates = phrases.map((phrase) => phrase.trim().toLowerCase()).filter(Boolean);
  if (!candidates.length) return undefined;

  if (candidates.every((phrase) => /^(?:sorry (?:the|about)|understand the)\b/u.test(phrase))) {
    return "empathy";
  }
  if (candidates.every((phrase) =>
    /^(?:would you like|do you want|would you prefer|can i|may i)\b/u.test(phrase)
  )) {
    return "question_intent";
  }
  if (candidates.every((phrase) =>
    /^(?:like|prefer|want)\b.*\b(?:exchange|refund|replacement|store credit)\b/u.test(phrase)
  )) {
    return "preference";
  }
  if (candidates.every((phrase) => /^original (?:card|payment card|payment method)$/u.test(phrase))) {
    return "destination";
  }
  if (candidates.every((phrase) =>
    /^\d+\s*(?:-|–|to)\s*\d+\s+(?:business days?|days?|hours?|weeks?)$/u.test(phrase)
  )) {
    return "timeline";
  }
  if (candidates.every((phrase) =>
    /^(?:(?:issued|processed) the \$?\d+\.\d{2} refund|refunded \$?\d+\.\d{2})$/u.test(phrase)
  )) {
    return "completion";
  }
  if (candidates.every((phrase) => /^(?:issued|processed|refunded|completed|sent)$/u.test(phrase))) {
    return "completion";
  }
  if (candidates.every((phrase) => /^\$?\d+\.\d{2}$/u.test(phrase))) return "amount";
  if (candidates.every((phrase) => phrase === "refund")) return "refund";
  return undefined;
}

/**
 * Enrich recognized persisted Chat requirements with the same compact aliases
 * used for newly generated gates. Saved creator phrases and unknown groups are
 * authoritative and remain untouched; aliases are only appended.
 */
export function mergeSafeChatAdvanceRequirementAliases(
  requirements: ChatAdvanceRequirementDraft[],
): ChatAdvanceRequirementDraft[] {
  const merged: ChatAdvanceRequirementDraft[] = [];
  const appendRequirement = (requirement: ChatAdvanceRequirementDraft) => {
    const existing = merged.find((candidate) => candidate.id === requirement.id);
    if (existing) {
      existing.phrases = appendUniquePhrases(existing.phrases, requirement.phrases);
      return;
    }
    merged.push(requirement);
  };

  requirements.forEach((requirement) => {
    const explicitConcept = chatRequirementConcept(requirement.id);
    const inferredConcept = inferredChatRequirementConceptFromPhrases(requirement.phrases);
    const concept = explicitConcept ?? inferredConcept;
    if (!concept) {
      appendRequirement(requirement);
      return;
    }

    const requirementText = `${requirement.id} ${requirement.phrases.join(" ")}`;
    let retainedPhrases = requirement.phrases;
    let aliases: string[] = [];
    const before: ChatAdvanceRequirementDraft[] = [];
    if (concept === "empathy") {
      aliases = NATURAL_EMPATHY_PHRASES;
      if (!explicitConcept && inferredConcept === "empathy") retainedPhrases = [];
      retainedPhrases = retainedPhrases.filter((phrase) =>
        !/^(?:acknowledge|concern|empathy|frustrating|sorry|understand|understand the|i see)$/iu.test(phrase.trim())
      );
    } else if (concept === "question_intent") {
      aliases = QUESTION_INTENT_PHRASES;
      retainedPhrases = retainedPhrases.filter((phrase) => !/^(?:can i|may i)$/iu.test(phrase.trim()));
    } else if (concept === "preference") {
      const option = detectedResolutionOption(requirementText);
      aliases = option === "refund"
        ? ["refund"]
        : option === "credit"
          ? ["store credit"]
          : option
            ? [option]
            : [];
      if (option) {
        before.push({
          id: `${option}_question_intent`,
          phrases: QUESTION_INTENT_PHRASES,
        });
      }
    } else if (concept === "destination") {
      const phraseText = normalizeComparableText(requirement.phrases.join(" "));
      aliases = /\boriginal (?:payment(?: card| method)?|card)\b/u.test(phraseText)
        ? ["original card", "original payment card"]
        : [];
    } else if (concept === "timeline") {
      aliases = compileTimelineRequirement(requirement.phrases.join(" "))?.phrases ?? [];
    } else if (concept === "completion" && detectedResolutionOption(requirementText) === "refund") {
      const amount = requirementText.match(/\$\s*\d+\.\d{2}\b/u)?.[0]?.replace(/\s+/gu, "");
      aliases = completedRefundActionPhrases(amount);
      if (amount) {
        before.push({ id: "refund_amount", phrases: refundAmountEvidencePhrases(amount) });
      }
    } else if (concept === "amount") {
      const amount = requirementText.match(/\$\s*\d+\.\d{2}\b/u)?.[0]?.replace(/\s+/gu, "")
        ?? requirementText.match(/\b\d+\.\d{2}\b/u)?.[0];
      const currencyAmount = amount ? (amount.startsWith("$") ? amount : `$${amount}`) : "";
      aliases = currencyAmount ? refundAmountEvidencePhrases(currencyAmount) : [];
      retainedPhrases = [];
    } else if (concept === "refund") {
      aliases = ["refund"];
    }

    const phrases = appendUniquePhrases(retainedPhrases, aliases);
    before.forEach(appendRequirement);
    const phrasesUnchanged = phrases.length === requirement.phrases.length
      && phrases.every((phrase, index) => phrase === requirement.phrases[index]);
    appendRequirement(phrasesUnchanged ? requirement : { ...requirement, phrases });
  });
  return merged;
}

function learnerActionClauseHasCompilableGateConcept(clause: string): boolean {
  const normalized = normalizeComparableText(clause);
  if (!normalized) return true;
  if (/\b(?:acknowledge\w*|apolog\w*|empath\w*|express understanding|recognize\w*)\b/u.test(normalized)) return true;
  const option = detectedResolutionOption(clause);
  if (option && /\b(?:ask\w*|clarif\w*|confirm\w*|determin\w*|prefer\w*|verif\w*|want|whether)\b/u.test(normalized)) return true;
  if (/\$\s*\d+\.\d{2}\b/u.test(clause)) return true;
  if (/\boriginal (?:payment(?: card| method)?|card)\b/u.test(normalized)) return true;
  if (compileTimelineRequirement(clause)) return true;
  const operationalConcepts = phaseOperationalConcepts([clause]);
  return operationalConcepts.has("refund")
    || operationalConcepts.has("replacement")
    || /\b(?:creat\w*|plac\w*|send\w*|sent|submi\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/u.test(normalized);
}

function compileOperationalCompletionRequirement(
  learnerText: string,
  amount?: string,
): ChatAdvanceRequirementDraft | undefined {
  const operationalConcepts = phaseOperationalConcepts([learnerText]);
  if (operationalConcepts.has("refund")) {
    return {
      id: "refund_completion",
      phrases: completedRefundActionPhrases(amount),
    };
  }
  const normalized = normalizeComparableText(learnerText);
  const hasReplacementOperation = operationalConcepts.has("replacement")
    || /\b(?:creat\w*|plac\w*|send\w*|sent|submi\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/u.test(normalized);
  if (!hasReplacementOperation) return undefined;

  const outcome = /\breship\w*\b/u.test(normalized) ? "reshipment" : "replacement";
  return /\b(?:plac\w*|submit\w*|send|sent)\b/u.test(normalized)
    ? {
        id: `${outcome}_completion`,
        phrases: [`placed the ${outcome} order`, `submitted the ${outcome} order`],
      }
    : {
        id: `${outcome}_completion`,
        phrases: [`issued the ${outcome}`, `processed the ${outcome}`],
      };
}

/**
 * Compile the small set of quality-critical Chat concepts that Rise evaluates
 * with literal substring matching. Valid unrecognized provider groups are kept,
 * but unsafe provider wording never survives this fallback.
 */
export function compileSafeChatAdvanceRequirements(
  phase: PhaseDraft,
  prohibitedActions: string[],
  customerName: string,
): ChatAdvanceRequirementDraft[] | undefined {
  const learnerText = phase.learnerActions.join(" ");
  const normalized = normalizeComparableText(learnerText);
  const compiled: ChatAdvanceRequirementDraft[] = [];
  const option = detectedResolutionOption(learnerText);
  const amount = learnerText.match(/\$\s*\d+\.\d{2}\b/u)?.[0]?.replace(/\s+/gu, "");
  const completion = compileOperationalCompletionRequirement(learnerText, amount);

  if (/\b(?:acknowledge\w*|apolog\w*|empath\w*|express understanding|recognize\w*)\b/u.test(normalized)) {
    compiled.push({ id: "acknowledge_empathy", phrases: NATURAL_EMPATHY_PHRASES });
  }
  if (option && /\b(?:ask\w*|clarif\w*|confirm\w*|determin\w*|prefer\w*|verif\w*|want|whether)\b/u.test(normalized)) {
    compiled.push({ id: `${option}_question_intent`, phrases: QUESTION_INTENT_PHRASES });
    if (!completion) {
      compiled.push({
        id: option === "refund" ? "refund" : `${option}_resolution`,
        phrases: option === "refund"
          ? ["refund"]
          : option === "credit"
            ? ["store credit"]
            : [option],
      });
    }
  }

  if (amount) {
    compiled.push({ id: `${option ?? "outcome"}_amount`, phrases: refundAmountEvidencePhrases(amount) });
  }
  if (/\boriginal (?:payment(?: card| method)?|card)\b/u.test(normalized)) {
    compiled.push({ id: "refund_destination", phrases: ["original card", "original payment card"] });
  }
  const timeline = compileTimelineRequirement(learnerText, option);
  if (timeline) compiled.push(timeline);
  if (completion) compiled.push(completion);

  const actionClauses = phase.learnerActions.flatMap((action) =>
    action.split(/[,;!?]+|(?<!\d)\.(?!\d)|\b(?:and then|then|and|before|after|while)\b/iu)
  );
  if (actionClauses.some((clause) => !learnerActionClauseHasCompilableGateConcept(clause))) return undefined;

  const phaseFindings = findChatAdvanceRequirementQualityFindings(
    phase.chatAdvanceRequirements ?? [],
    prohibitedActions,
    customerName,
  );
  const unsafeRequirementIndexes = new Set(phaseFindings.map((finding) => finding.requirementIndex));
  const unsafeUnknown = (phase.chatAdvanceRequirements ?? []).some((requirement, requirementIndex) =>
    unsafeRequirementIndexes.has(requirementIndex)
    && chatRequirementConcept(requirement.id) === undefined
  );
  if (unsafeUnknown) return undefined;

  const compiledConcepts = new Set(compiled.map((requirement) => chatRequirementConcept(requirement.id)));
  if (compiledConcepts.has("question_intent") && option) compiledConcepts.add("preference");
  const hasUnrepairedKnownConcept = (phase.chatAdvanceRequirements ?? []).some((requirement, requirementIndex) => {
    if (!unsafeRequirementIndexes.has(requirementIndex)) return false;
    const concept = chatRequirementConcept(requirement.id);
    return concept !== undefined && !compiledConcepts.has(concept);
  });
  if (hasUnrepairedKnownConcept) return undefined;

  const safeUnknown = (phase.chatAdvanceRequirements ?? []).filter((requirement, requirementIndex) =>
    !unsafeRequirementIndexes.has(requirementIndex)
    && chatRequirementConcept(requirement.id) === undefined
  );
  let candidate = [...compiled, ...safeUnknown];
  if (candidate.length
    && findChatAdvanceRequirementQualityFindings(candidate, prohibitedActions, customerName).length === 0) {
    return candidate;
  }
  candidate = compiled;
  return candidate.length
    && findChatAdvanceRequirementQualityFindings(candidate, prohibitedActions, customerName).length === 0
    ? candidate
    : undefined;
}

export type ChatAdvanceCompilationFailureCode =
  | "unsupported_action_clause"
  | "unsafe_unknown_requirement"
  | "unrepaired_known_or_candidate_quality";

export function chatAdvanceCompilationFailureCode(
  phase: PhaseDraft,
  prohibitedActions: string[],
  customerName: string,
): ChatAdvanceCompilationFailureCode | undefined {
  const actionClauses = phase.learnerActions.flatMap((action) =>
    action.split(/[,;!?]+|(?<!\d)\.(?!\d)|\b(?:and then|then|and|before|after|while)\b/iu)
  );
  if (actionClauses.some((clause) => !learnerActionClauseHasCompilableGateConcept(clause))) {
    return "unsupported_action_clause";
  }
  const findings = findChatAdvanceRequirementQualityFindings(
    phase.chatAdvanceRequirements ?? [],
    prohibitedActions,
    customerName,
  );
  const unsafeRequirementIndexes = new Set(findings.map((finding) => finding.requirementIndex));
  if ((phase.chatAdvanceRequirements ?? []).some((requirement, requirementIndex) =>
    unsafeRequirementIndexes.has(requirementIndex)
    && chatRequirementConcept(requirement.id) === undefined
  )) {
    return "unsafe_unknown_requirement";
  }
  return compileSafeChatAdvanceRequirements(phase, prohibitedActions, customerName)
    ? undefined
    : "unrepaired_known_or_candidate_quality";
}

export function operationalCriterionMatchingPhaseIndexes(
  criterion: string,
  phases: PhaseDraft[],
): number[] | undefined {
  const concept = operationalCriterionConcept(criterion);
  if (!concept) return undefined;
  return phases.flatMap((phase, phaseIndex) => {
    const phaseConcepts = phaseOperationalConcepts(phase.learnerActions);
    return phaseConcepts.has(concept) || (concept === "outcome" && phaseConcepts.size > 0) ? [phaseIndex] : [];
  });
}

export interface OperationalCriterionCoverageFinding {
  objectiveIndex: number;
  criterionIndex: number;
  matchingPhaseIndexes: number[];
}

export function findOperationalCriterionCoverageFindings(
  objectives: ObjectiveDraft[],
  phases: PhaseDraft[],
): OperationalCriterionCoverageFinding[] {
  return objectives.flatMap((objective, objectiveIndex) =>
    objective.criteria.flatMap((criterion, criterionIndex) => {
      const matchingPhaseIndexes = operationalCriterionMatchingPhaseIndexes(criterion, phases);
      if (matchingPhaseIndexes === undefined || matchingPhaseIndexes.length === 1) return [];
      return [{ objectiveIndex, criterionIndex, matchingPhaseIndexes }];
    })
  );
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

interface ResolutionProhibitionCandidate {
  index: number;
}

const NEGATIVE_RESOLUTION_PRESENTATION = /^(?:(?:do not|dont|never)\s+(?:creat\w*|giv\w*|issu\w*|mention\w*|offer\w*|present\w*|propos\w*|provid\w*|recommend\w*|select\w*|send\w*|suggest\w*|us(?:e|es|ed|ing))|avoid(?:\s+(?:creat\w*|giv\w*|issu\w*|mention\w*|offer\w*|present\w*|propos\w*|provid\w*|recommend\w*|select\w*|send\w*|suggest\w*|us(?:e|es|ed|ing)))?)\b/u;
const DISTINCT_REFUND_CONSTRAINT = /\b(?:incorrect (?:refund )?amount|partial refund|wrong (?:refund )?amount)\b/u;
const OTHER_THAN_FULL_REFUND = /\b(?:alternatives?|options?)\s+(?:other than|to)\s+(?:a )?full refund\b/u;
const REPLACEMENT_DETAIL_ONLY = /\b(?:replacement|reshipment)\s+(?:(?:arrival|delivery|shipping|tracking)\s+(?:date|details?|estimate|information|status|timeline|timeframe|window)|(?:arrival|date|delivery|details?|estimate|information|order confirmation|shipping|status|timeline|timeframe|tracking|window))\b/u;

function resolutionProhibitionCandidate(action: string, index: number): ResolutionProhibitionCandidate | undefined {
  const normalized = normalizeComparableText(action);
  if (!NEGATIVE_RESOLUTION_PRESENTATION.test(normalized) || DISTINCT_REFUND_CONSTRAINT.test(normalized)) return undefined;
  const namesAlternative = /\bstore credit\b/u.test(normalized)
    || /\bexchang(?:e|es|ed|ing)\b/u.test(normalized)
    || (/\b(?:replac(?:e|es|ed|ing|ement|ements)|reship(?:s|ped|ping|ment|ments)?)\b/u.test(normalized)
      && !REPLACEMENT_DETAIL_ONLY.test(normalized));
  return namesAlternative || OTHER_THAN_FULL_REFUND.test(normalized) ? { index } : undefined;
}

export function prohibitedResolutionAlternativeGatePhrases(
  actions: string[],
  customerName?: string,
): string[] {
  const phrases = new Set<string>();
  actions.forEach((action) => {
    const inheritedNegative = DIRECT_NEGATIVE_SEQUENCE_START.test(normalizeComparableText(action));
    splitProhibitedActionClauses(action).forEach((clause) => {
      const normalizedWithPolarity = normalizeComparableText(clause);
      const explicitlyNegative = DIRECT_NEGATIVE_SEQUENCE_START.test(normalizedWithPolarity);
      if (!inheritedNegative && !explicitlyNegative) return;
      if (earnedPreferenceSequenceOption(clause, inheritedNegative, customerName)) return;

      const normalized = normalizedWithPolarity
        .replace(/^(?:do not|dont|never|avoid)\s+/, "")
        .trim();
      if (!normalized) return;
      if (OTHER_THAN_FULL_REFUND.test(normalizedWithPolarity)) {
        ["store credit", "partial refund", "replace", "reship", "exchange"].forEach((phrase) => phrases.add(phrase));
        return;
      }
      if (prohibitionAllowlistConstraints(clause).length > 0) return;
      const effectiveNegativeClause = explicitlyNegative ? clause : `Do not ${clause}`;
      const options = resolutionOptionConcepts(intentTokens(normalized));
      const canonicalOptionPhrases = () => {
        if (options.has("credit")) phrases.add("store credit");
        if (options.has("replacement")) {
          if (/\breplac\w*\b/u.test(normalized)) phrases.add("replace");
          if (/\breship\w*\b/u.test(normalized)) phrases.add("reship");
        }
        if (options.has("exchange")) phrases.add("exchange");
        if (options.has("refund")) phrases.add("refund");
      };

      if (safeResolutionOperationClause(normalized, customerName)) {
        canonicalOptionPhrases();
        return;
      }

      const communicationPhrases = resolutionCommunicationGatePhrases(normalized);
      if (communicationPhrases.length > 0) {
        communicationPhrases.forEach((phrase) => phrases.add(phrase));
        return;
      }

      if (resolutionProhibitionCandidate(effectiveNegativeClause, 0)) {
        if (options.has("credit")) phrases.add("store credit");
        if (options.has("replacement")) {
          if (/\breplac\w*\b/u.test(normalized)) phrases.add("replace");
          if (/\breship\w*\b/u.test(normalized)) phrases.add("reship");
        }
        if (options.has("exchange")) phrases.add("exchange");
        return;
      }

      if (options.size > 0 && RESOLUTION_REFERENCE_CLAUSE_START.test(normalized)) {
        resolutionReferenceGatePhrases(normalized).forEach((phrase) => phrases.add(phrase));
      }
    });
  });
  return [...phrases];
}

export function findOverlappingResolutionProhibitionGroups(actions: string[]): number[][] {
  const candidates = actions
    .map(resolutionProhibitionCandidate)
    .filter((candidate): candidate is ResolutionProhibitionCandidate => Boolean(candidate));
  return candidates.length > 1 ? [candidates.map(({ index }) => index)] : [];
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
