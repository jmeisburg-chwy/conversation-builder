import { copyFamilyId, rebaseCanonicalFamily } from "./scenarioFidelity.js";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value) {
  return String(value || "").trim();
}

export function archiveKey(kind, id) {
  return `${kind}:${text(id)}`;
}

export function publishedConversationRows(families = []) {
  return (Array.isArray(families) ? families : []).map((family) => ({
    key: `published:${family.familyId}`,
    source: "published",
    archiveKind: "published",
    archiveId: text(family.familyId),
    familyId: text(family.familyId),
    title: text(family.title) || "Untitled conversation",
    teamAudience: text(family.teamAudience),
    topic: text(family.topic),
    subtopic: text(family.subtopic),
    status: text(family.status).toLowerCase() === "archived" ? "archived" : "published",
    updatedAt: text(family.updatedAt),
    editable: family.editable === true,
    copyOnly: family.copyOnly === true,
    archivable: family.archivable === true
  }));
}

export function persistentDraftConversationRows(drafts = []) {
  return (Array.isArray(drafts) ? drafts : []).map((envelope) => {
    const content = envelope?.content || {};
    const draftId = text(envelope?.draftId || content?.draftId);
    return {
      key: `draft:${draftId}`,
      source: "draft",
      archiveKind: "draft",
      archiveId: draftId,
      draftId,
      familyId: text(envelope?.familyId || content?.scenario?.baseId || draftId),
      title: text(envelope?.title || content?.scenario?.title) || "Untitled conversation",
      teamAudience: text(envelope?.teamAudience || content?.scenario?.teamAudience),
      topic: text(envelope?.topic || content?.scenario?.topic),
      subtopic: text(envelope?.subtopic || content?.scenario?.subtopic),
      status: "draft",
      updatedAt: text(envelope?.updatedAt),
      editable: true,
      copyOnly: false,
      mode: text(envelope?.mode) || "new",
      basePublicationId: envelope?.basePublicationId ?? null,
      etag: text(envelope?.etag)
    };
  });
}

export function sessionConversationRow({
  draft,
  active = false,
  updatedAt = ""
} = {}) {
  if (!active || !draft) return null;
  const draftId = text(draft.draftId || draft.scenario?.baseId);
  return {
    key: `session:${draftId}`,
    source: "session",
    archiveKind: "draft",
    archiveId: draftId,
    draftId,
    familyId: text(draft.scenario?.baseId || draft.draftId),
    title: text(draft.scenario?.title) || "Untitled conversation",
    teamAudience: text(draft.scenario?.teamAudience),
    topic: text(draft.scenario?.topic),
    subtopic: text(draft.scenario?.subtopic),
    status: "draft",
    updatedAt: text(updatedAt),
    editable: true,
    copyOnly: false
  };
}

export function conversationLibraryRows({
  session = null,
  drafts = [],
  families = [],
  archives = []
} = {}) {
  const activeDraftId = text(session?.draftId);
  const persistent = persistentDraftConversationRows(drafts)
    .filter((row) => !activeDraftId || row.draftId !== activeDraftId);
  const archiveByKey = new Map((Array.isArray(archives) ? archives : []).map((archive) => [
    archiveKey(archive?.kind, archive?.id),
    archive
  ]));
  return [
    ...(session ? [clone(session)] : []),
    ...persistent,
    ...publishedConversationRows(families)
  ].map((row) => {
    const archive = archiveByKey.get(archiveKey(row.archiveKind, row.archiveId));
    return {
      ...row,
      archived: row.status === "archived" || Boolean(archive),
      archivedAt: text(archive?.archivedAt)
    };
  });
}

const conversationSortKeys = new Set(["key", "title", "teamAudience", "topic", "subtopic", "updatedAt"]);

function compareConversationText(left, right) {
  return text(left).localeCompare(text(right), undefined, { sensitivity: "base" });
}

function compareConversationKeys(left, right) {
  const leftKey = text(left);
  const rightKey = text(right);
  const comparison = compareConversationText(leftKey, rightKey);
  if (comparison !== 0) return comparison;
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

export function sortConversationRows(
  rows = [],
  sortKey = "updatedAt",
  direction = "descending"
) {
  if (sortKey === "ascending" || sortKey === "descending") {
    direction = sortKey;
    sortKey = "updatedAt";
  }
  const resolvedSortKey = conversationSortKeys.has(sortKey) ? sortKey : "updatedAt";
  const sign = direction === "ascending" ? 1 : -1;
  return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
    if (resolvedSortKey === "updatedAt") {
      const leftTime = Date.parse(left.updatedAt || "");
      const rightTime = Date.parse(right.updatedAt || "");
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && leftTime !== rightTime) return sign * (leftTime - rightTime);
    } else {
      const comparison = compareConversationText(left[resolvedSortKey], right[resolvedSortKey]);
      if (comparison !== 0) return sign * comparison;
    }
    return compareConversationKeys(left.key, right.key);
  });
}

