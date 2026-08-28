import library from "./hotkey-library.json" with { type: "json" };

import type { StandardTextDraft } from "./scenario-contract";

interface RecommendationInput {
  agentType: "Core" | "Rx";
  title: string;
  description: string;
  learnerGoal: string;
  topic: string;
  subtopic: string;
  correctProcess: string[];
}

export interface HotkeyRecord {
  agent_role: string;
  category: string;
  hotkey: string;
  canned_text: string;
  placeholders: string[];
  search_text: string;
}

export function recommendStandardText(input: RecommendationInput, limit = 3): StandardTextDraft[] {
  const contextText = [
    input.title,
    input.description,
    input.learnerGoal,
    input.topic,
    input.subtopic,
    ...input.correctProcess,
  ].join(" ");
  const context = tokens(contextText);
  const requiredAnchors = policyAnchors(contextText);
  if (requiredAnchors.size === 0) return [];
  const role = input.agentType.toLowerCase();
  const ranked = (library.records as HotkeyRecord[])
    .filter((record) => record.agent_role.toLowerCase() === role)
    .map((record, index) => {
      const candidateTokens = tokens(record.search_text);
      const matches = overlap(context, candidateTokens);
      const categoryMatches = overlap(context, tokens(record.category));
      const categoryAnchors = policyAnchors(record.category);
      const candidateAnchors = policyAnchors(`${record.category} ${record.canned_text}`);
      const cannedAnchors = policyAnchors(record.canned_text);
      return { record, index, score: overlapScore(matches), matchCount: matches.size, categoryMatchCount: categoryMatches.size, categoryAnchors, candidateAnchors, cannedAnchors };
    })
    .filter(({ matchCount, categoryMatchCount, categoryAnchors, candidateAnchors, cannedAnchors }) => (
      (categoryMatchCount > 0 || matchCount >= 2)
      && categoryAnchors.size > 0
      && intersects(requiredAnchors, categoryAnchors)
      && intersects(requiredAnchors, candidateAnchors)
      && intersects(requiredAnchors, cannedAnchors)
      && [...cannedAnchors].every((anchor) => !EXCLUSIVE_POLICY_ANCHORS.has(anchor) || requiredAnchors.has(anchor))
      && [...categoryAnchors].every((anchor) => !SPECIALIZED_CATEGORY_ANCHORS.has(anchor) || requiredAnchors.has(anchor))
      && (!requiredAnchors.has("address") || cannedAnchors.has("address"))
    ))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(3, limit)));

  return ranked.map(({ record }) => ({
    hotkey: record.hotkey,
    category: record.category,
    template: record.canned_text,
    insertionMoment: insertionMoment(record.category),
    customization: record.placeholders.length > 0
      ? `Replace ${record.placeholders.join(", ")} with the correct fictional or de-identified scenario details.`
      : "Review the response for fit before sending; no library placeholders are required.",
    notes: ["Recommended from the approved Standard Text library."],
    approvedGuidance: "",
    recommendationReason: `Matches the ${input.topic} / ${input.subtopic} scenario and ${record.category.toLowerCase()} step.`,
  }));
}

export function approvedStandardTextPrivacySource(items: StandardTextDraft[]): HotkeyRecord[] {
  return (library.records as HotkeyRecord[]).filter((record) => items.some((item) => (
    item.hotkey.trim().toLowerCase() === record.hotkey.trim().toLowerCase()
    && item.template === record.canned_text
  )));
}

export function recommendImportedStandardText(items: StandardTextDraft[], profile: "core" | "rx", limit = 3): StandardTextDraft[] {
  const records = library.records as HotkeyRecord[];
  return items.flatMap((item) => {
    const record = records.find((candidate) => candidate.agent_role === profile && candidate.hotkey.toLowerCase() === item.hotkey.trim().toLowerCase());
    if (!record) return [];
    return [{
      hotkey: record.hotkey,
      category: record.category,
      template: record.canned_text,
      insertionMoment: item.insertionMoment,
      customization: record.placeholders.length > 0
        ? `Replace ${record.placeholders.join(", ")} with the correct fictional or de-identified scenario details.`
        : item.customization,
      notes: ["Recommended from the current approved Standard Text library for the uploaded scenario's hotkey."],
      approvedGuidance: "",
      recommendationReason: "Matches the approved hotkey already used by the uploaded scenario; the response is refreshed from the current library.",
    }];
  }).slice(0, Math.max(1, Math.min(3, limit)));
}

