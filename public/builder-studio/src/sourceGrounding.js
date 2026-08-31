export const SOURCE_GROUNDING_VERSION = 1;

export const SOURCE_MAPPING_OPTIONS = [
  { id: "correct_handling", label: "Conversation Flow" },
  { id: "avoidances", label: "Conversation Flow cautions" },
  { id: "objectives", label: "Learning objectives and criteria" },
  { id: "guidance", label: "Coach Chewy Guidance" }
];

export const SOURCE_LIMITS = Object.freeze({
  maxDocuments: 5,
  maxDocumentCharacters: 120_000,
  maxTotalCharacters: 240_000,
  maxPassagesPerDocument: 60,
  maxPassageCharacters: 2_500
});

const SOURCE_MAPPING_IDS = new Set(SOURCE_MAPPING_OPTIONS.map((item) => item.id));
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/;
const STREET_ADDRESS = /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i;
const IDENTIFIER_TEXT = /\b(?:order|case|ticket|account|rx|prescription)[\s#:.-]*(?:id[\s#:.-]*)?(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/i;
const TRACKING_IDENTIFIER_TEXT = /\b(?:tracking|shipment)\s*(?:number|id|code|#)\s*[:#-]?\s*(?=[A-Z0-9-]{6,}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/i;
const PAYMENT_LAST_FOUR_TEXT = /\b(?:card|payment)(?:\s+[A-Z]+){0,4}\s+(?:last\s*(?:four|4)|ending(?:\s+in)?|ends?\s+in)\s*[:#-]?\s*\d{4}\b/i;
const STRUCTURED_IDENTIFIER_PAIR = /\b(?:order|account|case|ticket|rx|prescription|payment|card|tracking)[_\s-]*(?:id|number|no|last4|lastfour)["']?\s*[:=#]\s*["']?[^"',}\]\r\n]{1,128}/i;
const CARD_CANDIDATE = /\b(?:\d[ -]*?){13,19}\b/g;
const LOCATOR = /\b(?:s3|https?):\/\/|\barn:aws(?:-us-gov|-cn)?:|\.execute-api\.[a-z0-9-]+\.amazonaws\.com|\bX-Amz-(?:Algorithm|Credential|Signature)=|\b1Z[A-Z0-9]{16}\b/i;
const PRIVATE_CONTROL_TEXT = /\b(?:owner(?:ship)?|creator|actor|user|publication|version|operation|content\s*hash|object\s*key|s3\s*key|bucket|catalog|signature)\s*(?:id|email|name|hash|key|location)?\s*[:=#]/i;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function stableId(value, fallback = "source") {
  const id = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return id || fallback;
}

function simpleDigest(value) {
  let first = 2166136261;
  let second = 2246822519;
  for (const character of String(value || "")) {
    const code = character.codePointAt(0);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsPaymentCard(value) {
  CARD_CANDIDATE.lastIndex = 0;
  for (const match of String(value || "").matchAll(CARD_CANDIDATE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}

export function screenSourceMaterial(value) {
  const text = String(value || "");
  const categories = [];
  if (EMAIL.test(text)) categories.push("email address");
  if (PHONE.test(text)) categories.push("phone number");
  if (STREET_ADDRESS.test(text)) categories.push("street address");
  if (IDENTIFIER_TEXT.test(text) || PAYMENT_LAST_FOUR_TEXT.test(text) || STRUCTURED_IDENTIFIER_PAIR.test(text)) {
    categories.push("account, order, prescription, or payment identifier");
  }
  if (containsPaymentCard(text)) categories.push("payment card number");
  if (LOCATOR.test(text) || TRACKING_IDENTIFIER_TEXT.test(text)) {
    categories.push("URL, service locator, signed link, or tracking identifier");
  }
  if (PRIVATE_CONTROL_TEXT.test(text)) categories.push("system-owned publication or identity field");
  return { ok: categories.length === 0, categories: [...new Set(categories)] };
}

export function emptySourceGrounding() {
  return {
    version: SOURCE_GROUNDING_VERSION,
    documents: [],
    citations: {}
  };
}

export function splitSourcePassages(content, documentId = "source") {
  const text = cleanMultiline(content);
  if (!text) return [];
  const lines = text.split("\n");
  const passages = [];
  let start = -1;
  let buffer = [];
  const flush = (endIndex) => {
    const passageText = cleanMultiline(buffer.join("\n"));
    if (!passageText) {
      start = -1;
      buffer = [];
      return;
    }
    const chunks = passageText.match(new RegExp(`[\\s\\S]{1,${SOURCE_LIMITS.maxPassageCharacters}}`, "g")) || [];
    chunks.forEach((chunk) => {
      const index = passages.length;
      passages.push({
        id: `${documentId}_p${index + 1}`,
        text: cleanMultiline(chunk),
        lineStart: start + 1,
        lineEnd: endIndex + 1,
        reviewed: false,
        mappings: []
      });
    });
    start = -1;
    buffer = [];
  };
  lines.forEach((line, index) => {
    if (!line.trim()) {
      flush(index - 1);
      return;
    }
    if (start < 0) start = index;
    buffer.push(line);
  });
  flush(lines.length - 1);
  if (passages.length > SOURCE_LIMITS.maxPassagesPerDocument) {
    throw new Error(`Keep each source to ${SOURCE_LIMITS.maxPassagesPerDocument} passages or fewer.`);
  }
  return passages;
}

export function createSourceDocument({ label, kind = "pasted_text", content, id = "" }) {
  const cleanLabel = cleanText(label);
  const cleanContent = cleanMultiline(content);
  if (!cleanLabel) throw new Error("Add a short source name.");
  if (!cleanContent) throw new Error("Add source text before continuing.");
  if (cleanContent.length > SOURCE_LIMITS.maxDocumentCharacters) {
    throw new Error(`Keep each source under ${SOURCE_LIMITS.maxDocumentCharacters.toLocaleString()} characters.`);
  }
  const screening = screenSourceMaterial(`${cleanLabel}\n${cleanContent}`);
  if (!screening.ok) {
    throw new Error(`Remove ${screening.categories.join(", ")} from this source before adding it.`);
  }
  const documentId = stableId(id || `${cleanLabel}_${simpleDigest(cleanLabel)}`, "source");
  return {
    id: documentId,
    label: cleanLabel,
    kind: kind === "local_text_file" ? "local_text_file" : "pasted_text",
    content: cleanContent,
    comparisonDigest: simpleDigest(cleanContent),
    passages: splitSourcePassages(cleanContent, documentId)
  };
}

function normalizePassage(value, documentId, index) {
  const text = cleanMultiline(value?.text || value?.excerpt);
  if (!text) return null;
  return {
    id: stableId(value?.id, `${documentId}_p${index + 1}`),
    text: text.slice(0, SOURCE_LIMITS.maxPassageCharacters),
    lineStart: Math.max(1, Number(value?.lineStart) || 1),
    lineEnd: Math.max(1, Number(value?.lineEnd) || Number(value?.lineStart) || 1),
    reviewed: value?.reviewed === true,
    removed: value?.removed === true,
    mappings: Array.isArray(value?.mappings)
      ? [...new Set(value.mappings.filter((item) => SOURCE_MAPPING_IDS.has(item)))]
      : []
  };
}

export function normalizeSourceGrounding(value = {}) {
  const candidate = value && typeof value === "object" ? clone(value) : {};
  const documents = Array.isArray(candidate.documents)
    ? candidate.documents.slice(0, SOURCE_LIMITS.maxDocuments).flatMap((document, index) => {
        const id = stableId(document?.id, `source_${index + 1}`);
        const passages = Array.isArray(document?.passages)
          ? document.passages
              .slice(0, SOURCE_LIMITS.maxPassagesPerDocument)
              .map((passage, passageIndex) => normalizePassage(passage, id, passageIndex))
              .filter(Boolean)
          : [];
        const content = cleanMultiline(document?.content);
        return [{
          id,
          label: cleanText(document?.label) || `Source ${index + 1}`,
          kind: document?.kind === "local_text_file" ? "local_text_file" : "pasted_text",
          content: content.slice(0, SOURCE_LIMITS.maxDocumentCharacters),
          comparisonDigest: cleanText(document?.comparisonDigest) || simpleDigest(content),
          passages
        }];
      })
    : [];
  const validDocumentIds = new Set(documents.map((document) => document.id));
  const citations = {};
  if (candidate.citations && typeof candidate.citations === "object") {
    Object.entries(candidate.citations).forEach(([path, entries]) => {
      if (!Array.isArray(entries)) return;
      const normalized = entries.flatMap((citation) => {
        if (!citation || !validDocumentIds.has(citation.documentId)) return [];
        const confirmedAt = cleanText(citation.confirmedAt);
        return [{
          documentId: citation.documentId,
          passageId: stableId(citation.passageId, "passage"),
          status: citation.status === "needs_review" ? "needs_review" : "reviewed",
          ...(confirmedAt && !Number.isNaN(Date.parse(confirmedAt)) ? { confirmedAt } : {})
        }];
      });
      if (normalized.length) citations[path] = normalized;
    });
  }
  return { version: SOURCE_GROUNDING_VERSION, documents, citations };
}

export function addSourceDocument(grounding, document) {
  const next = normalizeSourceGrounding(grounding);
  if (next.documents.length >= SOURCE_LIMITS.maxDocuments) {
    throw new Error(`Add no more than ${SOURCE_LIMITS.maxDocuments} sources to one conversation.`);
  }
  const total = next.documents.reduce((sum, item) => sum + item.content.length, 0) + document.content.length;
  if (total > SOURCE_LIMITS.maxTotalCharacters) {
    throw new Error(`Keep all source material under ${SOURCE_LIMITS.maxTotalCharacters.toLocaleString()} characters.`);
  }
  let uniqueId = document.id;
  let suffix = 2;
  while (next.documents.some((item) => item.id === uniqueId)) {
    uniqueId = `${document.id}_${suffix}`;
    suffix += 1;
  }
  const copy = clone(document);
  if (uniqueId !== copy.id) {
    copy.id = uniqueId;
    copy.passages = copy.passages.map((passage, index) => ({
      ...passage,
      id: `${uniqueId}_p${index + 1}`
    }));
  }
  next.documents.push(copy);
  return next;
}

function addCitation(grounding, path, documentId, passageId) {
  grounding.citations[path] ||= [];
  if (!grounding.citations[path].some((item) => item.documentId === documentId && item.passageId === passageId)) {
    grounding.citations[path].push({ documentId, passageId, status: "reviewed" });
  }
}

function groundedText(value) {
  return cleanMultiline(
    value && typeof value === "object" && !Array.isArray(value)
      ? value.text
      : value
  );
}

function appendUnique(list, value) {
  const existing = list.findIndex((item) => groundedText(item) === groundedText(value));
  if (existing >= 0) return existing;
  list.push(value);
  return list.length - 1;
}

function appendObjectiveCriterion(objective, text, useStructuredCriteria) {
  const criteria = Array.isArray(objective.criteria) ? objective.criteria : (objective.criteria = []);
  const existing = criteria.findIndex((criterion) => groundedText(criterion) === groundedText(text));
  if (existing >= 0) return existing;
  if (!useStructuredCriteria) {
    criteria.push(text);
    return criteria.length - 1;
  }
  let index = criteria.length + 1;
  let id = stableId(`${objective.id || "learning_objective"}_criterion_${index}`, "criterion");
  const ids = new Set(criteria.map((criterion) => criterion?.id).filter(Boolean));
  while (ids.has(id)) {
    index += 1;
    id = stableId(`${objective.id || "learning_objective"}_criterion_${index}`, "criterion");
  }
  criteria.push({ id, text });
  return criteria.length - 1;
}

export function validateSourceSelections(grounding) {
  const normalized = normalizeSourceGrounding(grounding);
  const mapped = normalized.documents.flatMap((document) =>
    document.passages.map((passage) => ({ document, passage })).filter(({ passage }) => passage.mappings.length)
  );
  const unreviewed = mapped.filter(({ passage }) => !passage.reviewed);
  const needsReview = Object.entries(normalized.citations).flatMap(([path, citations]) =>
    citations
      .filter((citation) => citation.status === "needs_review")
      .map((citation) => ({ path, ...citation }))
  );
  return {
    ok: unreviewed.length === 0 && needsReview.length === 0,
    mappedCount: mapped.length,
    needsReview,
    unreviewed: unreviewed.map(({ document, passage }) => ({
      documentId: document.id,
      passageId: passage.id,
      label: `${document.label}, lines ${passage.lineStart}-${passage.lineEnd}`
    }))
  };
}

export function applySourceGroundingToDraft(draft, grounding) {
  const nextDraft = clone(draft);
  const nextGrounding = normalizeSourceGrounding(grounding);
  const selection = validateSourceSelections(nextGrounding);
  if (!selection.ok) {
    throw new Error("Review every mapped source passage and reconfirm any edited grounded field before continuing.");
  }
  nextGrounding.citations = {};
  for (const document of nextGrounding.documents) {
    for (const passage of document.passages) {
      if (!passage.reviewed) continue;
      if (passage.mappings.includes("correct_handling")) {
        const index = appendUnique(nextDraft.handling.correct, passage.text);
        addCitation(nextGrounding, `handling.correct.${index}`, document.id, passage.id);
      }
      if (passage.mappings.includes("avoidances")) {
        const index = appendUnique(nextDraft.handling.avoid, passage.text);
        addCitation(nextGrounding, `handling.avoid.${index}`, document.id, passage.id);
      }
      if (passage.mappings.includes("objectives")) {
        const objective = nextDraft.evaluation.objectives[0];
        const index = appendObjectiveCriterion(
          objective,
          passage.text,
          Number(nextDraft.studioVersion) >= 2 || objective.criteria.some((criterion) =>
            criterion && typeof criterion === "object" && !Array.isArray(criterion)
          )
        );
        addCitation(nextGrounding, `evaluation.objectives.0.criteria.${index}`, document.id, passage.id);
      }
      if (passage.mappings.includes("guidance")) {
        let index = nextDraft.guidance.sections.findIndex((section) =>
          cleanMultiline(section.body) === cleanMultiline(passage.text)
        );
        if (index < 0) {
          nextDraft.guidance.sections.push({
            title: "Source guidance",
            body: passage.text,
            bullets: [passage.text]
          });
          index = nextDraft.guidance.sections.length - 1;
        }
        addCitation(nextGrounding, `guidance.sections.${index}.body`, document.id, passage.id);
        addCitation(nextGrounding, `guidance.sections.${index}.bullets.0`, document.id, passage.id);
      }
    }
  }
  nextDraft.sourceGrounding = nextGrounding;
  return nextDraft;
}

function getPath(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function setPath(value, path, nextValue) {
  const keys = String(path || "").split(".").filter(Boolean);
  let target = value;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  });
  const key = keys.at(-1);
  const current = target[key];
  if (current && typeof current === "object" && !Array.isArray(current) && "text" in current) {
    current.text = nextValue;
    return;
  }
  target[key] = nextValue;
}

function alignReplacementPassages(previous, replacement) {
  const unused = new Set(replacement.passages.map((_, index) => index));
  const aligned = previous.passages.map((oldPassage, oldIndex) => {
    let newIndex = replacement.passages.findIndex((passage, index) =>
      unused.has(index) && cleanMultiline(passage.text) === cleanMultiline(oldPassage.text)
    );
    if (newIndex < 0) {
      const sameLine = replacement.passages.findIndex((passage, index) =>
        unused.has(index) && passage.lineStart === oldPassage.lineStart
      );
      if (sameLine >= 0) newIndex = sameLine;
    }
    if (newIndex < 0 && unused.has(oldIndex)) newIndex = oldIndex;
    if (newIndex < 0) newIndex = [...unused][0] ?? -1;
    if (newIndex < 0) {
      return {
        oldPassage,
        newPassage: {
          ...oldPassage,
          reviewed: false,
          removed: true
        }
      };
    }
    unused.delete(newIndex);
    const source = replacement.passages[newIndex];
    return {
      oldPassage,
      newPassage: {
        ...source,
        id: oldPassage.id,
        reviewed: oldPassage.reviewed,
        mappings: clone(oldPassage.mappings)
      }
    };
  });
  for (const index of unused) aligned.push({ oldPassage: null, newPassage: replacement.passages[index] });
  return aligned;
}

export function compareSourceReimport({ grounding, draft = null, documentId, content, kind, label }) {
  const normalized = normalizeSourceGrounding(grounding);
  const documentIndex = normalized.documents.findIndex((item) => item.id === documentId);
  if (documentIndex < 0) throw new Error("The source to compare is no longer in this draft.");
  const previous = normalized.documents[documentIndex];
  const replacement = createSourceDocument({
    id: previous.id,
    label: label || previous.label,
    kind: kind || previous.kind,
    content
  });
  if (replacement.comparisonDigest === previous.comparisonDigest) {
    return { changed: false, documentId, affected: [], nextGrounding: normalized, nextDraft: draft ? clone(draft) : null };
  }
  const aligned = alignReplacementPassages(previous, replacement);
  const nextGrounding = clone(normalized);
  nextGrounding.documents[documentIndex] = {
    ...replacement,
    passages: aligned.map(({ newPassage }) => newPassage).filter(Boolean)
  };
  const nextDraft = draft ? clone(draft) : null;
  const affected = [];
  const passageChanges = new Map();
  aligned.forEach(({ oldPassage, newPassage }) => {
    if (!oldPassage) return;
    passageChanges.set(oldPassage.id, { oldPassage, newPassage });
  });
  Object.entries(nextGrounding.citations).forEach(([path, citations]) => {
    citations.forEach((citation) => {
      if (citation.documentId !== documentId) return;
      const change = passageChanges.get(citation.passageId);
      if (!change || cleanMultiline(change.oldPassage.text) === cleanMultiline(change.newPassage?.text)) return;
      const current = nextDraft ? getPath(nextDraft, path) : undefined;
      const canReplace = Boolean(
        nextDraft &&
        change.newPassage &&
        !change.newPassage.removed &&
        groundedText(current) === cleanMultiline(change.oldPassage.text)
      );
      if (canReplace) setPath(nextDraft, path, change.newPassage.text);
      citation.status = canReplace ? "reviewed" : "needs_review";
      affected.push({
        path,
        before: change.oldPassage.text,
        after: change.newPassage?.removed ? "Source passage removed" : change.newPassage?.text || "Source passage removed",
        action: canReplace ? "replace" : "review"
      });
    });
  });
  return {
    changed: true,
    documentId,
    affected,
    nextGrounding,
    nextDraft
  };
}

export function markGroundingPathEdited(grounding, pathPrefix) {
  const next = normalizeSourceGrounding(grounding);
  Object.entries(next.citations).forEach(([path, citations]) => {
    if (path === pathPrefix || path.startsWith(`${pathPrefix}.`)) {
      citations.forEach((citation) => {
        citation.status = "needs_review";
      });
    }
  });
  return next;
}

function addPhaseCitationField(fields, semanticKey, paths) {
  fields.push({
    semanticKey,
    paths: [...new Set(paths.filter(Boolean))]
  });
}

function phaseCitationFields(phases = []) {
  const fields = [];
  let cautionIndex = 0;
  phases.forEach((phase, phaseIndex) => {
    const phaseKey = cleanText(phase?.id) || `phase_index_${phaseIndex}`;
    const phasePath = `flow.phases.${phaseIndex}`;
    addPhaseCitationField(fields, `${phaseKey}:title`, [`${phasePath}.title`]);
    addPhaseCitationField(fields, `${phaseKey}:partnerTurn`, [
      `${phasePath}.partnerTurn`,
      phaseIndex === 0 ? "scenario.openingLine" : `handling.customerResponses.${phaseIndex - 1}`
    ]);
    addPhaseCitationField(fields, `${phaseKey}:strongLearnerResponse`, [
      `${phasePath}.strongLearnerResponse`,
      `handling.correct.${phaseIndex}`
    ]);

    const bullets = Array.isArray(phase?.coachGuidance?.bullets)
      ? phase.coachGuidance.bullets
      : [];
    let projectedBulletIndex = 0;
    bullets.forEach((bullet, bulletIndex) => {
      const bulletKey = cleanText(bullet?.id) || `${phaseKey}_guidance_index_${bulletIndex}`;
      const richPath = `${phasePath}.coachGuidance.bullets.${bulletIndex}`;
      addPhaseCitationField(fields, `${phaseKey}:${bulletKey}:text`, [
        `${richPath}.text`,
        bulletIndex === 0 ? `guidance.sections.${phaseIndex}.body` : "",
        `guidance.sections.${phaseIndex}.bullets.${projectedBulletIndex}`
      ]);
      projectedBulletIndex += 1;
      const children = Array.isArray(bullet?.children) ? bullet.children : [];
      children.forEach((child, childIndex) => {
        const childKey = cleanText(child?.id) || `${bulletKey}_child_index_${childIndex}`;
        const paths = [
          `${richPath}.children.${childIndex}.text`,
          `guidance.sections.${phaseIndex}.bullets.${projectedBulletIndex}`
        ];
        if (child?.kind === "caution") {
          paths.push(`handling.avoid.${cautionIndex}`);
          cautionIndex += 1;
        }
        addPhaseCitationField(fields, `${phaseKey}:${bulletKey}:${childKey}:text`, paths);
        projectedBulletIndex += 1;
      });
    });
  });
  return fields;
}

function uniqueCitations(citations = []) {
  const unique = new Map();
  citations.forEach((citation) => {
    const key = `${citation.documentId}\u0000${citation.passageId}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, clone(citation));
      return;
    }
    unique.set(key, {
      ...existing,
      ...citation,
      status: existing.status === "needs_review" || citation.status === "needs_review"
        ? "needs_review"
        : "reviewed",
      ...(existing.confirmedAt || citation.confirmedAt
        ? { confirmedAt: existing.confirmedAt || citation.confirmedAt }
        : {})
    });
  });
  return [...unique.values()];
}

export function conversationPhaseCitationPaths(phases, phaseIndex, fieldPath) {
  const citationFieldPath = String(fieldPath).endsWith(".kind")
    ? `${String(fieldPath).slice(0, -5)}.text`
    : fieldPath;
  const prefix = `flow.phases.${phaseIndex}.${citationFieldPath}`;
  const fields = phaseCitationFields(phases);
  return [...new Set(fields.flatMap((field) => {
    const richPath = field.paths.find((path) => path.startsWith(`flow.phases.${phaseIndex}.`));
    if (!richPath || (richPath !== prefix && !richPath.startsWith(`${prefix}.`) && !prefix.startsWith(`${richPath}.`))) {
      return [];
    }
    return field.paths;
  }))];
}

export function markConversationPhaseCitationsEdited(
  grounding,
  phases,
  phaseIndex,
  fieldPath
) {
  return conversationPhaseCitationPaths(phases, phaseIndex, fieldPath).reduce(
    (next, path) => markGroundingPathEdited(next, path),
    grounding
  );
}

export function remapConversationPhaseCitations(grounding, beforePhases = [], afterPhases = []) {
  const next = normalizeSourceGrounding(grounding);
  const beforeFields = phaseCitationFields(beforePhases);
  const afterFields = phaseCitationFields(afterPhases);
  const managedPaths = new Set([
    ...beforeFields.flatMap((field) => field.paths),
    ...afterFields.flatMap((field) => field.paths)
  ]);
  const citationsBySemanticKey = new Map(beforeFields.map((field) => [
    field.semanticKey,
    uniqueCitations(field.paths.flatMap((path) => next.citations[path] || []))
  ]));
  const citations = Object.fromEntries(
    Object.entries(next.citations).filter(([path]) => !managedPaths.has(path))
  );
  afterFields.forEach((field) => {
    const entries = citationsBySemanticKey.get(field.semanticKey) || [];
    if (!entries.length) return;
    field.paths.forEach((path) => {
      citations[path] = clone(entries);
    });
  });
  next.citations = citations;
  return next;
}

export function confirmGroundingCitations(grounding, { documentId, passageId, paths = [] } = {}) {
  const next = normalizeSourceGrounding(grounding);
  const selectedPaths = new Set(paths);
  Object.entries(next.citations).forEach(([path, citations]) => {
    if (!selectedPaths.has(path)) return;
    citations.forEach((citation) => {
      if (citation.documentId === documentId && citation.passageId === passageId) {
        citation.status = "reviewed";
      }
    });
  });
  return next;
}

export function removeSourceDocument(grounding, documentId) {
  const next = normalizeSourceGrounding(grounding);
  next.documents = next.documents.filter((document) => document.id !== documentId);
  Object.entries(next.citations).forEach(([path, citations]) => {
    const remaining = citations.filter((citation) => citation.documentId !== documentId);
    if (remaining.length) next.citations[path] = remaining;
    else delete next.citations[path];
  });
  return next;
}

export function citationsForPath(grounding, pathPrefix) {
  const normalized = normalizeSourceGrounding(grounding);
  const entries = [];
  Object.entries(normalized.citations).forEach(([path, citations]) => {
    if (path !== pathPrefix && !path.startsWith(`${pathPrefix}.`)) return;
    citations.forEach((citation) => {
      const document = normalized.documents.find((item) => item.id === citation.documentId);
      const passage = document?.passages.find((item) => item.id === citation.passageId);
      if (!document || !passage) return;
      entries.push({
        path,
        documentId: document.id,
        passageId: passage.id,
        label: document.label,
        lineStart: passage.lineStart,
        lineEnd: passage.lineEnd,
        excerpt: passage.text,
        status: citation.status
      });
    });
  });
  return entries;
}

export function publishableSourceGrounding(grounding) {
  const normalized = normalizeSourceGrounding(grounding);
  const citedPassages = new Map();
  Object.values(normalized.citations).flat().forEach((citation) => {
    citedPassages.set(`${citation.documentId}\u0000${citation.passageId}`, citation.status);
  });
  const documents = normalized.documents.flatMap((document) => {
    const passages = document.passages.flatMap((passage) => {
      const status = citedPassages.get(`${document.id}\u0000${passage.id}`);
      return status ? [{
        id: passage.id,
        excerpt: passage.text,
        lineStart: passage.lineStart,
        lineEnd: passage.lineEnd,
        mappings: clone(passage.mappings),
        reviewStatus: status,
        sourceState: passage.removed ? "removed" : "current"
      }] : [];
    });
    return passages.length ? [{
      id: document.id,
      label: document.label,
      kind: document.kind,
      passages
    }] : [];
  });
  return {
    version: SOURCE_GROUNDING_VERSION,
    documents,
    citations: clone(normalized.citations)
  };
}

export function sourceGroundingFromPublished(value) {
  const candidate = value && typeof value === "object" ? value : {};
  return normalizeSourceGrounding({
    version: SOURCE_GROUNDING_VERSION,
    documents: Array.isArray(candidate.documents)
      ? candidate.documents.map((document) => ({
          id: document.id,
          label: document.label,
          kind: document.kind,
          content: "",
          comparisonDigest: "",
          passages: Array.isArray(document.passages)
            ? document.passages.map((passage) => ({
                id: passage.id,
                text: passage.excerpt,
                lineStart: passage.lineStart,
                lineEnd: passage.lineEnd,
                reviewed: true,
                removed: passage.sourceState === "removed",
                mappings: passage.mappings
              }))
            : []
        }))
      : [],
    citations: candidate.citations
  });
}