export function upsertPersistentDraftSummary(drafts = [], envelope = {}) {
  const draftId = text(envelope?.draftId);
  if (!draftId) return Array.isArray(drafts) ? clone(drafts) : [];
  const remaining = (Array.isArray(drafts) ? drafts : [])
    .filter((entry) => text(entry?.draftId) !== draftId)
    .map(clone);
  if (envelope?.status !== "draft") return remaining;
  const content = envelope?.content && typeof envelope.content === "object"
    ? envelope.content
    : {};
  const summary = {
    draftId,
    familyId: text(envelope?.familyId || content?.scenario?.baseId || draftId),
    status: "draft",
    mode: text(envelope?.mode || "new"),
    basePublicationId: envelope?.basePublicationId ?? null,
    title: text(envelope?.title || content?.scenario?.title) || "Untitled conversation",
    ...(text(envelope?.topic || content?.scenario?.topic)
      ? { topic: text(envelope?.topic || content?.scenario?.topic) }
      : {}),
    ...(text(envelope?.subtopic || content?.scenario?.subtopic)
      ? { subtopic: text(envelope?.subtopic || content?.scenario?.subtopic) }
      : {}),
    updatedAt: text(envelope?.updatedAt)
  };
  return [summary, ...remaining].sort((left, right) =>
    Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
  );
}

function uniqueValues(values = []) {
  const byKey = new Map();
  values.forEach((value) => {
    const label = text(value);
    const key = label.toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, label);
  });
  return [...byKey.values()].sort((left, right) => left.localeCompare(right));
}

function selectedValue(options, requested) {
  const key = text(requested).toLowerCase();
  if (!key || key === "all") return "all";
  return options.find((option) => option.toLowerCase() === key) || "all";
}

export function conversationFilterState(rows = [], { topic = "all", subtopic = "all" } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const topics = uniqueValues(safeRows.map((row) => row?.topic));
  const selectedTopic = selectedValue(topics, topic);
  const subtopicDisabled = selectedTopic === "all";
  const subtopics = subtopicDisabled
    ? []
    : uniqueValues(safeRows
      .filter((row) => text(row?.topic).toLowerCase() === selectedTopic.toLowerCase())
      .map((row) => row?.subtopic));
  return {
    topics,
    subtopics,
    topic: selectedTopic,
    subtopic: subtopicDisabled ? "all" : selectedValue(subtopics, subtopic),
    subtopicDisabled
  };
}

export function conversationEditAction(row = {}) {
  if (row?.archived === true) {
    return { enabled: false, loadAsCopy: false, feedback: "" };
  }
  const loadAsCopy = row?.source === "published" && (row?.copyOnly === true || row?.editable !== true);
  return {
    enabled: true,
    loadAsCopy,
    feedback: loadAsCopy ? "editableCopyCreated" : ""
  };
}

export function filterConversationRows(
  rows = [],
  { query = "", status = "all", topic = "all", subtopic = "all" } = {}
) {
  const normalizedQuery = text(query).toLowerCase();
  const normalizedStatus = text(status).toLowerCase() || "all";
  const normalizedTopic = text(topic).toLowerCase() || "all";
  const normalizedSubtopic = text(subtopic).toLowerCase() || "all";
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const matchesQuery = !normalizedQuery || [row.title, row.teamAudience, row.topic, row.subtopic]
      .some((value) => text(value).toLowerCase().includes(normalizedQuery));
    const matchesStatus = normalizedStatus === "archived"
      ? row.archived === true
      : row.archived !== true && (
          normalizedStatus === "all" || text(row.status).toLowerCase() === normalizedStatus
        );
    const matchesTopic = normalizedTopic === "all" || text(row.topic).toLowerCase() === normalizedTopic;
    const matchesSubtopic = normalizedSubtopic === "all" ||
      text(row.subtopic).toLowerCase() === normalizedSubtopic;
    return matchesQuery && matchesStatus && matchesTopic && matchesSubtopic;
  });
}

export function duplicateConversationDraft({
  draft,
  canonicalScenarios = [],
  suffix,
  sourceTitle = ""
}) {
  const sourceDraft = clone(draft);
  const sourceScenarios = clone(Array.isArray(canonicalScenarios) ? canonicalScenarios : []);
  const nextFamilyId = copyFamilyId(
    sourceDraft?.scenario?.baseId || sourceDraft?.draftId,
    suffix
  );
  const nextTitle = `${text(sourceTitle || sourceDraft?.scenario?.title) || "Untitled conversation"} copy`;
  sourceDraft.scenario.baseId = nextFamilyId;
  sourceDraft.draftId = nextFamilyId;
  sourceDraft.scenario.title = nextTitle;
  const scenarios = rebaseCanonicalFamily(sourceScenarios, nextFamilyId).map((scenario) => ({
    ...scenario,
    title: nextTitle,
    label: nextTitle,
    catalog: {
      ...scenario.catalog,
      title: nextTitle,
      label: nextTitle
    }
  }));
  return { draft: sourceDraft, canonicalScenarios: scenarios };
}