function overlap(context: Set<string>, candidate: Set<string>): Set<string> {
  return new Set([...candidate].filter((token) => context.has(token)));
}

function overlapScore(matches: Set<string>): number {
  let score = 0;
  for (const token of matches) score += token.length >= 7 ? 3 : 1;
  return score;
}

function tokens(value: string): Set<string> {
  const stopWords = new Set(["about", "after", "again", "also", "and", "are", "before", "but", "chewy", "conversation", "customer", "for", "from", "have", "help", "into", "just", "learner", "practice", "scenario", "support", "that", "the", "their", "this", "with", "you", "your"]);
  return new Set((value.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length > 2 && !stopWords.has(token)));
}

function insertionMoment(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes("greeting")) return "Use after the customer opens the chat and before investigating the issue.";
  if (normalized.includes("ending") || normalized.includes("close")) return "Use after the solution and next steps are confirmed, immediately before ending the chat.";
  if (normalized.includes("empathy") || normalized.includes("apology")) return "Use after the customer explains the concern and before moving into the solution.";
  return "Use when the learner reaches the matching approved step in the conversation.";
}

const EXCLUSIVE_POLICY_ANCHORS = new Set(["address", "autoship", "cancel", "coupon", "dropship", "exchange", "fresh_frozen", "pharmacy", "pricing", "profile", "replacement", "return", "transfer"]);
const SPECIALIZED_CATEGORY_ANCHORS = new Set(["address", "autoship", "dropship", "fresh_frozen", "pharmacy", "pricing", "profile"]);

function policyAnchors(value: string): Set<string> {
  const patterns: Array<[string, RegExp]> = [
    ["address", /\b(?:address|mailing location)\b/i],
    ["autoship", /\bautoship\b/i],
    ["cancel", /\bcancel(?:led|ing|ation)?\b/i],
    ["closing", /\b(?:closing|ending|goodbye|end the chat|anything else)\b/i],
    ["coupon", /\b(?:coupon|promotion|promo code)\b/i],
    ["delivery", /\b(?:deliver(?:y|ed|ies)|ship(?:ping|ped|ment)?|tracking|late|delay(?:ed)?)\b/i],
    ["dropship", /\bdrop[- ]?ship(?:ped|ping)?\b/i],
    ["empathy", /\b(?:empathy|apolog(?:y|ize)|acknowledge the concern)\b/i],
    ["exchange", /\b(?:exchanges?|even exchanges?)\b/i],
    ["fresh_frozen", /\b(?:fresh|frozen|dry ice|refrigerat(?:ed|ion))\b/i],
    ["greeting", /\b(?:greeting|introduction|monitoring and recording)\b/i],
    ["pharmacy", /\b(?:pharmacy|prescription|medication|veterinarian|clinic)\b/i],
    ["pricing", /\b(?:price match|price adjustment|pricing)\b/i],
    ["profile", /\bpet profile\b/i],
    ["refund", /\b(?:refund(?:ed|ing)?|reimburse(?:d|ment)?)\b/i],
    ["replacement", /\b(?:replacement|replace(?:d|ment)?|reship)\b/i],
    ["return", /\b(?:return label|send (?:the )?.* back|returned to us|(?:set up|create|process(?:ed|ing)?) a return|return (?:this|the) item)\b/i],
    ["transfer", /\b(?:transfer|connect(?:ed|ing)? (?:you|the customer) (?:with|to))\b/i],
  ];
  return new Set(patterns.filter(([, pattern]) => pattern.test(value)).map(([anchor]) => anchor));
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value));
}
