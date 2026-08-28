export interface PrivacyIssue {
  code: string;
  path: string;
}

export interface PrivacyOptions {
  allowFrom?: unknown;
  allowances?: Array<{ value: unknown; codes?: string[]; stringsOnly?: boolean }>;
}

interface PrivacyMatch {
  code: string;
  match: string;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4})\b/g;
const STREET_PATTERN = /\b\d{1,6}\s+[A-Z0-9.'-]+(?:\s+[A-Z0-9.'-]+){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY)\b/gi;
const PAYMENT_CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>'"]+/gi;
const SERVICE_LOCATOR_PATTERN = /(?:\bs3:\/\/[^\s<>'"]+|\barn:(?:aws[a-z-]*):[^\s<>'"]+|\b(?:x-amz-(?:signature|credential|security-token)|awsaccesskeyid)=[^\s&<>'"]+)/gi;
const LABELED_IDENTIFIER_PATTERN = /\b(?:order|account|case|ticket|tracking|prescription|rx)(?:\s*(?:number|no\.?|#|id|identifier|code))?\s*[:#-]?\s*(?=[a-z0-9-]{6,}\b)(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]{5,}\b/gi;
const JSON_IDENTIFIER_PATTERN = /["'](?:order|account|case|ticket|tracking|prescription|rx)(?:_|-)?(?:id|number|no)["']\s*:\s*["'][^"']{4,}["']/gi;
const UPS_TRACKING_PATTERN = /\b1Z[A-Z0-9]{16}\b/gi;
const LABELED_LAST_FOUR_PATTERN = /\b(?:payment|card)\s*(?:last\s*)?(?:four|4|ending)\s*[:#-]?\s*\d{4}\b/gi;

const SERVICE_IDENTIFIER_KEYS = new Set([
  "orderid", "ordernumber", "orderno", "accountid", "accountnumber", "accountno",
  "caseid", "casenumber", "caseno", "ticketid", "ticketnumber", "ticketno",
  "trackingid", "trackingnumber", "trackingno", "prescriptionid", "prescriptionnumber",
  "prescriptionno", "rxid", "rxnumber", "rxno",
]);

const PAYMENT_LAST_FOUR_KEYS = new Set([
  "paymentlastfour", "cardlastfour", "paymentlast4", "cardlast4", "paymentending", "cardending",
]);

export function findPrivacyIssues(value: unknown, options: PrivacyOptions = {}): PrivacyIssue[] {
  const issues: PrivacyIssue[] = [];
  const allowed = collectAllowedMatches(options.allowFrom);
  for (const allowance of options.allowances ?? []) {
    mergeAllowedMatches(allowed, collectAllowedMatches(allowance.value, allowance.codes, allowance.stringsOnly));
  }

  walkStrings(value, (text, path) => {
    const matchesByCode = groupMatches(privacyMatches(text, path));
    for (const [code, matches] of matchesByCode) {
      const allowedMatches = allowed.get(code);
      if (matches.every((match) => allowedMatches?.has(normalizeMatch(match)))) continue;
      issues.push({ code, path });
    }
  });

  return uniqueIssues(issues);
}

export function redactPrivacyValues(value: unknown): unknown {
  return redactValue(value, "");
}

export function redactPrivacyText(text: string): string {
  const replacements = new Map<string, string>();
  for (const finding of privacyMatches(text, "value")) {
    replacements.set(finding.match, privacyPlaceholder(finding.code));
  }
  return [...replacements.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [match, replacement]) => result.split(match).join(replacement), text);
}

function redactValue(value: unknown, path: string): unknown {
  if (typeof value === "string" || typeof value === "number") {
    return privacyCodes(String(value), path || "value").length > 0 ? "[redacted imported detail]" : value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => redactValue(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry], index) => {
    const safeKey = privacyMatches(key, "[object-key]").length > 0 ? `redacted_imported_key_${index + 1}` : key;
    return [safeKey, redactValue(entry, path ? `${path}.${safeKey}` : safeKey)];
  }));
}

function privacyCodes(text: string, path: string): string[] {
  return [...new Set(privacyMatches(text, path).map(({ code }) => code))];
}

function privacyMatches(text: string, path: string): PrivacyMatch[] {
  const findings: PrivacyMatch[] = [];
  const pathKey = lastPathKey(path);
  if (SERVICE_IDENTIFIER_KEYS.has(pathKey) && text.trim()) findings.push({ code: "service_identifier", match: text.trim() });
  if (PAYMENT_LAST_FOUR_KEYS.has(pathKey) && /\d{4}/.test(text)) findings.push({ code: "payment_last_four", match: text.trim() });
  for (const match of unapprovedEmails(text)) findings.push({ code: "email_address", match });
  for (const match of unapprovedPhones(text)) findings.push({ code: "phone_number", match });
  for (const match of matches(STREET_PATTERN, text).filter((candidate) => !isReservedFictionalStreetAddress(candidate))) {
    findings.push({ code: "street_address", match });
  }
  addPatternMatches(findings, "payment_card", PAYMENT_CARD_PATTERN, text);
  addPatternMatches(findings, "url", URL_PATTERN, text);
  addPatternMatches(findings, "service_locator", SERVICE_LOCATOR_PATTERN, text);
  addPatternMatches(findings, "service_identifier", LABELED_IDENTIFIER_PATTERN, text);
  addPatternMatches(findings, "service_identifier", JSON_IDENTIFIER_PATTERN, text);
  addPatternMatches(findings, "service_identifier", UPS_TRACKING_PATTERN, text);
  addPatternMatches(findings, "payment_last_four", LABELED_LAST_FOUR_PATTERN, text);
  return findings;
}

function unapprovedEmails(text: string): string[] {
  return matches(EMAIL_PATTERN, text).filter((match) => {
    const domain = match.slice(match.lastIndexOf("@") + 1).toLowerCase();
    return domain !== "example.com" && domain !== "example.org" && domain !== "example.net";
  });
}

function unapprovedPhones(text: string): string[] {
  return matches(PHONE_PATTERN, text).filter((match) => !isReservedFictionalPhone(match));
}

function isReservedFictionalPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length === 7 && digits.startsWith("55501")) return true;
  return digits.length === 10 && digits.slice(3, 6) === "555" && /^01\d{2}$/.test(digits.slice(6));
}

function isReservedFictionalStreetAddress(value: string): boolean {
  return /\b(?:example|fictional|sample|test|demo)\b/i.test(value);
}

function matches(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function addPatternMatches(findings: PrivacyMatch[], code: string, pattern: RegExp, text: string): void {
  for (const match of matches(pattern, text)) findings.push({ code, match });
}

function walkStrings(value: unknown, visit: (text: string, path: string, kind: "string" | "number" | "key") => void): void {
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: "" }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (typeof current.value === "string" || typeof current.value === "number") {
      visit(String(current.value), current.path || "value", typeof current.value === "number" ? "number" : "string");
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], path: `${current.path}[${index}]` });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, entry] = entries[index];
      if (privacyMatches(key, "[object-key]").length > 0) visit(key, current.path ? `${current.path}.[object-key]` : "[object-key]", "key");
      stack.push({ value: entry, path: current.path ? `${current.path}.${key}` : key });
    }
  }
}

function lastPathKey(path: string): string {
  const segment = path.split(".").at(-1)?.replace(/\[\d+\]$/g, "") ?? "";
  return segment.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function uniqueIssues(issues: PrivacyIssue[]): PrivacyIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectAllowedMatches(value: unknown, codes?: string[], stringsOnly = false): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>();
  if (value === undefined) return allowed;
  const includedCodes = codes ? new Set(codes) : null;
  walkStrings(value, (text, path, kind) => {
    if (stringsOnly && kind !== "string") return;
    for (const finding of privacyMatches(text, path)) {
      if (includedCodes && !includedCodes.has(finding.code)) continue;
      const matchesForCode = allowed.get(finding.code) ?? new Set<string>();
      matchesForCode.add(normalizeMatch(finding.match));
      allowed.set(finding.code, matchesForCode);
    }
  });
  return allowed;
}

function mergeAllowedMatches(target: Map<string, Set<string>>, source: Map<string, Set<string>>): void {
  for (const [code, matches] of source) {
    const targetMatches = target.get(code) ?? new Set<string>();
    for (const match of matches) targetMatches.add(match);
    target.set(code, targetMatches);
  }
}

function groupMatches(findings: PrivacyMatch[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const finding of findings) grouped.set(finding.code, [...(grouped.get(finding.code) ?? []), finding.match]);
  return grouped;
}

function normalizeMatch(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function privacyPlaceholder(code: string): string {
  return ({
    email_address: "[de-identified email]",
    phone_number: "[de-identified phone]",
    street_address: "[fictional address]",
    payment_card: "[de-identified payment card]",
    payment_last_four: "[fictional payment last four]",
    service_identifier: "[fictional service identifier]",
    service_locator: "[removed service locator]",
    url: "[approved public link omitted from source context]",
  } as Record<string, string>)[code] ?? "[redacted imported detail]";
}
