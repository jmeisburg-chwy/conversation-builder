import {
  approveEvaluation,
  buildRevisionDiff,
  canEnterPublish,
  composeStudioScenarios,
  createStudioDraft,
  importStudioScenarios,
  isCurrentMaterialDraftFingerprint,
  isEvaluationApproved,
  isPublishReadyForCurrentDraft,
  materialDraftFingerprint,
  normalizeStudioDraft,
  addObjective,
  removeObjective,
  updateObjectiveLabel
} from "./src/scenarioStudio.js";
import {
  createPreviewBootstrap,
  hasCompletedPreviewExchange,
  readBuilderPreviewEvent
} from "./src/simulatorPreviewBridge.js";
import {
  REALTIME_VOICE_GROUPS,
  REALTIME_VOICE_OPTIONS,
  buildAuthoringPreviewInstructions,
  normalizeScenarioTuning
} from "./src/scenarioTuning.js";
import {
  composeWithCanonicalFidelity,
  isThinPublishReady
} from "./src/scenarioFidelity.js";
import {
  archiveKey,
  conversationLibraryRows,
  conversationEditAction,
  conversationFilterState,
  duplicateConversationDraft,
  filterConversationRows,
  sessionConversationRow,
  sortConversationRows,
  upsertPersistentDraftSummary
} from "./src/conversationLibrary.js";
import { createScenarioAssetLoader } from "./src/scenarioAssets.js";
import {
  isBlockingPhaseEvaluationFinding,
  runScenarioHealthCheck
} from "./src/scenarioQuality.js";
import {
  SOURCE_MAPPING_OPTIONS,
  addSourceDocument,
  applySourceGroundingToDraft,
  citationsForPath,
  confirmGroundingCitations,
  conversationPhaseCitationPaths,
  compareSourceReimport,
  createSourceDocument,
  emptySourceGrounding,
  markConversationPhaseCitationsEdited,
  markGroundingPathEdited,
  normalizeSourceGrounding,
  remapConversationPhaseCitations,
  removeSourceDocument,
  validateSourceSelections
} from "./src/sourceGrounding.js";
import {
  readLocalSourceFile,
  supportsLocalSourceFile
} from "./src/localSourceFiles.js";
import { createTaxonomyCombobox } from "./src/taxonomyCombobox.js";
import {
  applyContentRecommendation,
  manualContentRecommendation,
  pollContentRecommendation,
  recommendationRequestForApprovedResponse,
  recommendationRequestForObjective,
  validateContentRecommendation
} from "./src/contentRecommendations.js";
import { preserveElementViewportPosition } from "./src/viewportPreserver.js";
import {
  authoringToStandaloneDraft,
  loadStandaloneDraft,
  objectiveFingerprint as standaloneObjectiveFingerprint,
  saveStandaloneDraft,
  standaloneToAuthoringDraft
} from "./src/standaloneAdapter.js";

const browserDocument = typeof document === "undefined" ? null : document;
const browserWindow = typeof window === "undefined" ? null : window;
const $ = (selector, root = browserDocument) => root?.querySelector(selector) || null;
const $$ = (selector, root = browserDocument) =>
  root ? [...root.querySelectorAll(selector)] : [];
const scenarioAssetLoader = createScenarioAssetLoader();
const guidanceImageObjectUrls = new Set();
const portableDownloadObjectUrls = new Map();

const elements = {
  stageNavigation: $("#stageNavigation"),
  stageButtons: $$(".stage-button"),
  stagePanels: $$("[data-stage-panel]"),
  globalStatus: $("#globalStatus"),
  builderLandingView: $("#builderLandingView"),
  builderLandingHeading: $("#builderLandingHeading"),
  backToConversationLibraryButton: $("#backToConversationLibraryButton"),
  createNewConversationButton: $("#createNewConversationButton"),
  conversationLibrary: $("#conversationLibrary"),
  conversationSearchInput: $("#conversationSearchInput"),
  conversationStatusFilter: $("#conversationStatusFilter"),
  conversationTopicFilter: $("#conversationTopicFilter"),
  conversationSubtopicFilter: $("#conversationSubtopicFilter"),
  conversationSortButtons: $$('[data-conversation-sort-key]'),
  conversationSortButton: $("#conversationSortButton"),
  conversationMobileSortKey: $("#conversationMobileSortKey"),
  conversationMobileSortButton: $("#conversationMobileSortButton"),
  conversationLibraryBody: $("#conversationLibraryBody"),
  conversationLibraryEmpty: $("#conversationLibraryEmpty"),
  buildConversationStep: $("#buildConversationStep"),
  buildConversationCoach: $("#buildConversationCoach"),
  buildConversationCoachMessage: $("#buildConversationCoachMessage"),
  buildConversationContinueButton: $("#buildConversationContinueButton"),
  buildHandlingStep: $("#buildHandlingStep"),
  buildHandlingCoach: $("#buildHandlingCoach"),
  buildHandlingCoachMessage: $("#buildHandlingCoachMessage"),
  buildConversationRecap: $("#buildConversationRecap"),
  editBuildConversationButton: $("#editBuildConversationButton"),
  buildCreatingStep: $("#buildCreatingStep"),
  buildCreatingCoach: $("#buildCreatingCoach"),
  buildCreatingCoachMessage: $("#buildCreatingCoachMessage"),
  buildIntakeStatus: $("#buildIntakeStatus"),
  customerSituationInput: $("#customerSituationInput"),
  learnerApproachInput: $("#learnerApproachInput"),
  deidentificationConfirmedInput: $("#deidentificationConfirmed"),
  sourceGroundingMount: $("#sourceGroundingMount"),
  sourceGroundingDetails: $("#sourceGroundingDetails"),
  sourceNameInput: $("#sourceNameInput"),
  sourceTextInput: $("#sourceTextInput"),
  addPastedSourceButton: $("#addPastedSourceButton"),
  sourceDropZone: $("#sourceDropZone"),
  sourceFileInput: $("#sourceFileInput"),
  sourceStatus: $("#sourceStatus"),
  sourceDocumentList: $("#sourceDocumentList"),
  sourceUpdateProposal: $("#sourceUpdateProposal"),
  sourceUpdateSummary: $("#sourceUpdateSummary"),
  sourceUpdateAffectedFields: $("#sourceUpdateAffectedFields"),
  acceptSourceUpdateButton: $("#acceptSourceUpdateButton"),
  keepCurrentSourceButton: $("#keepCurrentSourceButton"),
  applySourcesButton: $("#applySourcesButton"),
  catalogStatus: $("#catalogStatus"),
  createDraftButton: $("#createDraftButton"),
  teamCombobox: $("#teamCombobox"),
  teamListbox: $("#teamListbox"),
  teamComboboxStatus: $("#teamComboboxStatus"),
  teamRemoveValueButton: $("#teamRemoveValueButton"),
  topicCombobox: $("#topicCombobox"),
  topicListbox: $("#topicListbox"),
  topicComboboxStatus: $("#topicComboboxStatus"),
  topicRemoveValueButton: $("#topicRemoveValueButton"),
  subtopicCombobox: $("#subtopicCombobox"),
  subtopicListbox: $("#subtopicListbox"),
  subtopicComboboxStatus: $("#subtopicComboboxStatus"),
  subtopicRemoveValueButton: $("#subtopicRemoveValueButton"),
  setupObjectiveList: $("#setupObjectiveList"),
  addSetupObjectiveButton: $("#addSetupObjectiveButton"),
  phaseList: $("#phaseList"),
  addPhaseButton: $("#addPhaseButton"),
  passingScoreInput: $("#passingScoreInput"),
  passingScoreIncrementButton: $("#passingScoreIncrementButton"),
  passingScoreDecrementButton: $("#passingScoreDecrementButton"),
  reviewBlockingSummary: $("#reviewBlockingSummary"),
  reviewVoiceSelect: $("#reviewVoiceSelect"),
  hotkeySearchInput: $("#hotkeySearchInput"),
  recommendedHotkeys: $("#recommendedHotkeys"),
  hotkeyLibrary: $("#hotkeyLibrary"),
  selectedHotkeysSection: $("#selectedHotkeysSection"),
  selectedHotkeys: $("#selectedHotkeys"),
  manualHotkeyInput: $("#manualHotkeyInput"),
  manualHotkeyCategoryInput: $("#manualHotkeyCategoryInput"),
  manualHotkeyTemplateInput: $("#manualHotkeyTemplateInput"),
  addManualHotkeyButton: $("#addManualHotkeyButton"),
  reviewBackButton: $("#reviewBackButton"),
  reviewContinueButton: $("#reviewContinueButton"),
  reviewFinalCheck: $(".review-final-check"),
  previewTitle: $("#previewTitle"),
  previewDescription: $("#previewDescription"),
  previewConversationAbout: $("#previewConversationAbout"),
  previewLearnerGoal: $("#previewLearnerGoal"),
  previewWorkspace: $(".preview-workspace"),
  previewChannelSelect: $("#previewChannelSelect"),
  playPreviewButton: $("#playPreviewButton"),
  previewStatus: $("#previewStatus"),
  noApiNotice: $("#noApiNotice"),
  simulatorPreviewFrame: $("#simulatorPreviewFrame"),
  transcript: $("#transcript"),
  previewGuidance: $("#previewGuidance"),
  learnerForm: $("#learnerForm"),
  learnerMessage: $("#learnerMessage"),
  sendLearnerButton: $("#sendLearnerButton"),
  customerAudio: $("#customerAudio"),
  testEditButton: $("#testEditButton"),
  testPublishButton: $("#testPublishButton"),
  validationHeadline: $("#validationHeadline"),
  validationDescription: $("#validationDescription"),
  validateButton: $("#validateButton"),
  validationIssues: $("#validationIssues"),
  publicationContext: $("#publicationContext"),
  releaseNoteExperience: $("#releaseNoteExperience"),
  revisionStatusBadge: $("#revisionStatusBadge"),
  revisionExperience: $("#revisionExperience"),
  revisionComparisonStatus: $("#revisionComparisonStatus"),
  revisionChangeCount: $("#revisionChangeCount"),
  revisionDiff: $("#revisionDiff"),
  releaseNoteInput: $("#releaseNoteInput"),
  releaseNoteCount: $("#releaseNoteCount"),
  publishChecksList: $("#publishChecksList"),
  savePersistentDraftButton: $("#savePersistentDraftButton"),
  downloadJsonMenu: $("#downloadJsonMenu"),
  downloadChatJsonButton: $("#downloadChatJsonButton"),
  downloadVoiceJsonButton: $("#downloadVoiceJsonButton"),
  downloadResult: $("#downloadResult"),
  downloadResultMessage: $("#downloadResultMessage"),
  copyJsonButton: $("#copyJsonButton"),
  copyJsonStatus: $("#copyJsonStatus"),
  draftConflictNotice: $("#draftConflictNotice"),
  draftConflictMessage: $("#draftConflictMessage"),
  reloadPersistentDraftButton: $("#reloadPersistentDraftButton"),
  publishButton: $("#publishButton"),
  publishStatus: $("#publishStatus"),
  nothingToPublish: $("#nothingToPublish"),
  nothingToPublishLibraryButton: $("#nothingToPublishLibraryButton"),
  guidanceImageDialog: $("#guidanceImageDialog"),
  guidanceImageDialogImage: $("#guidanceImageDialogImage"),
  guidanceImageDialogCaption: $("#guidanceImageDialogCaption"),
  toast: $("#toast")
};

const state = {
  draft: null,
  sourceGrounding: emptySourceGrounding(),
  sourceReimportTarget: "",
  pendingSourceUpdate: null,
  savedDraft: null,
  draftId: "",
  draftEtag: "",
  drafts: [],
  stage: "create",
  builderView: "landing",
  currentDraftActive: false,
  currentDraftUpdatedAt: "",
  reviewStarted: false,
  reviewIssuePhaseIds: new Set(),
  reviewTestAttempted: false,
  testVisited: false,
  standardTextMode: "none",
  contentRecommendations: {},
  apiBase: "",
  apiSource: "",
  hotkeys: [],
  validation: null,
  healthCheck: null,
  composed: null,
  activeScenario: null,
  loadedCanonicalScenarios: [],
  loadedBaselineDraft: null,
  assetPublicationId: "",
  publishedFamilies: [],
  archives: [],
  conversationSortKey: "updatedAt",
  conversationSortDirection: "descending",
  catalogError: "",
  taxonomyCatalogBaseline: null,
  loadedFamilyId: "",
  expectedBasePublicationId: null,
  loadMode: "new",
  copyOrigin: null,
  revisionStatus: "",
  releaseNote: "",
  publishChecks: {
    authoritative: "not_run",
    privacy: "not_run"
  },
  publishOperationId: "",
  pendingPublishRequest: null,
  publishInFlight: false,
  publishComplete: false,
  celebratedPublishOperationId: "",
  downloadResult: {
    status: "",
    json: ""
  },
  standaloneFiles: [],
  peerConnection: null,
  dataChannel: null,
  previewGeneration: 0,
  sessionReady: false,
  responsePending: false,
  streamingTurn: null,
  transcriptFamily: "",
  completedResponseText: "",
  previewTurns: [],
  openingQueued: false,
  audioOutputStarted: false,
  appliedVoice: "",
  liveTuningUpdateQueued: false,
  voiceRestartRequired: false,
  responseTimer: 0,
  reconnectTimer: 0,
  reconnecting: false,
  automaticReconnectUsed: false,
  resumeSession: false,
  resumeResponseRequired: false,
  resumeInput: "",
  previewSessionReference: "",
  previewDraftFingerprint: "",
  successfulTestDraftFingerprint: "",
  simulatorPreviewBinding: null,
  simulatorPreviewBootstrap: null,
  toastTimer: 0
};

let conversationPhaseEditorCoordinator = null;
const contentRecommendationControllers = new Map();

function ensureSourceGroundingControls() {
  if (elements.sourceGroundingDetails || !elements.sourceGroundingMount) return;
  elements.sourceGroundingMount.innerHTML = `
    <details id="sourceGroundingDetails" class="source-grounding-details" hidden>
      <summary>Source grounding <span>Existing draft</span></summary>
      <div class="source-grounding-intro">
        <div>
          <h3>Approved source material</h3>
          <p>Review or replace source material already connected to this draft.</p>
        </div>
        <p class="source-safety-note">Files stay in this browser tab. Use a bounded PDF, TXT, or MD file, and do not include private information.</p>
      </div>
      <div class="source-uploader">
        <button id="sourceDropZone" class="source-drop-zone" type="button" aria-describedby="sourceFileHelp">
          <strong>Drop a file here or choose a file</strong>
          <span id="sourceFileHelp">PDF, TXT, or MD · processed only in this browser tab</span>
        </button>
        <input id="sourceFileInput" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" />
        <details class="source-paste-details">
          <summary>Paste source text</summary>
          <div class="source-add-grid">
            <label class="field">
              <span>Source name</span>
              <input id="sourceNameInput" maxlength="120" placeholder="Example: Approved delivery guidance" />
            </label>
            <label class="field full">
              <span>Approved source text</span>
              <textarea id="sourceTextInput" rows="5" placeholder="Paste only the reviewed passages needed for this conversation."></textarea>
            </label>
            <div class="source-add-actions full">
              <button id="addPastedSourceButton" class="button secondary" type="button">Add pasted source</button>
            </div>
          </div>
        </details>
        <p id="sourceStatus" class="source-status" role="status" aria-live="polite"></p>
        <div id="sourceDocumentList" class="source-document-list"></div>
        <section id="sourceUpdateProposal" class="source-update-proposal" hidden>
          <h3>Review this source change</h3>
          <p id="sourceUpdateSummary"></p>
          <ul id="sourceUpdateAffectedFields"></ul>
          <div class="source-update-actions">
            <button id="acceptSourceUpdateButton" class="button primary" type="button">Accept localized updates</button>
            <button id="keepCurrentSourceButton" class="button secondary" type="button">Keep current draft and source</button>
          </div>
        </section>
        <div class="source-apply-row">
          <button id="applySourcesButton" class="button secondary" type="button" hidden>Apply reviewed sources to current draft</button>
        </div>
      </div>
    </details>`;
  [
    "sourceGroundingDetails",
    "sourceNameInput",
    "sourceTextInput",
    "addPastedSourceButton",
    "sourceDropZone",
    "sourceFileInput",
    "sourceStatus",
    "sourceDocumentList",
    "sourceUpdateProposal",
    "sourceUpdateSummary",
    "sourceUpdateAffectedFields",
    "acceptSourceUpdateButton",
    "keepCurrentSourceButton",
    "applySourcesButton"
  ].forEach((id) => {
    elements[id] = $(`#${id}`);
  });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function syncSelectTitle(select) {
  if (select?.tagName !== "SELECT") return "";
  if (select.selectedOptions) {
    select.title = select.selectedOptions[0]?.textContent.trim() || "";
  } else {
    const selectedOption = Array.from(select.querySelectorAll?.("option") || [])
      .find((option) => option.value === select.value);
    select.title = selectedOption?.textContent.trim() || "";
  }
  if (select.disabled || !select.value) select.title = "";
  return select.title;
}

function syncSelectTitles(root = browserDocument) {
  root?.querySelectorAll("select").forEach(syncSelectTitle);
}

function syncSelectTitleFromEvent(event) {
  const select = event.target?.tagName === "SELECT"
    ? event.target
    : event.target?.closest?.("select");
  if (select) syncSelectTitle(select);
}

function wireSelectTitleSynchronization() {
  browserDocument?.addEventListener("change", syncSelectTitleFromEvent, true);
  browserDocument?.addEventListener("pointerenter", syncSelectTitleFromEvent, true);
  browserDocument?.addEventListener("focusin", syncSelectTitleFromEvent, true);
  syncSelectTitles();
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getPath(object, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  let target = object;
  keys.slice(0, -1).forEach((key) => {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = value;
}

function cleanLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

function currentSourceGrounding() {
  return normalizeSourceGrounding(state.draft?.sourceGrounding || state.sourceGrounding);
}

function setSourceGrounding(grounding, { dirty = true } = {}) {
  state.sourceGrounding = normalizeSourceGrounding(grounding);
  if (state.draft) {
    state.draft.sourceGrounding = clone(state.sourceGrounding);
    if (dirty) setDirty();
  }
  renderSourceGrounding();
}

function sourceFieldLabel(path) {
  if (path.startsWith("handling.correct")) return "Conversation Flow";
  if (path.startsWith("handling.avoid")) return "Conversation Flow caution";
  if (path.startsWith("evaluation.objectives")) return "Learning objectives and criteria";
  if (path.startsWith("guidance.sections")) return "Coach Chewy Guidance";
  return path;
}

function setSourceStatus(message, stateName = "") {
  if (!elements.sourceStatus) return;
  elements.sourceStatus.textContent = message;
  elements.sourceStatus.dataset.state = stateName;
}

function updatePassage(documentId, passageId, updater) {
  const next = currentSourceGrounding();
  const document = next.documents.find((item) => item.id === documentId);
  const passage = document?.passages.find((item) => item.id === passageId);
  if (!passage) return;
  updater(passage);
  setSourceGrounding(next);
}

function makeSourceCheckbox({ checked, disabled = false, label, onChange }) {
  const wrapper = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener("change", () => onChange(input.checked));
  const copy = document.createElement("span");
  copy.textContent = label;
  wrapper.append(input, copy);
  return wrapper;
}

function renderSourceGrounding() {
  if (!elements.sourceDocumentList) return;
  const grounding = currentSourceGrounding();
  if (elements.sourceGroundingDetails) {
    elements.sourceGroundingDetails.hidden = grounding.documents.length === 0;
  }
  elements.sourceDocumentList.innerHTML = "";
  elements.sourceDocumentList.hidden = grounding.documents.length === 0;
  grounding.documents.forEach((sourceDocument) => {
    const card = document.createElement("article");
    card.className = "source-document-card";
    const heading = document.createElement("div");
    heading.className = "source-document-heading";
    const copy = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = sourceDocument.label;
    const meta = document.createElement("p");
    meta.textContent = `${sourceDocument.kind === "local_text_file" ? "Local file" : "Pasted text"} · ${sourceDocument.passages.length} passage${sourceDocument.passages.length === 1 ? "" : "s"}`;
    copy.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "source-add-actions";
    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "button secondary compact-button";
    compare.textContent = sourceDocument.kind === "local_text_file" ? "Compare replacement file" : "Compare updated text";
    compare.addEventListener("click", () => {
      state.sourceReimportTarget = sourceDocument.id;
      if (sourceDocument.kind === "local_text_file") {
        elements.sourceFileInput.click();
        return;
      }
      elements.sourceNameInput.value = sourceDocument.label;
      elements.sourceTextInput.value = sourceDocument.content || sourceDocument.passages.map((item) => item.text).join("\n\n");
      elements.addPastedSourceButton.textContent = "Compare source update";
      elements.sourceTextInput.focus();
      setSourceStatus("Edit the pasted text, then choose Compare source update.");
    });
    const remove = removeIconButton({
      label: `Remove source ${sourceDocument.label}`,
      onClick: () => {
        if (!window.confirm(`Remove ${sourceDocument.label} and its source citations from this draft?`)) return;
        setSourceGrounding(removeSourceDocument(grounding, sourceDocument.id));
        setSourceStatus(`${sourceDocument.label} was removed from this tab.`);
      }
    });
    actions.append(compare, remove);
    heading.append(copy, actions);
    const passages = document.createElement("div");
    passages.className = "source-passage-list";
    sourceDocument.passages.forEach((passage) => {
      const row = document.createElement("section");
      row.className = "source-passage";
      const excerpt = document.createElement("blockquote");
      excerpt.textContent = passage.text;
      const controls = document.createElement("div");
      controls.className = "source-passage-controls";
      controls.append(makeSourceCheckbox({
        checked: passage.reviewed,
        disabled: passage.removed,
        label: passage.removed
          ? "Previously cited passage was removed from the updated source"
          : `Reviewed and approved · lines ${passage.lineStart}-${passage.lineEnd}`,
        onChange: (checked) => updatePassage(sourceDocument.id, passage.id, (item) => {
          item.reviewed = checked;
        })
      }));
      const mappings = document.createElement("div");
      mappings.className = "source-mapping-options";
      SOURCE_MAPPING_OPTIONS.forEach((option) => {
        mappings.append(makeSourceCheckbox({
          checked: passage.mappings.includes(option.id),
          disabled: passage.removed,
          label: option.label,
          onChange: (checked) => updatePassage(sourceDocument.id, passage.id, (item) => {
            item.mappings = checked
              ? [...new Set([...item.mappings, option.id])]
              : item.mappings.filter((id) => id !== option.id);
          })
        }));
      });
      row.append(excerpt, controls, mappings);
      passages.append(row);
    });
    const passageReview = document.createElement("details");
    passageReview.className = "source-passage-review";
    const passageSummary = document.createElement("summary");
    passageSummary.textContent = `Review source details and citations (${sourceDocument.passages.length} passage${sourceDocument.passages.length === 1 ? "" : "s"})`;
    passageReview.append(passageSummary, passages);
    card.append(heading, passageReview);
    elements.sourceDocumentList.append(card);
  });
  const selection = validateSourceSelections(grounding);
  elements.applySourcesButton.hidden = !state.reviewStarted || selection.mappedCount === 0;
}

function addNewSource(document) {
  setSourceGrounding(addSourceDocument(currentSourceGrounding(), document));
  elements.sourceNameInput.value = "";
  elements.sourceTextInput.value = "";
  state.sourceReimportTarget = "";
  elements.addPastedSourceButton.textContent = "Add pasted source";
  elements.sourceGroundingDetails.open = true;
  setSourceStatus(`${document.label} was added. Build the draft now, or review source details to add citations.`, "success");
}

async function importLocalSourceFile(file) {
  if (!file) return;
  if (!supportsLocalSourceFile(file)) {
    setSourceStatus("Choose a PDF, TXT, or MD file.", "error");
    return;
  }
  setSourceStatus(`Reading ${file.name} in this browser tab…`);
  try {
    const source = await readLocalSourceFile(file);
    if (state.sourceReimportTarget) {
      prepareSourceComparison(state.sourceReimportTarget, {
        content: source.content,
        kind: source.kind,
        label: file.name
      });
    } else {
      addNewSource(createSourceDocument({
        label: file.name,
        kind: source.kind,
        content: source.content
      }));
    }
  } catch (error) {
    setSourceStatus(String(error?.message || error), "error");
  }
}

function prepareSourceComparison(documentId, { content, kind, label }) {
  try {
    const proposal = compareSourceReimport({
      grounding: currentSourceGrounding(),
      draft: state.draft,
      documentId,
      content,
      kind,
      label
    });
    state.sourceReimportTarget = "";
    elements.addPastedSourceButton.textContent = "Add pasted source";
    if (!proposal.changed) {
      state.pendingSourceUpdate = null;
      renderSourceUpdateProposal();
      setSourceStatus("The source matches the version already in this draft.", "success");
      return;
    }
    state.pendingSourceUpdate = proposal;
    renderSourceUpdateProposal();
    setSourceStatus("Source changes found. Review the affected fields before accepting anything.");
  } catch (error) {
    setSourceStatus(String(error?.message || error), "error");
  }
}

function renderSourceUpdateProposal() {
  if (!elements.sourceUpdateProposal) return;
  const proposal = state.pendingSourceUpdate;
  elements.sourceUpdateProposal.hidden = !proposal;
  elements.sourceUpdateAffectedFields.innerHTML = "";
  if (!proposal) return;
  const affected = [...new Map(proposal.affected.map((item) => [item.path, item])).values()];
  elements.sourceUpdateSummary.textContent = affected.length
    ? `${affected.length} grounded field${affected.length === 1 ? " is" : "s are"} affected. Exact source-derived text can update in place; edited fields stay unchanged and are marked for review.`
    : "The source changed, but no drafted field currently cites the changed passage. Accepting updates only the reviewed source record.";
  affected.forEach((item) => {
    const row = document.createElement("li");
    row.textContent = `${sourceFieldLabel(item.path)}: ${item.action === "replace" ? "localized text replacement proposed" : "keep current text and review its citation"}`;
    elements.sourceUpdateAffectedFields.append(row);
  });
}

function citationSummary(pathPrefixes) {
  const paths = [...new Set(Array.isArray(pathPrefixes) ? pathPrefixes : [pathPrefixes])];
  const citations = paths.flatMap((path) => citationsForPath(currentSourceGrounding(), path));
  if (!citations.length) return null;
  const container = document.createElement("div");
  container.className = "field-citations";
  const unique = new Map();
  citations.forEach((citation) => {
    const key = `${citation.documentId}\u0000${citation.passageId}`;
    const existing = unique.get(key);
    unique.set(key, existing
      ? { ...existing, status: existing.status === "needs_review" ? "needs_review" : citation.status }
      : citation);
  });
  unique.forEach((citation) => {
    const row = document.createElement("span");
    row.dataset.citationStatus = citation.status;
    const lines = citation.lineStart === citation.lineEnd
      ? `line ${citation.lineStart}`
      : `lines ${citation.lineStart}-${citation.lineEnd}`;
    const copy = document.createElement("span");
    copy.textContent = citation.status === "needs_review"
      ? `Source needs review: ${citation.label}, ${lines}`
      : `Source: ${citation.label}, ${lines}`;
    row.title = citation.excerpt;
    row.append(copy);
    if (citation.status === "needs_review") {
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "citation-confirm-button";
      confirm.textContent = "Confirm it still supports this field";
      confirm.addEventListener("click", () => {
        const grounding = confirmGroundingCitations(currentSourceGrounding(), {
          documentId: citation.documentId,
          passageId: citation.passageId,
          paths
        });
        setSourceGrounding(grounding);
        const field = container.parentElement;
        const input = field?.querySelector("input, textarea, select");
        if (field) refreshCitationSummary(field, paths);
        input?.focus();
        showToast("Source support confirmed for this field.");
      });
      row.append(confirm);
    }
    container.append(row);
  });
  return container;
}

function refreshCitationSummary(container, pathPrefix) {
  container.querySelector(".field-citations")?.remove();
  const next = citationSummary(pathPrefix);
  if (next) container.append(next);
}

function markCitationsEdited(pathPrefix) {
  const grounding = currentSourceGrounding();
  const citations = citationsForPath(grounding, pathPrefix);
  if (!citations.length) return;
  state.sourceGrounding = markGroundingPathEdited(grounding, pathPrefix);
  if (state.draft) state.draft.sourceGrounding = clone(state.sourceGrounding);
}

function removeListItemCitations(pathPrefix, removedIndex) {
  const grounding = currentSourceGrounding();
  const citations = {};
  Object.entries(grounding.citations).forEach(([path, entries]) => {
    const match = path.match(new RegExp(`^${pathPrefix.replaceAll(".", "\\.")}\\.(\\d+)(.*)$`));
    if (!match) {
      citations[path] = entries;
      return;
    }
    const index = Number(match[1]);
    if (index === removedIndex) return;
    const nextPath = index > removedIndex
      ? `${pathPrefix}.${index - 1}${match[2]}`
      : path;
    citations[nextPath] = entries;
  });
  grounding.citations = citations;
  state.sourceGrounding = grounding;
  if (state.draft) state.draft.sourceGrounding = clone(grounding);
}

function setGlobalStatus(message, status = "") {
  elements.globalStatus.textContent = message;
  elements.globalStatus.dataset.state = status;
  elements.globalStatus.hidden = !message;
}

function showToast(message, { actionLabel = "", onAction = null } = {}) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "toast-action";
    action.textContent = actionLabel;
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        await onAction();
      } catch {
        showToast("Archive could not be updated. Refresh and try again.");
      } finally {
        if (action.isConnected) action.disabled = false;
      }
    });
    elements.toast.append(action);
  }
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, actionLabel ? 7000 : 4200);
}

async function requestJsonWithMetadata(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message =
      typeof payload === "object"
        ? payload.message || payload.error?.message || payload.error
        : payload;
    const error = new Error(message || `Request failed (${response.status}).`);
    if (payload && typeof payload === "object") {
      error.code = String(payload.code || payload.error?.code || "");
      error.currentPublicationId = payload.currentPublicationId || null;
      error.routeMessage = typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : "";
    }
    error.status = response.status;
    throw error;
  }
  return {
    payload,
    etag: response.headers.get("etag") || ""
  };
}

function requestJson(url, options = {}) {
  return requestJsonWithMetadata(url, options).then(({ payload }) => payload);
}

function contentRecommendationKey(kind, sourceId) {
  return `${kind}:${sourceId}`;
}

function contentRecommendationSource(kind, sourceId) {
  if (kind === "objective") {
    return (state.draft?.evaluation?.objectives || []).find((item) => item.id === sourceId) || null;
  }
  return (state.draft?.chat?.standardText || []).find((item) => item.id === sourceId) || null;
}

function abortContentRecommendation(sourceKey) {
  contentRecommendationControllers.get(sourceKey)?.abort();
  contentRecommendationControllers.delete(sourceKey);
}

function resetContentRecommendations() {
  contentRecommendationControllers.forEach((controller) => controller.abort());
  contentRecommendationControllers.clear();
  state.contentRecommendations = {};
}

function invalidateContentRecommendation(kind, sourceId, { remove = false } = {}) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const current = state.contentRecommendations[sourceKey];
  abortContentRecommendation(sourceKey);
  state.contentRecommendations[sourceKey] = {
    revision: Number(current?.revision || 0) + 1,
    status: remove ? "removed" : "edited",
    recommendation: null,
    error: "",
    selectedPhaseId: ""
  };
}

function contentRecommendationIsCurrent({ kind, sourceId, sourceKey, revision, request }) {
  const entry = state.contentRecommendations[sourceKey];
  const source = contentRecommendationSource(kind, sourceId);
  if (!entry || entry.revision !== revision || !source) return false;
  if (kind === "objective") {
    return source.label === request.objective.label;
  }
  return source.id === request.approvedResponse.id &&
    String(source.hotkey || "").toUpperCase() === request.approvedResponse.shortcut &&
    (source.category || "Standard Text") === request.approvedResponse.category &&
    source.template === request.approvedResponse.template;
}

function renderContentRecommendationSource(kind, sourceId) {
  if (kind === "objective") refreshObjectiveRecommendationControls(sourceId);
  else refreshApprovedResponseRecommendation(sourceId);
}

function refreshApprovedResponseRecommendation(sourceId) {
  const sourceKey = contentRecommendationKey("response", sourceId);
  const response = contentRecommendationSource("response", sourceId);
  $$('[data-content-recommendation-source]').filter(
    (card) => card.dataset.contentRecommendationSource === sourceKey
  ).forEach((card) => {
    const review = card.querySelector(".content-recommendation-review");
    if (!review) return;
    card.querySelector(".approved-response-assignment")?.remove();
    appendApprovedResponseAssignment(card, sourceId, review);
    renderContentRecommendationReview(review, {
      kind: "response",
      sourceId,
      response,
      focusLocation: card.dataset.contentRecommendationLocation || "selected"
    });
  });
}

function unavailableRecommendationMessage(kind) {
  return kind === "objective"
    ? "Your objective was saved, but Coach Chewy couldn't recommend a phase."
    : "Your approved response was kept, but Coach Chewy couldn't recommend a phase.";
}

function contentRecommendationSourceRoot(kind, sourceId, focusLocation) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const roots = $$('[data-content-recommendation-source]').filter(
    (item) => item.dataset.contentRecommendationSource === sourceKey
  );
  return roots.find(
    (item) => item.dataset.contentRecommendationLocation === focusLocation
  ) || roots[0] || null;
}

function focusContentRecommendationTarget(kind, sourceId, focusLocation, action) {
  const root = contentRecommendationSourceRoot(kind, sourceId, focusLocation);
  if (!root) return;
  const target = action === "source"
    ? kind === "objective"
      ? root.querySelector("input[data-objective-label-input-id], input[type='text']")
      : root.querySelector(".remove-button")
    : action === "status"
      ? root.querySelector(".content-recommendation-review")
      : root.querySelector(`[data-content-recommendation-action="${action}"]`);
  target?.focus({ preventScroll: true });
}

function contentRecommendationSourceHasFocus(kind, sourceId, focusLocation) {
  const root = contentRecommendationSourceRoot(kind, sourceId, focusLocation);
  return Boolean(root && browserDocument?.activeElement && root.contains(browserDocument.activeElement));
}

async function requestContentRecommendation(
  kind,
  sourceId,
  { focusLocation = kind === "objective" ? "setup" : "selected" } = {}
) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const current = state.contentRecommendations[sourceKey];
  abortContentRecommendation(sourceKey);
  const revision = Number(current?.revision || 0) + 1;
  let request;
  try {
    request = kind === "objective"
      ? recommendationRequestForObjective(state.draft, sourceId)
      : recommendationRequestForApprovedResponse(state.draft, sourceId);
  } catch {
    state.contentRecommendations[sourceKey] = {
      revision,
      status: "unavailable",
      recommendation: null,
      error: unavailableRecommendationMessage(kind),
      selectedPhaseId: state.draft?.flow?.phases?.[0]?.id || ""
    };
    renderContentRecommendationSource(kind, sourceId);
    focusContentRecommendationTarget(kind, sourceId, focusLocation, "retry");
    return;
  }
  state.contentRecommendations[sourceKey] = {
    revision,
    status: "pending",
    recommendation: null,
    error: "",
    selectedPhaseId: ""
  };
  renderContentRecommendationSource(kind, sourceId);
  focusContentRecommendationTarget(kind, sourceId, focusLocation, "status");
  const controller = new AbortController();
  contentRecommendationControllers.set(sourceKey, controller);
  try {
    const start = await requestJson("/api/builder/recommend-content", {
      method: "POST",
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const result = await pollContentRecommendation({
      start,
      signal: controller.signal,
      status: ({ jobId, signal }) => requestJson("/api/builder/recommend-content-status", {
        method: "POST",
        body: JSON.stringify({ jobId }),
        signal
      })
    });
    if (!contentRecommendationIsCurrent({
      kind,
      sourceId,
      sourceKey,
      revision,
      request
    })) return;
    const recommendation = validateContentRecommendation(state.draft, result.recommendation);
    const shouldTransferFocus = contentRecommendationSourceHasFocus(kind, sourceId, focusLocation);
    state.contentRecommendations[sourceKey] = {
      revision,
      status: "succeeded",
      recommendation,
      error: "",
      selectedPhaseId: recommendation.phaseId
    };
    renderContentRecommendationSource(kind, sourceId);
    if (shouldTransferFocus) {
      focusContentRecommendationTarget(kind, sourceId, focusLocation, "apply");
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (!contentRecommendationIsCurrent({
      kind,
      sourceId,
      sourceKey,
      revision,
      request
    })) return;
    const shouldTransferFocus = contentRecommendationSourceHasFocus(kind, sourceId, focusLocation);
    state.contentRecommendations[sourceKey] = {
      revision,
      status: "unavailable",
      recommendation: null,
      error: unavailableRecommendationMessage(kind),
      selectedPhaseId: state.draft?.flow?.phases?.[0]?.id || ""
    };
    renderContentRecommendationSource(kind, sourceId);
    if (shouldTransferFocus) {
      focusContentRecommendationTarget(kind, sourceId, focusLocation, "retry");
    }
  } finally {
    if (contentRecommendationControllers.get(sourceKey) === controller) {
      contentRecommendationControllers.delete(sourceKey);
    }
  }
}

function finishContentRecommendation(kind, sourceId, status, selectedPhaseId, message) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const current = state.contentRecommendations[sourceKey];
  abortContentRecommendation(sourceKey);
  state.contentRecommendations[sourceKey] = {
    revision: Number(current?.revision || 0) + 1,
    status,
    recommendation: null,
    error: message,
    selectedPhaseId
  };
}

function applyReviewedContentRecommendation(kind, sourceId, focusLocation) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const entry = state.contentRecommendations[sourceKey];
  if (!entry?.recommendation) return;
  try {
    const recommendation = validateContentRecommendation(state.draft, {
      ...entry.recommendation,
      phaseId: entry.selectedPhaseId
    });
    state.draft = applyContentRecommendation(state.draft, recommendation);
    state.sourceGrounding = clone(state.draft.sourceGrounding);
    finishContentRecommendation(
      kind,
      sourceId,
      "applied",
      recommendation.phaseId,
      `Recommendation applied to ${phaseTitleForId(recommendation.phaseId)}.`
    );
    setDirty();
    renderContentRecommendationSource(kind, sourceId);
    if (kind === "objective") renderConversationPhases();
    renderReviewReadiness();
    renderReviewBlockingSummary();
    focusContentRecommendationTarget(kind, sourceId, focusLocation, "source");
  } catch {
    const current = state.contentRecommendations[sourceKey];
    state.contentRecommendations[sourceKey] = {
      revision: Number(current?.revision || 0) + 1,
      status: "unavailable",
      recommendation: null,
      error: unavailableRecommendationMessage(kind),
      selectedPhaseId: state.draft?.flow?.phases?.[0]?.id || ""
    };
    renderContentRecommendationSource(kind, sourceId);
    focusContentRecommendationTarget(kind, sourceId, focusLocation, "retry");
  }
}

function applyManualContentRecommendation(kind, sourceId, focusLocation) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const entry = state.contentRecommendations[sourceKey];
  if (!entry?.selectedPhaseId) return;
  try {
    state.draft = manualContentRecommendation(state.draft, {
      kind: kind === "objective" ? "objective_alignment" : "approved_response_alignment",
      sourceId,
      phaseId: entry.selectedPhaseId
    });
    state.sourceGrounding = clone(state.draft.sourceGrounding);
    finishContentRecommendation(
      kind,
      sourceId,
      "applied",
      entry.selectedPhaseId,
      `Manual placement applied to ${phaseTitleForId(entry.selectedPhaseId)}.`
    );
    setDirty();
    renderContentRecommendationSource(kind, sourceId);
    if (kind === "objective") renderConversationPhases();
    renderReviewReadiness();
    renderReviewBlockingSummary();
    focusContentRecommendationTarget(kind, sourceId, focusLocation, "source");
  } catch {
    state.contentRecommendations[sourceKey] = {
      revision: Number(entry.revision || 0) + 1,
      status: "unavailable",
      recommendation: null,
      error: unavailableRecommendationMessage(kind),
      selectedPhaseId: state.draft?.flow?.phases?.[0]?.id || ""
    };
    renderContentRecommendationSource(kind, sourceId);
    focusContentRecommendationTarget(kind, sourceId, focusLocation, "retry");
  }
}

function dismissContentRecommendation(kind, sourceId, focusLocation) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const entry = state.contentRecommendations[sourceKey];
  finishContentRecommendation(
    kind,
    sourceId,
    "dismissed",
    entry?.selectedPhaseId || "",
    kind === "objective"
      ? "The objective was saved without the proposed changes."
      : "The approved response was kept without the proposed mapping."
  );
  renderContentRecommendationSource(kind, sourceId);
  focusContentRecommendationTarget(kind, sourceId, focusLocation, "source");
}

function phaseTitleForId(phaseId) {
  return state.draft?.flow?.phases?.find((phase) => phase.id === phaseId)?.title || "the selected phase";
}

function appendRecommendationDetail(container, label, value) {
  const detail = document.createElement("p");
  const title = document.createElement("strong");
  title.textContent = `${label}: `;
  detail.append(title, document.createTextNode(value));
  container.append(detail);
}

function appendRecommendationPhaseSelect(container, entry, label) {
  const field = document.createElement("label");
  field.className = "content-recommendation-phase";
  const copy = document.createElement("span");
  copy.textContent = label;
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  (state.draft?.flow?.phases || []).forEach((phase) => {
    const option = document.createElement("option");
    option.value = phase.id;
    option.textContent = phase.title;
    select.append(option);
  });
  select.value = entry.selectedPhaseId;
  select.addEventListener("change", () => {
    entry.selectedPhaseId = select.value;
  });
  field.append(copy, select);
  container.append(field);
}

function appendRecommendationAction(container, label, onClick, primary = false, action = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "button primary compact-button" : "button secondary compact-button";
  button.textContent = label;
  if (action) button.dataset.contentRecommendationAction = action;
  button.addEventListener("click", onClick);
  container.append(button);
}

function renderContentRecommendationReview(container, {
  kind,
  sourceId,
  response = null,
  focusLocation = kind === "objective" ? "setup" : "selected"
}) {
  const sourceKey = contentRecommendationKey(kind, sourceId);
  const entry = state.contentRecommendations[sourceKey];
  container.innerHTML = "";
  container.tabIndex = -1;
  container.hidden = !entry || ["edited", "idle", "removed"].includes(entry.status);
  container.dataset.status = entry?.status || "idle";
  if (container.hidden) return;
  if (entry.status === "pending") {
    const loading = document.createElement("p");
    loading.textContent = kind === "objective"
      ? "Coach Chewy is finding the best place for this objective…"
      : "Coach Chewy is finding the best place for this approved response…";
    container.append(loading);
    return;
  }
  if (entry.status === "succeeded" && entry.recommendation) {
    const heading = document.createElement("h5");
    heading.textContent = "Coach Chewy recommendation";
    container.append(heading);
    if (kind === "response") {
      appendRecommendationDetail(
        container,
        "Approved response",
        `${String(response?.hotkey || "").toUpperCase()} · ${response?.category || "Standard Text"}`
      );
    }
    appendRecommendationDetail(
      container,
      "Recommended phase",
      phaseTitleForId(entry.recommendation.phaseId)
    );
    if (kind === "objective") {
      appendRecommendationDetail(
        container,
        "Observable criterion",
        entry.recommendation.objective.criterion
      );
    }
    appendRecommendationDetail(
      container,
      "Coach Chewy instruction",
      entry.recommendation.guidanceInstruction
    );
    appendRecommendationDetail(container, "Why", entry.recommendation.rationale);
    appendRecommendationPhaseSelect(container, entry, "Choose another phase");
    const actions = document.createElement("div");
    actions.className = "content-recommendation-actions";
    appendRecommendationAction(
      actions,
      "Apply recommendation",
      () => applyReviewedContentRecommendation(kind, sourceId, focusLocation),
      true,
      "apply"
    );
    appendRecommendationAction(
      actions,
      "Not now",
      () => dismissContentRecommendation(kind, sourceId, focusLocation),
      false,
      "dismiss"
    );
    container.append(actions);
    return;
  }
  if (entry.status === "unavailable") {
    const message = document.createElement("p");
    message.textContent = entry.error;
    container.append(message);
    appendRecommendationPhaseSelect(container, entry, "Choose phase");
    const actions = document.createElement("div");
    actions.className = "content-recommendation-actions";
    appendRecommendationAction(
      actions,
      "Retry recommendation",
      () => requestContentRecommendation(kind, sourceId, { focusLocation }),
      false,
      "retry"
    );
    appendRecommendationAction(
      actions,
      "Apply manually",
      () => applyManualContentRecommendation(kind, sourceId, focusLocation),
      true,
      "manual"
    );
    container.append(actions);
    return;
  }
  const message = document.createElement("p");
  message.textContent = entry.error;
  container.append(message);
}

function renderObjectiveRecommendationControls(container) {
  const objectiveId = container.dataset.objectiveRecommendationId;
  const focusLocation = container.dataset.contentRecommendationLocation;
  const sourceKey = contentRecommendationKey("objective", objectiveId);
  const recommendationState = state.contentRecommendations[sourceKey];
  const controlDocument = container.ownerDocument || document;
  container.innerHTML = "";
  const save = controlDocument.createElement("button");
  save.type = "button";
  save.className = "button secondary compact-button save-objective-button";
  save.textContent = "Save objective";
  save.dataset.contentRecommendationAction = "save";
  save.hidden = !["edited", "pending"].includes(recommendationState?.status);
  save.disabled = recommendationState?.status === "pending";
  save.addEventListener("click", () => {
    requestContentRecommendation("objective", objectiveId, { focusLocation });
  });
  const review = controlDocument.createElement("div");
  review.className = "content-recommendation-review";
  review.setAttribute("role", "status");
  review.setAttribute("aria-live", "polite");
  renderContentRecommendationReview(review, {
    kind: "objective",
    sourceId: objectiveId,
    focusLocation
  });
  container.append(save, review);
}

function createObjectiveRecommendationControls(objectiveId, focusLocation, controlDocument = document) {
  const container = controlDocument.createElement("div");
  container.className = "objective-recommendation-controls";
  container.dataset.objectiveRecommendationId = objectiveId;
  container.dataset.contentRecommendationLocation = focusLocation;
  renderObjectiveRecommendationControls(container);
  return container;
}

function refreshObjectiveRecommendationControls(objectiveId) {
  $$('[data-objective-recommendation-id]').filter(
    (container) => container.dataset.objectiveRecommendationId === objectiveId
  ).forEach(renderObjectiveRecommendationControls);
}

function commitObjectiveLabelMutation(objectiveId) {
  invalidateContentRecommendation("objective", objectiveId);
  setDirty();
  refreshObjectiveRecommendationControls(objectiveId);
}

export async function requestGeneratedStudioDraftFromInputs({
  conversationAboutInput,
  learnerApproachInput,
  deidentificationConfirmedInput,
  channels = ["chat", "voice"],
  request = requestJson
}) {
  const deidentificationConfirmed = deidentificationConfirmedInput?.checked === true;
  const creatorInput = {
    conversationAbout: String(conversationAboutInput?.value || ""),
    learnerApproach: String(learnerApproachInput?.value || ""),
    deidentificationConfirmed
  };
  const response = await request("/api/builder/generate", {
    method: "POST",
    body: JSON.stringify({
      mode: "new",
      channels,
      situation: creatorInput.conversationAbout,
      learnerGoal: creatorInput.learnerApproach,
      correctProcess: creatorInput.learnerApproach,
      deidentificationConfirmed
    })
  });
  if (!response?.draft) throw new Error("We couldn’t create a safe draft this time. Try again.");
  return normalizeStudioDraft(standaloneToAuthoringDraft(response.draft, creatorInput));
}

export async function waitForGeneratedStudioDraft(
  start,
  {
    request = requestJson,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts = 180
  } = {}
) {
  const jobId = String(start?.jobId || "").trim().toLowerCase();
  if (!jobId || start?.status !== "pending") {
    throw new Error("We couldn’t create a safe draft this time. Try again.");
  }
  let pollAfterMs = Number(start.pollAfterMs) || 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await wait(Math.max(500, Math.min(pollAfterMs, 3000)));
    const status = await request("/api/builder/generate-status", {
      method: "POST",
      body: JSON.stringify({ jobId })
    });
    if (status?.status === "succeeded" && status?.draft) return status;
    if (status?.status === "failed") {
      throw new Error("We couldn’t create a safe draft this time. Try again.");
    }
    if (!["pending", "running"].includes(status?.status)) {
      throw new Error("We couldn’t create a safe draft this time. Try again.");
    }
    pollAfterMs = Number(status.pollAfterMs) || 1000;
  }
  throw new Error("Draft creation is still taking longer than expected. Try again.");
}

export async function runCreateDraftBuild({
  conversationAboutInput,
  learnerApproachInput,
  deidentificationConfirmedInput,
  createDraftButton,
  reportStatus = setGlobalStatus,
  completeDraftCreation = async () => {},
  requestDraft = requestGeneratedStudioDraftFromInputs
}) {
  if (createDraftButton.disabled) return { status: "ignored" };
  const requiredInputs = [
    [conversationAboutInput, "Describe what this conversation is about."],
    [learnerApproachInput, "Describe how the Learner should handle the conversation."]
  ];
  const missing = requiredInputs.find(([input]) => !input.value.trim());
  if (missing) {
    reportStatus(missing[1], "error");
    missing[0].focus();
    return { status: "invalid" };
  }
  if (deidentificationConfirmedInput?.checked !== true) {
    reportStatus("Confirm that the conversation details are fictional or de-identified.", "error");
    deidentificationConfirmedInput?.focus();
    return { status: "invalid" };
  }
  const idleButtonText = createDraftButton.textContent;
  createDraftButton.disabled = true;
  createDraftButton.textContent = "Creating draft…";
  try {
    const draft = await requestDraft({
      conversationAboutInput,
      learnerApproachInput,
      deidentificationConfirmedInput
    });
    await completeDraftCreation(draft);
    return { status: "created", draft };
  } catch (error) {
    reportStatus(String(error?.message || error), "error");
    return { status: "error", error };
  } finally {
    createDraftButton.disabled = false;
    createDraftButton.textContent = idleButtonText;
  }
}

function setBuildIntakeStatus(message = "", state = "") {
  const text = String(message || "").trim();
  elements.buildIntakeStatus.textContent = text;
  elements.buildIntakeStatus.dataset.state = text ? state : "";
  elements.buildIntakeStatus.hidden = !text;
}

async function playBuildCoachAcknowledgement({
  coach,
  message,
  acknowledgement,
  settledState = "question"
}) {
  coach.dataset.coachState = "answer";
  message.textContent = acknowledgement;
  coach.dataset.coachState = settledState;
}

function setBuildIntakeControlsDisabled(disabled) {
  [
    elements.customerSituationInput,
    elements.learnerApproachInput,
    elements.deidentificationConfirmedInput,
    elements.buildConversationContinueButton,
    elements.editBuildConversationButton,
    elements.createDraftButton,
    elements.backToConversationLibraryButton
  ].filter(Boolean).forEach((control) => {
    control.disabled = disabled;
  });
}

function setBuildIntakeStep(step, { focus = false } = {}) {
  const nextStep = ["conversation", "handling", "creating"].includes(step)
    ? step
    : "conversation";
  elements.buildConversationStep.hidden = nextStep !== "conversation";
  elements.buildHandlingStep.hidden = nextStep !== "handling";
  elements.buildCreatingStep.hidden = nextStep !== "creating";
  if (nextStep === "handling") {
    elements.buildConversationRecap.textContent = elements.customerSituationInput.value.trim();
  }
  if (focus || nextStep === "creating") {
    browserWindow?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
  if (!focus) return;
  const target = nextStep === "conversation"
    ? elements.customerSituationInput
    : nextStep === "handling"
      ? elements.learnerApproachInput
      : null;
  target?.focus({ preventScroll: true });
}

function canonicalStage(value) {
  const stage = String(value || "").toLowerCase();
  if (stage === "review-edit") return "review";
  if (stage === "test" || stage === "test-tune") return "tune";
  if (stage === "validate-download") return "validate";
  return ["create", "review", "tune", "validate"].includes(stage) ? stage : "create";
}

function setBuilderViewMarker(body, view) {
  if (!body) return;
  body.dataset.builderView = view === "workflow" ? "workflow" : "landing";
}

function setBuilderView(view, { focus = true } = {}) {
  const next = view === "workflow" ? "workflow" : "landing";
  state.builderView = next;
  setBuilderViewMarker(browserDocument?.body, next);
  const landing = next === "landing";
  if (elements.builderLandingView) elements.builderLandingView.hidden = !landing;
  if (elements.stageNavigation) elements.stageNavigation.hidden = landing;
  if (elements.backToConversationLibraryButton) elements.backToConversationLibraryButton.hidden = landing;
  if (landing) {
    elements.stagePanels.forEach((panel) => {
      panel.hidden = true;
      panel.classList.remove("active");
    });
    renderConversationLibrary();
    if (focus) elements.builderLandingHeading?.focus({ preventScroll: true });
  } else {
    setStage(state.stage, { preserveScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function performReviewStageNavigation({
  requestedStage,
  reviewStarted = false,
  reviewComplete = false,
  testVisited = false,
  publishReady = testVisited,
  onStageChange = () => {},
  onRenderReview = () => {},
  onRevealBlockingIssues = () => {},
  onPublishBlocked = () => {},
  navigationLocked = false,
  onNavigationBlocked = () => {}
} = {}) {
  let next = canonicalStage(requestedStage);
  if (navigationLocked && next !== "validate") {
    onNavigationBlocked();
    onStageChange("validate");
    return "validate";
  }
  let revealBlockingIssues = false;
  if (next === "review" && !reviewStarted) next = "create";
  if (next === "tune" && !reviewComplete) {
    revealBlockingIssues = reviewStarted;
    next = reviewStarted ? "review" : "create";
  }
  if (next === "validate" && !publishReady) {
    next = reviewComplete ? "tune" : reviewStarted ? "review" : "create";
    if (next === "tune") onPublishBlocked();
  }
  onStageChange(next);
  if (next === "review") onRenderReview();
  if (revealBlockingIssues) onRevealBlockingIssues();
  return next;
}

function setStage(stage, options = {}) {
  const next = performReviewStageNavigation({
    requestedStage: stage,
    reviewStarted: state.reviewStarted,
    reviewComplete: reviewIsComplete(),
    testVisited: state.testVisited,
    publishReady: canEnterPublish(state.draft),
    onStageChange: (resolvedStage) => {
      state.stage = resolvedStage;
      elements.stageButtons.forEach((button) => {
        const active = button.dataset.stage === resolvedStage;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      elements.stagePanels.forEach((panel) => {
        const active = panel.dataset.stagePanel === resolvedStage;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
    },
    onRenderReview: renderReview,
    onRevealBlockingIssues: () => {
      if (state.draft) revealReviewBlockingIssues();
    },
    onPublishBlocked: () => {
      const message = "Approve the objectives and criteria in Review to continue.";
      setPreviewStatus(message);
      showToast(message);
      elements.stageButtons.find((button) => button.dataset.stage === "review")
        ?.focus({ preventScroll: true });
    },
    navigationLocked: state.publishInFlight === true || Boolean(state.pendingPublishRequest),
    onNavigationBlocked: () => {
      const message = "The publish result is still being confirmed. Retry publish before editing or leaving.";
      if (elements.publishStatus) elements.publishStatus.textContent = message;
      showToast(message);
      elements.publishButton?.focus({ preventScroll: true });
    }
  });
  if (next === "tune") prepareTuneStage();
  if (next === "validate") renderValidation();
  renderStageAvailability();
  if (!options.preserveScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

export function configureReviewTestAffordance(button, {
  available = false,
  validated = false
} = {}) {
  if (!button) return button;
  button.disabled = !available || !validated;
  return button;
}

export function configurePublishContinueAffordance(button, { ready = false } = {}) {
  if (!button) return button;
  button.disabled = false;
  if (ready) button.removeAttribute("aria-disabled");
  else button.setAttribute("aria-disabled", "true");
  return button;
}

export function handlePublishContinueEntry({
  canEnter = false,
  onBlocked = () => {},
  onEnter = () => {}
} = {}) {
  if (!canEnter) {
    onBlocked();
    return false;
  }
  onEnter();
  return true;
}

export function handleReviewTestEntry({
  canEnter = false,
  onBlocked = () => {},
  onEnter = () => {}
} = {}) {
  if (!canEnter) {
    onBlocked();
    return false;
  }
  onEnter();
  return true;
}

export function focusReviewSection(sectionId, dependencies = {}) {
  const editorDocument = dependencies.document || browserDocument;
  const editorWindow = dependencies.window || editorDocument?.defaultView || browserWindow;
  const target = editorDocument?.getElementById?.(sectionId) || null;
  if (!target) return null;
  const reducedMotion = typeof editorWindow?.matchMedia === "function" &&
    editorWindow.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  target.focus?.({ preventScroll: true });
  return target;
}

function renderStageAvailability() {
  elements.stageButtons.forEach((button) => {
    const stage = button.dataset.stage;
    if (stage === "create") return;
    if (stage === "review") button.disabled = !state.reviewStarted;
    if (stage === "tune") {
      configureReviewTestAffordance(button, {
        available: state.reviewStarted,
        validated: reviewIsComplete() && state.validation?.ok === true
      });
    }
    if (stage === "validate") {
      button.disabled = !canEnterPublish(state.draft) || state.validation?.ok !== true;
    }
  });
  configurePublishContinueAffordance(elements.testPublishButton, {
    ready: canEnterPublish(state.draft) && state.validation?.ok === true
  });
}

export function applyBuilderDirtyLifecycle(canonicalState, {
  preserveReadiness = false,
  preservePublishOperation = false,
  publishButton = null,
  publishStatus = null,
  getNow = () => new Date().toISOString(),
  runHealthCheck = runScenarioHealthCheck,
  onRenderHealthCheck = () => {},
  onRenderPublicationContext = () => {},
  onRenderValidation = () => {}
} = {}) {
  const previewEvidenceStillCurrent = Boolean(
    canonicalState.publishOperationId &&
    isCurrentMaterialDraftFingerprint(
      canonicalState.draft,
      canonicalState.previewDraftFingerprint
    )
  );
  if (
    canonicalState.successfulTestDraftFingerprint &&
    !isCurrentMaterialDraftFingerprint(
      canonicalState.draft,
      canonicalState.successfulTestDraftFingerprint
    )
  ) {
    canonicalState.successfulTestDraftFingerprint = "";
  }
  if (canonicalState.currentDraftActive) canonicalState.currentDraftUpdatedAt = getNow();
  if (!preserveReadiness && canonicalState.draft?.readiness?.tests) {
    Object.values(canonicalState.draft.readiness.tests).forEach((test) => {
      test.status = "not_tested";
    });
  }
  canonicalState.validation = null;
  canonicalState.healthCheck = canonicalState.draft
    ? runHealthCheck(canonicalState.draft)
    : null;
  canonicalState.composed = null;
  canonicalState.publishChecks = {
    authoritative: "not_run",
    privacy: "not_run"
  };
  if (!preservePublishOperation && !previewEvidenceStillCurrent) {
    canonicalState.publishOperationId = "";
  }
  canonicalState.publishComplete = false;
  if (publishButton) publishButton.disabled = true;
  if (publishStatus) publishStatus.textContent = "";
  onRenderHealthCheck();
  onRenderPublicationContext();
  onRenderValidation();
  return canonicalState;
}

export function createBuilderDirtyLifecycleHandler(canonicalState, dependencies = {}) {
  return (options = {}) => applyBuilderDirtyLifecycle(canonicalState, {
    ...options,
    ...dependencies
  });
}

const runBuilderDirtyLifecycle = createBuilderDirtyLifecycleHandler(state, {
  publishButton: elements.publishButton,
  publishStatus: elements.publishStatus,
  onRenderHealthCheck: renderHealthCheck,
  onRenderPublicationContext: renderPublicationContext,
  onRenderValidation: renderValidation
});

function setDirty(options = {}) {
  return runBuilderDirtyLifecycle(options);
}

function updateSavedState(result = {}) {
  state.savedDraft = clone(state.draft);
  state.draftId = result.draftId || state.draft?.draftId || state.draftId;
}

export function persistentDraftSaveBody({
  draft,
  familyId = draft?.scenario?.baseId,
  status = "draft",
  mode = "new",
  basePublicationId = null
} = {}) {
  const content = normalizePhaseAuthoringDraft(draft || {});
  return {
    version: 1,
    familyId: String(familyId || content.scenario?.baseId || "").trim(),
    status: status === "published" ? "published" : "draft",
    mode: ["new", "editable", "copyOnly"].includes(mode) ? mode : "new",
    basePublicationId: mode === "editable" ? basePublicationId : null,
    content
  };
}

export async function savePersistentDraft({
  draft,
  familyId = draft?.scenario?.baseId,
  status = "draft",
  mode = "new",
  basePublicationId = null,
  etag = "",
  request = requestJsonWithMetadata
} = {}) {
  const draftId = String(draft?.draftId || "").trim();
  if (!draftId) throw new Error("Conversation Builder could not use that draft.");
  const body = persistentDraftSaveBody({
    draft,
    familyId,
    status,
    mode,
    basePublicationId
  });
  const response = await request(`/api/builder/drafts/${encodeURIComponent(draftId)}`, {
    method: "PUT",
    headers: etag
      ? { "If-Match": etag }
      : { "If-None-Match": "*" },
    body: JSON.stringify(body)
  });
  const envelope = response?.payload?.draft;
  const nextEtag = String(response?.etag || "");
  if (
    !envelope ||
    envelope.draftId !== draftId ||
    envelope.familyId !== body.familyId ||
    envelope.status !== body.status ||
    !nextEtag
  ) {
    throw new Error("Conversation Builder could not verify the saved draft.");
  }
  return {
    draft: envelope,
    etag: nextEtag,
    created: response.payload?.created === true
  };
}

export async function saveDraft({
  quiet = false,
  draftState = state,
  getStorage = () => browserWindow?.localStorage,
  reportStatus = (message) => {
    if (elements.publishStatus) elements.publishStatus.textContent = message;
  },
  notify = showToast
} = {}) {
  if (!draftState.draft) return { saved: false };
  draftState.draft = normalizePhaseAuthoringDraft(draftState.draft);
  draftState.draftId = draftState.draft.draftId;
  if (draftState.currentDraftActive) {
    draftState.currentDraftUpdatedAt = new Date().toISOString();
  }
  try {
    const result = saveStandaloneDraft(getStorage(), draftState.draft);
    draftState.savedDraft = clone(draftState.draft);
    if (!quiet) notify("Draft saved in this browser.");
    return { saved: true, savedAt: result.savedAt };
  } catch (error) {
    const message = "Draft could not be saved in this browser. Validation and JSON download can continue, but download your JSON before leaving.";
    reportStatus(message);
    notify(message);
    return { saved: false, error };
  }
}

export function loadSavedDraftSafely({
  getStorage = () => browserWindow?.localStorage
} = {}) {
  try {
    return loadStandaloneDraft(getStorage());
  } catch {
    return null;
  }
}

function clearDraftConflict() {
  if (!elements.draftConflictNotice) return;
  elements.draftConflictNotice.hidden = true;
  elements.draftConflictMessage.textContent = "This draft changed in another tab. Reload it before saving.";
}

function showDraftConflict() {
  if (!elements.draftConflictNotice) return;
  elements.draftConflictMessage.textContent = "This draft changed in another tab. Reload it before saving.";
  elements.draftConflictNotice.hidden = false;
  elements.reloadPersistentDraftButton.focus({ preventScroll: true });
}

async function persistCurrentDraft({
  status = "draft",
  returnToLibrary = false,
  familyId,
  mode,
  basePublicationId,
  draft: draftSnapshot,
  confirmedPublication = false
} = {}) {
  const draftSource = draftSnapshot ?? state.draft;
  if (!draftSource) return { saved: false };
  const draftToPersist = normalizePhaseAuthoringDraft(draftSource);
  if (draftSnapshot === undefined) state.draft = draftToPersist;
  try {
    const result = saveStandaloneDraft(window.localStorage, draftToPersist);
    state.currentDraftUpdatedAt = result.savedAt;
    state.savedDraft = clone(draftToPersist);
    state.draftId = draftToPersist.draftId;
    state.currentDraftActive = true;
    clearDraftConflict();
    showToast("Draft saved in this browser.");
    elements.publishStatus.textContent = "Saved in this browser. You can return after testing and continue editing.";
    return { draft: clone(draftToPersist), savedAt: result.savedAt, saved: true };
  } catch (error) {
    elements.publishStatus.textContent = "The draft could not be saved in this browser. Download the JSON before leaving.";
    return { saved: false, error };
  }
}

function normalizePhaseAuthoringDraft(draft) {
  const next = clone(draft);
  const beforeObjectives = clone(next.evaluation?.objectives || []);
  const beforePhases = clone(next.flow?.phases || []);
  if (Array.isArray(next.flow?.phases) && next.flow.phases.length) {
    delete next.handling?.correct;
    delete next.handling?.avoid;
    delete next.handling?.customerResponses;
    delete next.guidance?.sections;
    delete next.guidance?.channelSections;
  }
  const normalized = normalizeStudioDraft(next);
  const beforeObjectivesById = new Map(beforeObjectives.map((objective) => [objective?.id, objective]));
  normalized.evaluation.objectives = (normalized.evaluation?.objectives || []).map((objective) => {
    const authored = beforeObjectivesById.get(objective.id);
    if (!authored) return objective;
    return {
      ...objective,
      id: authored.id,
      label: String(authored.label ?? ""),
      description: String(authored.description ?? ""),
      criteria: (Array.isArray(authored.criteria) ? authored.criteria : []).map((criterion) => ({
        id: String(criterion?.id ?? ""),
        text: String(typeof criterion === "object" ? criterion?.text ?? "" : criterion ?? ""),
      })),
    };
  });
  const criterionIdsByObjective = new Map(
    (normalized.evaluation?.objectives || []).map((objective) => [
      objective.id,
      new Set((objective.criteria || []).map((criterion) => criterionId(criterion))),
    ])
  );
  const beforePhasesById = new Map(beforePhases.map((phase) => [phase?.id, phase]));
  normalized.flow.phases = (normalized.flow?.phases || []).map((phase) => ({
    ...phase,
    chatAdvanceRequirements: (() => {
      const authored = beforePhasesById.get(phase.id);
      return authored && Object.hasOwn(authored, "chatAdvanceRequirements")
        ? clone(authored.chatAdvanceRequirements)
        : clone(phase.chatAdvanceRequirements || []);
    })(),
    evaluationLinks: (() => {
      const authored = beforePhasesById.get(phase.id);
      const links = authored && Object.hasOwn(authored, "evaluationLinks")
        ? authored.evaluationLinks
        : phase.evaluationLinks;
      return (Array.isArray(links) ? links : []).flatMap((link) => {
      const availableCriterionIds = criterionIdsByObjective.get(link.objectiveId);
      if (!availableCriterionIds) return [];
      const criterionIds = [...new Set(link.criterionIds || [])]
        .filter((id) => availableCriterionIds.has(id));
      return criterionIds.length ? [{ ...link, criterionIds }] : [];
      });
    })(),
  }));
  normalized.sourceGrounding = remapCanonicalEvaluationCitations(
    normalized.sourceGrounding,
    beforeObjectives,
    normalized.evaluation?.objectives || []
  );
  return normalized;
}

export function prepareEvaluationDraftForCommit(draft) {
  return normalizePhaseAuthoringDraft(draft);
}

export function approveEvaluationForPersistence(draft, approvedAt) {
  const prepared = prepareEvaluationDraftForCommit(draft);
  if (blockingPhaseEvaluationFindings(prepared).length) {
    throw new Error("Complete every phase assignment before approving objectives and criteria.");
  }
  return approveEvaluation(prepared, approvedAt);
}

export function prepareDraftForValidation(draft, approvedAt = new Date().toISOString()) {
  const prepared = prepareEvaluationDraftForCommit(draft);
  return blockingPhaseEvaluationFindings(prepared).length
    ? prepared
    : approveEvaluation(prepared, approvedAt);
}

function resetPublicationContext() {
  state.loadedFamilyId = "";
  state.expectedBasePublicationId = null;
  state.loadMode = "new";
  state.copyOrigin = null;
  state.revisionStatus = "";
  state.releaseNote = "";
  state.publishOperationId = "";
  state.pendingPublishRequest = null;
  state.publishInFlight = false;
  state.publishComplete = false;
  state.celebratedPublishOperationId = "";
  state.draftEtag = "";
  state.publishChecks = { authoritative: "not_run", privacy: "not_run" };
  state.loadedCanonicalScenarios = [];
  state.loadedBaselineDraft = null;
  state.assetPublicationId = "";
  clearGuidanceImageObjectUrls();
  scenarioAssetLoader.clear();
}

export async function loadConversationLibraryData(request = requestJson) {
  const [catalog, draftList, archiveList] = await Promise.all([
    request("/api/builder/catalog", {
      method: "POST",
      body: "{}"
    }),
    request("/api/builder/drafts"),
    request("/api/builder/archive")
  ]);
  return {
    families: Array.isArray(catalog?.families) ? catalog.families : [],
    drafts: Array.isArray(draftList?.drafts) ? draftList.drafts : [],
    archives: Array.isArray(archiveList?.archives) ? archiveList.archives : []
  };
}

async function loadPublishedCatalog() {
  elements.catalogStatus.textContent = "Loading conversations…";
  state.catalogError = "";
  try {
    const result = await loadConversationLibraryData();
    state.publishedFamilies = result.families;
    state.drafts = result.drafts;
    state.archives = result.archives;
    state.taxonomyCatalogBaseline = taxonomyCatalogBaseline(result.families);
    renderConversationLibrary();
    renderTaxonomyControls();
  } catch (error) {
    state.publishedFamilies = [];
    state.drafts = [];
    state.archives = [];
    state.taxonomyCatalogBaseline = null;
    state.catalogError = String(error?.message || error);
    renderConversationLibrary();
  }
}

function allConversationRows() {
  const sessionRow = sessionConversationRow({
    draft: state.draft,
    active: state.currentDraftActive,
    loadMode: state.loadMode,
    updatedAt: state.currentDraftUpdatedAt
  });
  return conversationLibraryRows({
    session: sessionRow,
    drafts: state.drafts,
    families: state.publishedFamilies,
    archives: state.archives
  });
}

function statusLabel(status) {
  return {
    draft: "Draft",
    published: "Published",
    archived: "Archived"
  }[String(status || "").toLowerCase()] || "Published";
}

export function formatUpdatedAt(value, locales = undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(locales, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function stepPassingScore(value, delta) {
  const parsed = Number(value);
  const current = String(value ?? "").trim() && Number.isFinite(parsed) ? parsed : 100;
  const step = Number(delta) < 0 ? -1 : 1;
  return Math.min(100, Math.max(1, current + step));
}

export function wirePassingScoreStepper({
  input,
  incrementButton,
  decrementButton,
  onChange
} = {}) {
  const applyStep = (delta) => {
    if (!input) return null;
    const previousValue = Number(input.value);
    const value = stepPassingScore(input.value, delta);
    if (Number.isFinite(previousValue) && value === previousValue) return value;
    input.value = String(value);
    if (typeof onChange === "function") onChange(value);
    else input.dispatchEvent(new Event("change", { bubbles: true }));
    return value;
  };
  incrementButton?.addEventListener("click", () => applyStep(1));
  decrementButton?.addEventListener("click", () => applyStep(-1));
  return applyStep;
}

const CONVERSATION_SORT_CONFIG = {
  title: {
    label: "Conversation",
    defaultDirection: "ascending",
    ascendingLabel: "A to Z",
    descendingLabel: "Z to A"
  },
  teamAudience: {
    label: "Team",
    defaultDirection: "ascending",
    ascendingLabel: "A to Z",
    descendingLabel: "Z to A"
  },
  topic: {
    label: "Topic",
    defaultDirection: "ascending",
    ascendingLabel: "A to Z",
    descendingLabel: "Z to A"
  },
  subtopic: {
    label: "Subtopic",
    defaultDirection: "ascending",
    ascendingLabel: "A to Z",
    descendingLabel: "Z to A"
  },
  updatedAt: {
    label: "Last updated",
    defaultDirection: "descending",
    ascendingLabel: "Oldest first",
    descendingLabel: "Newest first"
  }
};

function normalizedConversationSort({ key = "updatedAt", direction } = {}) {
  const normalizedKey = Object.hasOwn(CONVERSATION_SORT_CONFIG, key) ? key : "updatedAt";
  const fallbackDirection = CONVERSATION_SORT_CONFIG[normalizedKey].defaultDirection;
  return {
    key: normalizedKey,
    direction: ["ascending", "descending"].includes(direction)
      ? direction
      : fallbackDirection
  };
}

export function nextConversationSort(current = {}, requestedKey = current.key) {
  const normalized = normalizedConversationSort(current);
  const key = Object.hasOwn(CONVERSATION_SORT_CONFIG, requestedKey)
    ? requestedKey
    : normalized.key;
  if (key !== normalized.key) {
    return { key, direction: CONVERSATION_SORT_CONFIG[key].defaultDirection };
  }
  return {
    key,
    direction: normalized.direction === "ascending" ? "descending" : "ascending"
  };
}

export function syncConversationSortControls({
  key = "updatedAt",
  direction,
  buttons = [],
  mobileKeySelect,
  mobileButton
} = {}) {
  const normalized = normalizedConversationSort({ key, direction });
  const config = CONVERSATION_SORT_CONFIG[normalized.key];
  const currentLabel = normalized.direction === "ascending"
    ? config.ascendingLabel
    : config.descendingLabel;
  const nextLabel = normalized.direction === "ascending"
    ? config.descendingLabel
    : config.ascendingLabel;
  (Array.isArray(buttons) ? buttons : []).filter(Boolean).forEach((button) => {
    const buttonKey = button.dataset.conversationSortKey;
    const buttonConfig = CONVERSATION_SORT_CONFIG[buttonKey];
    const header = button.parentElement?.tagName === "TH" ? button.parentElement : null;
    const active = buttonKey === normalized.key;
    header?.setAttribute("aria-sort", active ? normalized.direction : "none");
    if (!buttonConfig) return;
    button.setAttribute(
      "aria-label",
      active
        ? `${buttonConfig.label}, ${currentLabel}. Sort ${nextLabel}.`
        : `${buttonConfig.label}. Sort ${
            buttonConfig.defaultDirection === "descending"
              ? buttonConfig.descendingLabel
              : buttonConfig.ascendingLabel
          }.`
    );
  });
  if (mobileKeySelect) mobileKeySelect.value = normalized.key;
  if (mobileButton) {
    mobileButton.textContent = currentLabel;
    mobileButton.setAttribute(
      "aria-label",
      `${config.label}, ${currentLabel}. Sort ${nextLabel}.`
    );
  }
  return normalized;
}

export function archiveConfirmationForRow(row = {}) {
  const title = String(row.title || "Untitled conversation").trim() || "Untitled conversation";
  return row.source === "published"
    ? `Archive "${title}"? It will be removed from the learner library. You can restore it later.`
    : `Archive "${title}"? It will be hidden from My Conversations. You can restore it later.`;
}

export async function setConversationArchiveState({
  archives = [],
  kind,
  id,
  archived,
  request = requestJson
} = {}) {
  const response = await request("/api/builder/archive", {
    method: "POST",
    body: JSON.stringify({ kind, id, archived })
  });
  const responseArchive = response?.archive;
  const responseMatches = archived
    ? response?.archived === true &&
      responseArchive?.kind === kind &&
      responseArchive?.id === id &&
      Number.isFinite(Date.parse(responseArchive?.archivedAt || ""))
    : response?.archived === false && responseArchive === null;
  if (!responseMatches) {
    throw new Error("Conversation Builder could not verify the archive update.");
  }
  const key = archiveKey(kind, id);
  const remaining = (Array.isArray(archives) ? archives : [])
    .filter((entry) => archiveKey(entry?.kind, entry?.id) !== key)
    .map(clone);
  return archived ? [clone(responseArchive), ...remaining] : remaining;
}

export function createConversationArchiveMutationQueue() {
  let pending = Promise.resolve();
  return (mutation) => {
    const next = pending.then(() => mutation());
    pending = next.catch(() => {});
    return next;
  };
}

export async function runConversationArchiveAction(row, {
  archived = row?.archived !== true,
  archives = [],
  confirmArchive = (message) => window.confirm(message),
  persistDraft = persistCurrentDraft,
  setArchiveState = setConversationArchiveState
} = {}) {
  if (!row) return { changed: false, archives };
  if (archived && !confirmArchive(archiveConfirmationForRow(row))) {
    return { changed: false, cancelled: true, archives };
  }
  let kind = row.archiveKind;
  let id = row.archiveId;
  if (archived && row.source === "session") {
    const saved = await persistDraft({ status: "draft" });
    id = String(saved?.draft?.draftId || "").trim();
    kind = "draft";
    if (!saved?.saved || !id) {
      if (saved?.conflict && saved?.error) throw saved.error;
      throw new Error("Save the current draft before archiving it.");
    }
  }
  if (!["published", "draft"].includes(kind) || !String(id || "").trim()) {
    throw new Error("Refresh the conversation list and try again.");
  }
  const nextArchives = await setArchiveState({
    archives,
    kind,
    id,
    archived
  });
  return {
    changed: true,
    archived,
    archives: nextArchives,
    kind,
    id
  };
}

export function presentConversationArchiveFailure(error, row = {}, {
  notify = showToast,
  reloadSavedDraft = (draftId) => openPersistentDraftConversation({ source: "draft", draftId })
} = {}) {
  if (error?.code === "DRAFT_WRITE_CONFLICT") {
    const draftId = String(row?.draftId || row?.archiveId || "").trim();
    notify(
      "This draft changed in another tab. Reload the saved draft before archiving.",
      draftId ? {
        actionLabel: "Reload saved draft",
        onAction: () => reloadSavedDraft(draftId)
      } : {}
    );
    return { conflict: true, recoverable: Boolean(draftId) };
  }
  notify("Archive could not be updated. Refresh and try again.");
  return { conflict: false, recoverable: false };
}

function renderConversationFilterOptions(rows) {
  const filters = conversationFilterState(rows, {
    topic: elements.conversationTopicFilter.value,
    subtopic: elements.conversationSubtopicFilter.value
  });
  elements.conversationTopicFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All topics";
  elements.conversationTopicFilter.append(all);
  filters.topics.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    elements.conversationTopicFilter.append(option);
  });
  elements.conversationTopicFilter.value = filters.topic;

  elements.conversationSubtopicFilter.innerHTML = "";
  const allSubtopics = document.createElement("option");
  allSubtopics.value = "all";
  allSubtopics.textContent = "All subtopics";
  elements.conversationSubtopicFilter.append(allSubtopics);
  filters.subtopics.forEach((subtopic) => {
    const option = document.createElement("option");
    option.value = subtopic;
    option.textContent = subtopic;
    elements.conversationSubtopicFilter.append(option);
  });
  elements.conversationSubtopicFilter.value = filters.subtopic;
  elements.conversationSubtopicFilter.disabled = filters.subtopicDisabled;
  return filters;
}

function tableCell(label, content) {
  const cell = document.createElement("td");
  cell.dataset.label = label;
  if (content instanceof Node) cell.append(content);
  else cell.textContent = String(content || "");
  return cell;
}

export function createLibraryIconAction({
  documentRef = browserDocument,
  action,
  rowKey,
  iconName,
  label,
  disabled = false
} = {}) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "library-action library-icon-action";
  button.dataset.libraryAction = action;
  button.dataset.rowKey = rowKey;
  button.disabled = disabled;
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.removeAttribute("title");
  const icon = documentRef.createElement("img");
  icon.src = `/builder-studio/assets/icons/${iconName}.svg`;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  return button;
}

function renderConversationLibrary() {
  if (!elements.conversationLibraryBody) return;
  const rows = allConversationRows();
  syncConversationSortControls({
    key: state.conversationSortKey,
    direction: state.conversationSortDirection,
    buttons: elements.conversationSortButtons,
    mobileKeySelect: elements.conversationMobileSortKey,
    mobileButton: elements.conversationMobileSortButton
  });
  const filters = renderConversationFilterOptions(rows);
  const filtered = sortConversationRows(filterConversationRows(rows, {
    query: elements.conversationSearchInput.value,
    status: elements.conversationStatusFilter.value,
    topic: filters.topic,
    subtopic: filters.subtopic
  }), state.conversationSortKey, state.conversationSortDirection);
  elements.conversationLibraryBody.innerHTML = "";
  filtered.forEach((row) => {
    const tableRow = document.createElement("tr");
    tableRow.dataset.rowKey = row.key;
    tableRow.dataset.familyId = row.familyId || "";
    tableRow.dataset.draftId = row.draftId || "";

    const title = document.createElement("div");
    title.className = "conversation-title";
    const titleText = document.createElement("strong");
    titleText.textContent = row.title;
    titleText.dataset.tooltip = row.title;
    title.append(titleText);
    if (row.source === "session") {
      const detail = document.createElement("small");
      detail.textContent = "Current in-tab draft";
      title.append(detail);
    }

    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.dataset.status = row.status;
    badge.textContent = statusLabel(row.status);

    const actions = document.createElement("div");
    actions.className = "library-actions";
    const editAction = conversationEditAction(row);
    const edit = createLibraryIconAction({
      action: "edit",
      rowKey: row.key,
      iconName: "pencil",
      label: `Edit ${row.title}`,
      disabled: !editAction.enabled
    });
    edit.dataset.loadAsCopy = String(editAction.loadAsCopy);
    const duplicate = createLibraryIconAction({
      action: "duplicate",
      rowKey: row.key,
      iconName: "copy",
      label: `Duplicate ${row.title}`,
      disabled: row.archived === true
    });
    const archiveLabel = row.archived ? "Restore" : "Archive";
    const archive = createLibraryIconAction({
      action: "archive",
      rowKey: row.key,
      iconName: "archive",
      label: `${archiveLabel} ${row.title}`,
      disabled: row.source === "published" && row.archivable !== true
    });
    actions.append(edit, duplicate, archive);

    tableRow.append(
      tableCell("Conversation", title),
      tableCell("Team", row.teamAudience || "Not available"),
      tableCell("Topic", row.topic || "Not available"),
      tableCell("Subtopic", row.subtopic || "Not available"),
      tableCell("Status", badge),
      tableCell("Last updated", formatUpdatedAt(row.updatedAt)),
      tableCell("Actions", actions)
    );
    elements.conversationLibraryBody.append(tableRow);
  });
  elements.conversationLibraryEmpty.hidden = filtered.length > 0;
  elements.catalogStatus.textContent = state.catalogError || `${filtered.length} of ${rows.length} ${rows.length === 1 ? "conversation" : "conversations"}`;
  syncSelectTitles(elements.conversationLibrary);
}

const enqueueConversationArchiveMutation = createConversationArchiveMutationQueue();

async function updateConversationArchive(row, archived, {
  offerUndo = true,
  skipConfirmation = false
} = {}) {
  return enqueueConversationArchiveMutation(async () => {
    try {
      const result = await runConversationArchiveAction(row, {
        archived,
        archives: state.archives,
        ...(skipConfirmation ? { confirmArchive: () => true } : {})
      });
      if (!result.changed) return false;
      state.archives = result.archives;
      await loadPublishedCatalog();
      const nextRow = {
        ...row,
        archiveKind: result.kind,
        archiveId: result.id,
        archived
      };
      showToast(archived ? "Conversation archived." : "Conversation restored.", offerUndo ? {
        actionLabel: "Undo",
        onAction: () => updateConversationArchive(nextRow, !archived, {
          offerUndo: false,
          skipConfirmation: true
        })
      } : {});
      return true;
    } catch (error) {
      presentConversationArchiveFailure(error, row);
      return false;
    }
  });
}

function openCurrentDraft() {
  setBuilderView("workflow", { focus: false });
  setStage(state.reviewStarted ? "review" : "create");
}

function applyDraftToWorkflow({
  draft,
  canonicalScenarios = [],
  copyOrigin = null,
  loadResult = null,
  persistentDraft = null,
  authoringDraft = false,
  assetPublicationId = ""
}) {
  resetPublicationContext();
  if (copyOrigin) {
    state.copyOrigin = copyOrigin;
  } else if (persistentDraft) {
    state.loadedFamilyId = persistentDraft.familyId;
    state.expectedBasePublicationId = persistentDraft.basePublicationId;
    state.loadMode = persistentDraft.mode;
    state.draftEtag = persistentDraft.etag;
    state.revisionStatus = persistentDraft.mode === "editable" ? "current" : "";
  } else if (loadResult) {
    state.loadedFamilyId = loadResult.familyId;
    state.expectedBasePublicationId = loadResult.expectedBasePublicationId;
    state.loadMode = "editable";
    state.revisionStatus = "current";
    state.releaseNote = "";
    state.publishOperationId = "";
  }
  const preparedStandardText = prepareStandardTextMode({
    draft: authoringDraft
      ? normalizePhaseAuthoringDraft(draft)
      : normalizeStudioDraft(draft),
    hotkeys: state.hotkeys,
    isNew: false
  });
  state.draft = preparedStandardText.draft;
  state.standardTextMode = preparedStandardText.mode;
  if (persistentDraft?.draftId) state.draft.draftId = persistentDraft.draftId;
  state.sourceGrounding = clone(state.draft.sourceGrounding);
  state.pendingSourceUpdate = null;
  resetReviewProgress();
  state.loadedCanonicalScenarios = clone(canonicalScenarios);
  state.loadedBaselineDraft = clone(state.draft);
  state.assetPublicationId = assetPublicationId;
  state.currentDraftActive = true;
  state.currentDraftUpdatedAt = persistentDraft?.updatedAt || new Date().toISOString();
  state.savedDraft = clone(state.draft);
  state.validation = null;
  state.composed = null;
  state.publishChecks = { authoritative: "not_run", privacy: "not_run" };
  renderCreateSummary();
  renderSourceGrounding();
  renderReview();
  setStandardTextMode(state.standardTextMode);
  updateSavedState({ draftId: state.draft.draftId });
  setGlobalStatus("");
  setBuilderView("workflow", { focus: false });
  setStage("review");
}

export async function openPersistentDraftConversation(row, {
  duplicate = false,
  loadDraft = async (draftId) => {
    const response = await requestJsonWithMetadata(
      `/api/builder/drafts/${encodeURIComponent(draftId)}`
    );
    return { draft: response.payload?.draft, etag: response.etag };
  },
  applyWorkflow = applyDraftToWorkflow,
  createSuffix = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8),
  notify = showToast
} = {}) {
  const requestedDraftId = String(row?.draftId || "").trim();
  if (!requestedDraftId) throw new Error("Choose a valid saved draft.");
  const loaded = await loadDraft(requestedDraftId);
  const envelope = loaded?.draft;
  if (
    !envelope ||
    envelope.draftId !== requestedDraftId ||
    envelope.status !== "draft" ||
    !envelope.content ||
    typeof envelope.content !== "object" ||
    Array.isArray(envelope.content)
  ) {
    throw new Error("Conversation Builder could not use that saved draft.");
  }
  const draft = normalizePhaseAuthoringDraft({
    ...clone(envelope.content),
    draftId: envelope.draftId,
    scenario: {
      ...(envelope.content.scenario || {}),
      baseId: envelope.familyId
    }
  });
  draft.draftId = envelope.draftId;
  if (duplicate) {
    const copied = duplicateConversationDraft({
      draft,
      suffix: createSuffix(),
      sourceTitle: draft.scenario.title
    });
    applyWorkflow({
      draft: copied.draft,
      canonicalScenarios: copied.canonicalScenarios,
      copyOrigin: { familyId: envelope.familyId, title: draft.scenario.title },
      authoringDraft: true,
      assetPublicationId: envelope.basePublicationId || ""
    });
    notify("Conversation duplicated as a separate editable copy.");
    return { draft: copied.draft, duplicated: true };
  }
  const persistentDraft = {
    draftId: envelope.draftId,
    familyId: envelope.familyId,
    mode: envelope.mode,
    basePublicationId: envelope.basePublicationId,
    updatedAt: envelope.updatedAt,
    etag: String(loaded.etag || "")
  };
  applyWorkflow({
    draft,
    persistentDraft,
    authoringDraft: true,
    assetPublicationId: envelope.basePublicationId || ""
  });
  notify("Saved draft opened");
  return { draft, persistentDraft, duplicated: false };
}

export async function routeConversationLibraryAction({
  row,
  action = "edit",
  openSession = () => {},
  duplicateSession = () => {},
  openPersistent = () => {},
  openPublished = () => {}
} = {}) {
  if (!row) return false;
  const duplicate = action === "duplicate";
  if (row.source === "session") {
    await (duplicate ? duplicateSession : openSession)(row);
    return true;
  }
  if (row.source === "draft") {
    await openPersistent(row, { duplicate });
    return true;
  }
  await openPublished(row, {
    duplicate,
    editRequested: action === "edit"
  });
  return true;
}

export function resolvePublishedAuthoringDraft({
  loadResult,
  createDraftId = () => `revision_${crypto.randomUUID().replace(/-/g, "")}`
} = {}) {
  const familyId = String(loadResult?.familyId || "").trim();
  const scenarios = Array.isArray(loadResult?.scenarios) ? clone(loadResult.scenarios) : [];
  if (!familyId || !scenarios.length) {
    throw new Error("Conversation Builder could not use that published conversation.");
  }
  const snapshot = loadResult?.authoringSnapshot &&
    typeof loadResult.authoringSnapshot === "object" &&
    !Array.isArray(loadResult.authoringSnapshot)
    ? clone(loadResult.authoringSnapshot)
    : null;
  const imported = snapshot ? { draft: snapshot } : importStudioScenarios(scenarios);
  let draft = normalizeStudioDraft(imported.draft);
  draft.evaluation.mode = "focused_learning_objectives";
  if (loadResult.mode !== "editable") {
    return { draft, canonicalScenarios: scenarios, persistentDraft: null };
  }
  const binding = loadResult.draftPersistence;
  const boundDraftId = snapshot && binding?.draftId === snapshot.draftId
    ? String(binding.draftId || "").trim()
    : "";
  const draftId = boundDraftId || String(createDraftId() || "").trim();
  if (
    !/^[a-z0-9](?:[a-z0-9_-]{1,126}[a-z0-9])$/.test(draftId) ||
    (!boundDraftId && draftId === familyId)
  ) {
    throw new Error("Conversation Builder could not create a safe revision draft.");
  }
  draft = normalizeStudioDraft({
    ...draft,
    draftId,
    scenario: { ...draft.scenario, baseId: familyId }
  });
  draft.draftId = draftId;
  return {
    draft,
    canonicalScenarios: scenarios,
    persistentDraft: {
      draftId,
      familyId,
      mode: "editable",
      basePublicationId: loadResult.expectedBasePublicationId,
      updatedAt: boundDraftId ? String(binding.updatedAt || "") : "",
      etag: boundDraftId ? String(binding.etag || "") : ""
    }
  };
}

async function openPublishedFamily(family, { duplicate = false, editRequested = false } = {}) {
  if (!family) {
    showToast("Refresh the conversation list and choose it again.");
    return;
  }
  elements.catalogStatus.textContent = duplicate ? "Creating a separate copy…" : "Opening the current published version…";
  try {
    const result = await requestJson("/api/builder/load", {
      method: "POST",
      body: JSON.stringify({
        familyId: family.familyId,
        expectedPublicationId: family.currentPublicationId ?? null
      })
    });
    const resolved = resolvePublishedAuthoringDraft({ loadResult: result });
    let draft = resolved.draft;
    let canonicalScenarios = resolved.canonicalScenarios;
    const shouldCopy = duplicate || result.mode === "copyOnly";
    if (shouldCopy) {
      const copySuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const copied = duplicateConversationDraft({
        draft,
        canonicalScenarios,
        suffix: copySuffix,
        sourceTitle: family.title
      });
      draft = copied.draft;
      canonicalScenarios = copied.canonicalScenarios;
    }
    applyDraftToWorkflow({
      draft,
      canonicalScenarios,
      copyOrigin: shouldCopy ? { familyId: result.familyId, title: family.title } : null,
      persistentDraft: shouldCopy ? null : resolved.persistentDraft,
      assetPublicationId: family.currentPublicationId || ""
    });
    showToast(shouldCopy
      ? editRequested ? "Editable copy created" : "Conversation duplicated as a separate editable copy."
      : "Your current published conversation is ready to revise.");
  } catch (error) {
    state.catalogError = String(error?.message || error);
    renderConversationLibrary();
  }
}

function duplicateCurrentDraft() {
  const sourceTitle = state.draft?.scenario?.title || "Untitled conversation";
  const assetPublicationId = state.assetPublicationId;
  const copied = duplicateConversationDraft({
    draft: state.draft,
    canonicalScenarios: state.loadedCanonicalScenarios,
    suffix: crypto.randomUUID().replace(/-/g, "").slice(0, 8),
    sourceTitle
  });
  applyDraftToWorkflow({
    draft: copied.draft,
    canonicalScenarios: copied.canonicalScenarios,
    copyOrigin: { familyId: state.draft?.scenario?.baseId || "", title: sourceTitle },
    authoringDraft: true,
    assetPublicationId
  });
  showToast("Conversation duplicated as a separate editable copy.");
}

export function createMinimumInputDraft({
  conversationAbout,
  learnerApproach,
  channels = ["chat", "voice"],
  sourceGrounding = emptySourceGrounding()
}) {
  const situation = String(conversationAbout || "").trim();
  const approach = cleanLines(learnerApproach);
  if (!situation || !approach.length) {
    throw new Error("Answer both questions before building the draft.");
  }
  const isAvoidance = (item) => /^(?:avoid|do not|don't|never)\b/iu.test(item);
  const correct = approach.filter((item) => !isAvoidance(item));
  if (!correct.length) {
    throw new Error("Describe at least one thing the Learner should do.");
  }
  const avoided = approach
    .filter(isAvoidance)
    .map((item) => item.replace(/^avoid:\s*/iu, ""));
  const normalizedGrounding = normalizeSourceGrounding(sourceGrounding);
  const sourceMaterial = normalizedGrounding.documents
    .filter((document) => document.content.trim())
    .map((document) => `Source: ${document.label}\n${document.content}`)
    .join("\n\n");
  const creatorNotes = [
    `What the conversation is about:\n${situation}`,
    `How the Learner should handle the conversation:\n${approach.join("\n")}`
  ].join("\n\n");
  const material = [sourceMaterial, creatorNotes].filter(Boolean).join("\n\n");
  const selectedChannels = [...new Set(Array.isArray(channels) ? channels : [])]
    .filter((channel) => ["chat", "voice"].includes(channel));
  if (!selectedChannels.length) throw new Error("Choose Chat, Voice, or both.");
  const next = createStudioDraft({
    type: "rough_idea",
    material,
    channels: selectedChannels,
    evaluationMode: "focused_learning_objectives"
  });
  next.source = { type: "rough_idea", material };
  if (situation) next.scenario.description = situation;
  next.scenario.channels = selectedChannels;
  next.evaluation.mode = "focused_learning_objectives";
  if (correct.length) next.handling.correct = correct;
  if (avoided.length) next.handling.avoid = avoided;
  next.evaluation.criteria = [...correct];
  const objectiveId = "approved_conversation_path";
  next.evaluation.objectives = [{
    id: objectiveId,
    label: "Lead the conversation effectively",
    description: "Demonstrate the expected approach and outcome for this conversation.",
    criteria: correct.map((text, index) => ({
      id: `${objectiveId}_criterion_${index + 1}`,
      text
    }))
  }];
  next.guidance.sections = next.handling.correct.map((step, index) => ({
    title: `${index + 1}. Conversation Phase`,
    body: step,
    bullets: [step]
  }));
  const grounded = applySourceGroundingToDraft(next, normalizedGrounding);
  const objective = grounded.evaluation.objectives[0];
  const criteriaByText = new Map(
    objective.criteria.map((criterion) => [
      typeof criterion === "object" ? criterion.text : criterion,
      typeof criterion === "object"
        ? criterion.id
        : `${objective.id}_criterion_${objective.criteria.indexOf(criterion) + 1}`
    ])
  );
  grounded.flow = {
    phases: grounded.handling.correct.map((strongLearnerResponse, index) => {
      const guidance = grounded.guidance.sections[index] || {};
      const criterionId = criteriaByText.get(strongLearnerResponse);
      return {
        id: `phase_${index + 1}`,
        title: guidance.title || `${index + 1}. Conversation Phase`,
        purpose: guidance.body || strongLearnerResponse,
        partnerTurn: index === 0
          ? grounded.scenario.openingLine
          : grounded.handling.customerResponses[index - 1],
        strongLearnerResponse,
        coachGuidance: {
          title: guidance.title || `${index + 1}. Conversation Phase`,
          bullets: (guidance.bullets || [guidance.body || strongLearnerResponse]).map((text, bulletIndex) => ({
            id: `phase_${index + 1}_guidance_${bulletIndex + 1}`,
            text
          }))
        },
        advanceWhen: strongLearnerResponse,
        evaluationLinks: criterionId
          ? [{ objectiveId: objective.id, criterionIds: [criterionId] }]
          : []
      };
    }),
    closingPartnerTurn:
      grounded.handling.customerResponses.at(-1) || grounded.facts.closingLine
  };
  return normalizeStudioDraft(grounded);
}

export function objectivesReviewed(objectives = [], approvals = {}) {
  return objectives.length > 0 && objectives.every((objective) =>
    objective?.reviewStatus === "approved" || approvals[objective?.id] === true
  );
}

function criterionId(criterion) {
  return typeof criterion === "object" ? String(criterion?.id || "") : "";
}

const MAX_CRITERIA_PER_OBJECTIVE = 8;

export function remapCanonicalEvaluationCitations(
  grounding,
  beforeObjectives = [],
  afterObjectives = []
) {
  const next = normalizeSourceGrounding(grounding);
  const afterObjectiveIndexById = new Map(afterObjectives.map((objective, index) => [
    String(objective?.id || ""),
    index
  ]));
  const citations = {};
  Object.entries(next.citations).forEach(([path, entries]) => {
    const objectiveMatch = path.match(/^evaluation\.objectives\.(\d+)(?:\.(.*))?$/);
    if (!objectiveMatch) {
      citations[path] = entries;
      return;
    }
    const beforeObjective = beforeObjectives[Number(objectiveMatch[1])];
    const afterObjectiveIndex = afterObjectiveIndexById.get(String(beforeObjective?.id || ""));
    if (afterObjectiveIndex === undefined) return;
    let suffix = objectiveMatch[2] || "";
    const criterionMatch = suffix.match(/^criteria\.(\d+)(?:\.(.*))?$/);
    if (criterionMatch) {
      const beforeCriterionId = criterionId(
        beforeObjective?.criteria?.[Number(criterionMatch[1])]
      );
      const afterCriterionIndex = (afterObjectives[afterObjectiveIndex]?.criteria || [])
        .findIndex((criterion) => criterionId(criterion) === beforeCriterionId);
      if (!beforeCriterionId || afterCriterionIndex < 0) return;
      suffix = `criteria.${afterCriterionIndex}${criterionMatch[2] ? `.${criterionMatch[2]}` : ""}`;
    }
    const remappedPath = `evaluation.objectives.${afterObjectiveIndex}${suffix ? `.${suffix}` : ""}`;
    citations[remappedPath] = entries;
  });
  next.citations = citations;
  return next;
}

export function resolvePhaseEvaluation(draft, phaseIndex) {
  const phase = draft?.flow?.phases?.[phaseIndex];
  if (!phase) return [];
  const links = new Map((phase.evaluationLinks || []).map((link) => [
    link.objectiveId,
    new Set(link.criterionIds || [])
  ]));
  return (draft?.evaluation?.objectives || []).map((objective) => {
    const selected = links.get(objective.id) || new Set();
    return {
      id: objective.id,
      label: objective.label || "",
      description: objective.description || "",
      selectedCriterionIds: [...selected],
      criteria: (objective.criteria || []).map((criterion) => ({
        id: criterionId(criterion),
        text: typeof criterion === "object" ? String(criterion?.text || "") : String(criterion || ""),
        selected: selected.has(criterionId(criterion))
      }))
    };
  });
}

export function updateCanonicalObjective(draft, objectiveId, changes = {}) {
  const next = clone(draft);
  next.evaluation.objectives = (next.evaluation?.objectives || []).map((objective) =>
    objective.id === objectiveId
      ? {
          ...objective,
          ...(Object.hasOwn(changes, "label") ? { label: String(changes.label || "") } : {}),
          ...(Object.hasOwn(changes, "description")
            ? { description: String(changes.description || "") }
            : {})
        }
      : objective
  );
  return next;
}

export function updateCanonicalCriterion(draft, objectiveId, targetCriterionId, value) {
  const next = clone(draft);
  next.evaluation.objectives = (next.evaluation?.objectives || []).map((objective) => {
    if (objective.id !== objectiveId) return objective;
    return {
      ...objective,
      criteria: (objective.criteria || []).map((criterion) =>
        criterionId(criterion) === targetCriterionId
          ? { ...criterion, id: targetCriterionId, text: String(value || "") }
          : criterion
      )
    };
  });
  return next;
}

export function updatePhaseEvaluationAssignment(
  draft,
  phaseId,
  objectiveId,
  targetCriterionId,
  selected
) {
  const next = clone(draft);
  next.flow.phases = (next.flow?.phases || []).map((phase) => {
    if (phase.id !== phaseId) return phase;
    const links = clone(phase.evaluationLinks || []);
    const linkIndex = links.findIndex((link) => link.objectiveId === objectiveId);
    const link = linkIndex >= 0
      ? links[linkIndex]
      : { objectiveId, criterionIds: [] };
    const criterionIds = [...(link.criterionIds || [])];
    const currentIndex = criterionIds.indexOf(targetCriterionId);
    if (selected && currentIndex < 0) criterionIds.push(targetCriterionId);
    if (!selected && currentIndex >= 0) criterionIds.splice(currentIndex, 1);
    const updated = { ...link, criterionIds };
    if (linkIndex >= 0) links[linkIndex] = updated;
    else if (criterionIds.length) links.push(updated);
    phase.evaluationLinks = links.filter((item) => item.criterionIds?.length);
    return phase;
  });
  return next;
}

export function addCanonicalCriterion(
  draft,
  objectiveId,
  phaseId,
  createId = guidanceItemId
) {
  const next = clone(draft);
  const objective = next.evaluation?.objectives?.find((item) => item.id === objectiveId);
  const phase = next.flow?.phases?.find((item) => item.id === phaseId);
  const criteria = Array.isArray(objective?.criteria) ? objective.criteria : [];
  if (!objective || !phase || criteria.length >= MAX_CRITERIA_PER_OBJECTIVE) {
    return { draft: next, criterionId: "" };
  }
  const newCriterionId = String(createId("criterion") || "").trim();
  if (
    !newCriterionId ||
    criteria.some((criterion) => criterionId(criterion) === newCriterionId)
  ) {
    return { draft: next, criterionId: "" };
  }
  objective.criteria = [
    ...criteria,
    { id: newCriterionId, text: "" }
  ];
  return {
    draft: updatePhaseEvaluationAssignment(
      next,
      phaseId,
      objectiveId,
      newCriterionId,
      true
    ),
    criterionId: newCriterionId
  };
}

export function removeCanonicalCriterionFromPhase(
  draft,
  objectiveId,
  targetCriterionId,
  phaseId
) {
  const beforeObjectives = draft?.evaluation?.objectives || [];
  const next = updatePhaseEvaluationAssignment(
    draft,
    phaseId,
    objectiveId,
    targetCriterionId,
    false
  );
  const stillAssigned = (next.flow?.phases || []).some((phase) =>
    (phase.evaluationLinks || []).some((link) =>
      link.objectiveId === objectiveId &&
      (link.criterionIds || []).includes(targetCriterionId)
    )
  );
  if (stillAssigned) return next;
  next.evaluation.objectives = (next.evaluation?.objectives || []).map((objective) =>
    objective.id === objectiveId
      ? {
          ...objective,
          criteria: (objective.criteria || []).filter((criterion) =>
            criterionId(criterion) !== targetCriterionId
          )
        }
      : objective
  );
  if (next.sourceGrounding) {
    next.sourceGrounding = remapCanonicalEvaluationCitations(
      next.sourceGrounding,
      beforeObjectives,
      next.evaluation.objectives
    );
  }
  return next;
}

export function blockingPhaseEvaluationFindings(draft) {
  return runScenarioHealthCheck(draft).findings.filter(isBlockingPhaseEvaluationFinding);
}

export function isEvaluationReadyForTest(draft) {
  return isEvaluationApproved(draft) && blockingPhaseEvaluationFindings(draft).length === 0;
}

function firstEvaluationPhase(draft, objectiveId, criterionId = "") {
  const phases = draft?.flow?.phases || [];
  return phases.find((phase) => (phase.evaluationLinks || []).some((link) =>
    link.objectiveId === objectiveId && (
      !criterionId || (link.criterionIds || []).includes(criterionId)
    )
  )) || phases.find((phase) => (phase.evaluationLinks || []).some((link) =>
    link.objectiveId === objectiveId
  )) || phases[0];
}

function canonicalCreatorPhaseIndex(value) {
  const normalized = String(value ?? "");
  if (!/^(?:0|[1-9]|1[01])$/.test(normalized)) return null;
  return Number(normalized);
}

export function reviewFindingTargets(draft, findings = blockingPhaseEvaluationFindings(draft)) {
  const phases = draft?.flow?.phases || [];
  const objectives = draft?.evaluation?.objectives || [];
  return findings.flatMap((finding) => {
    if (String(finding?.fieldPath || "") === "flow.closingPartnerTurn") {
      const phase = phases.at(-1);
      return phase ? [{
        finding,
        phaseId: phase.id,
        phaseIndex: phases.length - 1,
        focusKey: `closing-partner-turn:${phase.id}`,
      }] : [];
    }
    const phaseMatch = String(finding?.fieldPath || "").match(/^flow\.phases\.(\d+)\.(.+)$/);
    if (phaseMatch) {
      const phaseIndex = canonicalCreatorPhaseIndex(phaseMatch[1]);
      if (phaseIndex === null) return [];
      const phase = phases[phaseIndex];
      if (!phase) return [];
      const field = phaseMatch[2];
      const firstGuidanceId = phase.coachGuidance?.bullets?.[0]?.id;
      const firstLink = phase.evaluationLinks?.[0];
      const firstCriterionId = firstLink?.criterionIds?.[0];
      const firstObjective = objectives[0];
      const firstAvailableCriterionId = criterionId(firstObjective?.criteria?.[0]);
      const chatRequirementMatch = field.match(/^chatAdvanceRequirements(?:\.(\d+))?/);
      const chatRequirement = chatRequirementMatch
        ? phase.chatAdvanceRequirements?.[Number(chatRequirementMatch[1] || 0)]
        : null;
      const focusKey = field.startsWith("partnerTurn")
        ? `partner-turn:${phase.id}`
        : field.startsWith("strongLearnerResponse")
          ? `strong-response:${phase.id}`
          : field.startsWith("chatAdvanceRequirements")
            ? chatRequirement
              ? `chat-requirement-phrases:${phase.id}:${chatRequirement.id}`
              : `add-chat-requirement:${phase.id}`
          : field.startsWith("evaluationLinks")
            ? firstLink && firstCriterionId
              ? `criterion-text:${phase.id}:${firstLink.objectiveId}:${firstCriterionId}`
              : firstLink
                ? `add-criterion:${phase.id}:${firstLink.objectiveId}`
                : firstObjective && firstAvailableCriterionId
                  ? `add-objective:${phase.id}`
                : `phase-title:${phase.id}`
            : field.startsWith("coachGuidance")
              ? guidanceFindingFocusKey(phase, field)
                || (firstGuidanceId
                  ? `guidance-text:${phase.id}:${firstGuidanceId}`
                  : `add-guidance:${phase.id}`)
              : `phase-title:${phase.id}`;
      return [{ finding, phaseId: phase.id, phaseIndex, focusKey }];
    }

    const evaluationMatch = String(finding?.fieldPath || "").match(
      /^evaluation\.objectives\.(\d+)(?:\.(.*))?$/
    );
    if (!evaluationMatch) return [];
    const objective = objectives[Number(evaluationMatch[1])];
    if (!objective) return [];
    const field = evaluationMatch[2] || "";
    const criterionMatch = field.match(/^criteria(?:\.(\d+))?(?:\.(.*))?$/);
    const criterion = criterionMatch
      ? objective.criteria?.[Number(criterionMatch[1] || 0)]
      : null;
    const targetPhase = firstEvaluationPhase(draft, objective.id, criterionId(criterion));
    if (!targetPhase) return [];
    const phaseIndex = phases.findIndex((phase) => phase.id === targetPhase.id);
    const unassignedObjective = String(finding.id || "").startsWith("unassigned-objective-");
    const focusKey = (unassignedObjective && objective.criteria?.length) || (criterionMatch && !criterion)
      ? `add-objective:${targetPhase.id}`
      : criterion
          ? `criterion-text:${targetPhase.id}:${objective.id}:${criterionId(criterion)}`
          : `objective-label:${targetPhase.id}:${objective.id}`;
    return [{
      finding,
      phaseId: targetPhase.id,
      phaseIndex,
      focusKey
    }];
  });
}

function guidanceFindingFocusKey(phase, field) {
  const guidanceMatch = String(field).match(/^coachGuidance\.bullets\.(\d+)(?:\.(.*))?$/);
  if (!guidanceMatch) return "";
  const bullet = phase?.coachGuidance?.bullets?.[Number(guidanceMatch[1])];
  if (!bullet?.id) return "";
  const childMatch = String(guidanceMatch[2] || "").match(/^children\.(\d+)(?:\.(.*))?$/);
  if (!childMatch) return `guidance-text:${phase.id}:${bullet.id}`;
  const child = bullet.children?.[Number(childMatch[1])];
  if (!child?.id) return `guidance-text:${phase.id}:${bullet.id}`;
  return childMatch[2] === "kind"
    ? `child-style:${phase.id}:${child.id}`
    : `child-text:${phase.id}:${child.id}`;
}

export function renderPhaseEvaluation(phase, phaseIndex, {
  document: editorDocument = browserDocument,
  draft = state.draft,
  getDraft = () => draft,
  onDraftChange = () => {},
  onBlur = () => {},
  decorateField = () => {},
  renderObjectiveRecommendation = () => null,
  open = false,
  onOpenChange = () => {}
} = {}) {
  if (!editorDocument || !phase || !draft) return null;
  const section = editorDocument.createElement("section");
  section.className = "phase-evaluation";
  const heading = editorDocument.createElement("h5");
  heading.textContent = "Learning objectives and criteria";
  const intro = editorDocument.createElement("p");
  intro.textContent = "Criteria evaluated in this phase.";
  section.append(heading, intro);

  const resolvedEvaluation = resolvePhaseEvaluation(draft, phaseIndex);
  const evaluationEditor = editorDocument.createElement("details");
  evaluationEditor.className = "phase-evaluation-editor";
  evaluationEditor.open = open !== false;
  evaluationEditor.addEventListener("toggle", () => onOpenChange(evaluationEditor.open));
  const evaluationEditorSummary = editorDocument.createElement("summary");
  evaluationEditorSummary.textContent = "Edit objectives and criteria";
  evaluationEditor.append(evaluationEditorSummary);

  const assignedEvaluation = resolvedEvaluation.filter((objective) =>
    objective.criteria.some((criterion) => criterion.selected)
  );
  assignedEvaluation.forEach((objective) => {
    const card = editorDocument.createElement("article");
    card.className = "phase-objective-card";
    card.dataset.objectiveId = objective.id;
    card.dataset.contentRecommendationSource = contentRecommendationKey("objective", objective.id);
    card.dataset.contentRecommendationLocation = `phase:${phase.id}`;
    const objectiveLabel = editorDocument.createElement("label");
    objectiveLabel.className = "field";
    const objectiveLabelText = editorDocument.createElement("span");
    objectiveLabelText.textContent = "Objective";
    const objectiveInput = editorDocument.createElement("input");
    objectiveInput.value = objective.label;
    objectiveInput.dataset.objectiveLabelInputId = objective.id;
    objectiveInput.dataset.focusKey = `objective-label:${phase.id}:${objective.id}`;
    objectiveInput.addEventListener("input", () => onDraftChange(
      updateCanonicalObjective(getDraft(), objective.id, {
        label: objectiveInput.value
      }),
      {
        path: `evaluation.objectives.${objective.id}.label`,
        objectiveLabelId: objective.id,
        synchronize: true,
        citation: { field: objectiveLabel, input: objectiveInput, actionKey: `${objective.id}:label` }
      }
    ));
    objectiveInput.addEventListener("blur", () => onBlur(phase.id));
    objectiveLabel.append(objectiveLabelText, objectiveInput);
    decorateField(objectiveLabel, {
      objectiveId: objective.id,
      field: "label",
      input: objectiveInput
    });
    const objectiveRecommendation = renderObjectiveRecommendation({
      objectiveId: objective.id,
      phaseId: phase.id
    });

    const criterionEditors = editorDocument.createElement("div");
    criterionEditors.className = "phase-criterion-editors";
    objective.criteria.filter((criterion) => criterion.selected).forEach((criterion, criterionIndex) => {
      const row = editorDocument.createElement("div");
      row.className = "phase-criterion-editor-row";
      const field = editorDocument.createElement("label");
      field.className = "field";
      const fieldLabel = editorDocument.createElement("span");
      fieldLabel.textContent = `Criterion ${criterionIndex + 1}`;
      const input = editorDocument.createElement("textarea");
      input.value = criterion.text;
      input.dataset.criterionTextInputId = criterion.id;
      input.dataset.focusKey = `criterion-text:${phase.id}:${objective.id}:${criterion.id}`;
      input.addEventListener("input", () => onDraftChange(
        updateCanonicalCriterion(getDraft(), objective.id, criterion.id, input.value),
        {
          path: `evaluation.objectives.${objective.id}.criteria.${criterion.id}.text`,
          synchronize: true,
          citation: {
            field,
            input,
            actionKey: `${objective.id}:${criterion.id}:text`
          }
        }
      ));
      input.addEventListener("blur", () => onBlur(phase.id));
      field.append(fieldLabel, input);
      decorateField(field, {
        objectiveId: objective.id,
        criterionId: criterion.id,
        field: "criterion",
        input
      });
      const removeLabel = `Remove criterion ${criterionIndex + 1} from this phase`;
      const remove = removeIconButton({
        label: removeLabel,
        documentRef: editorDocument,
        onClick: () => {
          const remainingCriteria = objective.criteria.filter((item) =>
            item.selected && item.id !== criterion.id
          );
          onDraftChange(
            removeCanonicalCriterionFromPhase(
              getDraft(),
              objective.id,
              criterion.id,
              phase.id
            ),
            {
              path: `flow.phases.${phaseIndex}.evaluationLinks`,
              rerender: true,
              focusKey: remainingCriteria.length
                ? `add-criterion:${phase.id}:${objective.id}`
                : `add-objective:${phase.id}`
            }
          );
        }
      });
      remove.dataset.editorAction = `remove-criterion:${phase.id}:${objective.id}:${criterion.id}`;
      row.append(field, remove);
      criterionEditors.append(row);
    });
    card.append(objectiveLabel);
    if (objectiveRecommendation) card.append(objectiveRecommendation);
    card.append(criterionEditors);
    const addCriterion = editorDocument.createElement("button");
    addCriterion.type = "button";
    addCriterion.className = "button secondary compact-button phase-list-add";
    addCriterion.textContent = "Add criterion";
    addCriterion.dataset.editorAction = `add-criterion:${phase.id}:${objective.id}`;
    addCriterion.dataset.focusKey = addCriterion.dataset.editorAction;
    const reusableCriterion = objective.criteria.find((criterion) =>
      !criterion.selected && criterion.id
    );
    addCriterion.disabled =
      objective.criteria.length >= MAX_CRITERIA_PER_OBJECTIVE && !reusableCriterion;
    addCriterion.setAttribute(
      "aria-label",
      `Add criterion to ${objective.label || "this objective"}`
    );
    addCriterion.addEventListener("click", () => {
      if (
        objective.criteria.length >= MAX_CRITERIA_PER_OBJECTIVE &&
        reusableCriterion
      ) {
        onDraftChange(
          updatePhaseEvaluationAssignment(
            getDraft(),
            phase.id,
            objective.id,
            reusableCriterion.id,
            true
          ),
          {
            path: `flow.phases.${phaseIndex}.evaluationLinks`,
            rerender: true,
            focusKey: `criterion-text:${phase.id}:${objective.id}:${reusableCriterion.id}`
          }
        );
        return;
      }
      const created = addCanonicalCriterion(getDraft(), objective.id, phase.id);
      if (!created.criterionId) return;
      onDraftChange(created.draft, {
        path: `flow.phases.${phaseIndex}.evaluationLinks`,
        rerender: true,
        preserveIncompleteCriterion: true,
        focusKey: `criterion-text:${phase.id}:${objective.id}:${created.criterionId}`
      });
    });
    card.append(addCriterion);
    evaluationEditor.append(card);
  });
  const unassignedObjectives = resolvedEvaluation.filter((objective) =>
    !objective.criteria.some((criterion) => criterion.selected)
  );
  if (unassignedObjectives.length) {
    const addObjectiveLabel = editorDocument.createElement("label");
    addObjectiveLabel.className = "field compact-assignment-control";
    const addObjectiveText = editorDocument.createElement("span");
    addObjectiveText.textContent = "Add objective";
    const addObjective = editorDocument.createElement("select");
    addObjective.dataset.editorControl = `add-objective:${phase.id}`;
    addObjective.dataset.focusKey = addObjective.dataset.editorControl;
    const placeholder = editorDocument.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose an objective";
    addObjective.append(placeholder);
    unassignedObjectives.forEach((objective) => {
      const option = editorDocument.createElement("option");
      option.value = objective.id;
      option.dataset.objectiveLabelId = objective.id;
      option.textContent = objective.label || "Untitled objective";
      addObjective.append(option);
    });
    addObjective.addEventListener("change", () => {
      const objective = unassignedObjectives.find((item) => item.id === addObjective.value);
      if (!objective) return;
      const firstCriterion = objective.criteria?.[0];
      const created = firstCriterion
        ? {
            draft: updatePhaseEvaluationAssignment(
              getDraft(),
              phase.id,
              objective.id,
              firstCriterion.id,
              true
            ),
            criterionId: firstCriterion.id
          }
        : addCanonicalCriterion(getDraft(), objective.id, phase.id);
      if (!created.criterionId) return;
      onDraftChange(created.draft, {
        path: `flow.phases.${phaseIndex}.evaluationLinks`,
        rerender: true,
        preserveIncompleteCriterion: !firstCriterion,
        focusKey: `criterion-text:${phase.id}:${objective.id}:${created.criterionId}`
      });
    });
    addObjectiveLabel.append(addObjectiveText, addObjective);
    evaluationEditor.append(addObjectiveLabel);
  }
  section.append(evaluationEditor);

  if (!resolvedEvaluation.length) {
    const empty = editorDocument.createElement("p");
    empty.className = "phase-guidance-empty";
    empty.textContent = "Add an objective before assigning criteria to this phase.";
    section.append(empty);
  }
  return section;
}

function reviewIsComplete() {
  return state.reviewStarted && blockingPhaseEvaluationFindings(state.draft).length === 0;
}

function resetReviewProgress() {
  resetContentRecommendations();
  state.reviewStarted = true;
  state.testVisited = false;
  state.successfulTestDraftFingerprint = "";
  state.reviewIssuePhaseIds = new Set();
  state.reviewTestAttempted = false;
}

function clearReviewProgress() {
  resetContentRecommendations();
  state.reviewStarted = false;
  state.testVisited = false;
  state.successfulTestDraftFingerprint = "";
  state.reviewIssuePhaseIds = new Set();
  state.reviewTestAttempted = false;
}

function hasBuildInputWork() {
  return [
    elements.customerSituationInput,
    elements.learnerApproachInput
  ].some((input) => input.value.trim());
}

function initializeFreshConversation() {
  closePreview("");
  state.standardTextMode = "none";
  state.draft = normalizeStudioDraft(createStudioDraft({
    evaluationMode: "focused_learning_objectives"
  }));
  state.draft.evaluation.mode = "focused_learning_objectives";
  state.sourceGrounding = emptySourceGrounding();
  state.pendingSourceUpdate = null;
  state.currentDraftActive = false;
  state.currentDraftUpdatedAt = "";
  state.savedDraft = clone(state.draft);
  state.draftId = state.draft.draftId;
  clearReviewProgress();
  resetPublicationContext();
  renderCreateSummary();
  elements.customerSituationInput.value = "";
  elements.learnerApproachInput.value = "";
  elements.deidentificationConfirmedInput.checked = false;
  setBuildIntakeStatus("");
  setBuildIntakeStep("conversation");
  renderSourceGrounding();
  renderSourceUpdateProposal();
  renderReview();
  setStandardTextMode("none");
  updateSavedState({ draftId: state.draftId });
}

function startNewConversation() {
  if (!guardPendingPublishNavigation(state, showPendingPublishLockMessage)) return false;
  if ((state.currentDraftActive || hasBuildInputWork()) && !window.confirm(
    "Start a new conversation? This replaces the current in-tab draft."
  )) return;
  initializeFreshConversation();
  setGlobalStatus("");
  setBuilderView("workflow", { focus: false });
  setStage("create");
  elements.customerSituationInput.focus({ preventScroll: true });
}

async function returnToConversationLibrary() {
  if (!guardPendingPublishNavigation(state, showPendingPublishLockMessage)) return false;
  closePreview("");
  if (state.currentDraftActive && state.reviewStarted) await saveDraft({ quiet: true });
  renderConversationLibrary();
  setBuilderView("landing");
  return true;
}

export function focusConversationLibraryRow({
  container,
  rowKey = "",
  familyId = "",
  draftId = "",
  highlightClass = draftId ? "recently-saved" : "recently-published",
  reducedMotion = typeof browserWindow?.matchMedia === "function" &&
    browserWindow.matchMedia("(prefers-reduced-motion: reduce)").matches
} = {}) {
  const row = [...(container?.querySelectorAll?.("tr") || [])]
    .find((candidate) => rowKey
      ? candidate.dataset.rowKey === rowKey
      : draftId
        ? candidate.dataset.draftId === draftId
        : candidate.dataset.familyId === familyId);
  if (!row) return null;
  row.classList.add(highlightClass);
  row.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  row.querySelector("[data-library-action]")?.focus({ preventScroll: true });
  return row;
}

function resetLibraryFilters() {
  elements.conversationSearchInput.value = "";
  elements.conversationStatusFilter.value = "all";
  elements.conversationTopicFilter.value = "all";
  elements.conversationSubtopicFilter.value = "all";
}

function showSavedConversationInLibrary(draftId) {
  closePreview("");
  resetLibraryFilters();
  renderConversationLibrary();
  setBuilderView("landing", { focus: false });
  window.scrollTo({ top: 0, behavior: "smooth" });
  focusConversationLibraryRow({
    container: elements.conversationLibraryBody,
    draftId
  });
}

function showPublishedConversationInLibrary(selection = {}) {
  const familyId = typeof selection === "string" ? selection : selection.familyId;
  const rowKey = typeof selection === "string"
    ? `published:${selection}`
    : selection.key || `published:${familyId}`;
  closePreview("");
  state.currentDraftActive = false;
  resetLibraryFilters();
  renderConversationLibrary();
  setBuilderView("landing", { focus: false });
  window.scrollTo({ top: 0, behavior: "smooth" });
  focusConversationLibraryRow({
    container: elements.conversationLibraryBody,
    rowKey,
    familyId
  });
}

export function launchPublishConfetti({
  documentRef = browserDocument,
  windowRef = browserWindow,
  random = Math.random,
  pieceCount = 96
} = {}) {
  if (
    !documentRef?.body ||
    typeof documentRef.createElement !== "function" ||
    (typeof windowRef?.matchMedia === "function" &&
      windowRef.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) return null;
  const burst = documentRef.createElement("div");
  burst.className = "publish-confetti-burst";
  burst.setAttribute("aria-hidden", "true");
  const colors = ["#285edb", "#173b9c", "#ffd200", "#1e7145", "#ffffff"];
  for (let index = 0; index < pieceCount; index += 1) {
    const piece = documentRef.createElement("i");
    const side = index % 2 === 0 ? -1 : 1;
    piece.style.setProperty("--start-x", `${side < 0 ? 12 + random() * 18 : 70 + random() * 18}vw`);
    piece.style.setProperty("--spread-x", `${(random() * 46 + 18) * -side}vw`);
    piece.style.setProperty("--launch-y", `${random() * 22 + 12}vh`);
    piece.style.setProperty("--fall-y", `${random() * 64 + 42}vh`);
    piece.style.setProperty("--r", `${Math.floor(random() * 360)}deg`);
    piece.style.setProperty("--d", `${random() * 0.38}s`);
    piece.style.setProperty("--c", colors[index % colors.length]);
    burst.appendChild(piece);
  }
  documentRef.body.appendChild(burst);
  windowRef?.setTimeout?.(() => burst.remove(), 2400);
  return burst;
}

function verifiedPublishResult(result, expectedFamilyId, expectedOperationId) {
  if (
    result?.ok !== true ||
    result.familyId !== expectedFamilyId ||
    result.publicationId !== expectedOperationId ||
    typeof result.idempotent !== "boolean"
  ) {
    throw new Error("Conversation Builder could not verify the publish result.");
  }
  return result;
}

function validPendingPublishRequest(attempt) {
  if (
    !attempt ||
    typeof attempt.body !== "string" ||
    !attempt.body ||
    typeof attempt.familyId !== "string" ||
    !attempt.familyId ||
    typeof attempt.operationId !== "string" ||
    !attempt.operationId ||
    typeof attempt.publishingRevision !== "boolean"
  ) return false;
  try {
    const payload = JSON.parse(attempt.body);
    return payload?.operationId === attempt.operationId &&
      payload?.familyId === attempt.familyId &&
      payload?.draft &&
      typeof payload.draft === "object" &&
      !Array.isArray(payload.draft) &&
      Array.isArray(payload.scenarios);
  } catch {
    return false;
  }
}

function publishAttemptPayload(attempt) {
  if (!validPendingPublishRequest(attempt)) {
    throw new Error("Conversation Builder could not verify the preserved publish request.");
  }
  return JSON.parse(attempt.body);
}

function publishInteractionIsLocked(publishState = {}) {
  return publishState.publishInFlight === true ||
    validPendingPublishRequest(publishState.pendingPublishRequest);
}

export function configurePendingPublishInteractionLock({
  publishState = {},
  stagePanels = [],
  publishPanel = null,
  navigation = null,
  backNavigation = [],
  lockedControls = [],
  publishButton = null
} = {}) {
  const pending = validPendingPublishRequest(publishState.pendingPublishRequest);
  const locked = publishState.publishInFlight === true || pending;
  stagePanels.forEach((panel) => {
    if (panel) panel.inert = locked && panel !== publishPanel;
  });
  if (navigation) navigation.inert = locked;
  backNavigation.forEach((control) => {
    if (control) control.inert = locked;
  });
  lockedControls.forEach((control) => {
    if (control) control.inert = locked;
  });
  if (publishButton) {
    publishButton.inert = false;
    if (pending) {
      publishButton.textContent = publishState.publishInFlight
        ? "Retrying publish…"
        : "Retry publish";
      publishButton.disabled = publishState.publishInFlight === true;
    } else if (publishState.publishInFlight) {
      publishButton.disabled = true;
    }
  }
  return locked;
}

export function guardPendingPublishNavigation(publishState = {}, onBlocked = () => {}) {
  if (!publishInteractionIsLocked(publishState)) return true;
  onBlocked();
  return false;
}

export function isDefinitivePublishFailure(error = {}) {
  const status = Number(error?.status);
  const code = String(error?.code || "").trim().toLowerCase();
  if (code === "authoring_unavailable") return false;
  return Number.isInteger(status) &&
    status >= 400 &&
    status < 500 &&
    ![408, 425, 429].includes(status);
}

const STALE_PUBLICATION_CONFLICT_CODES = new Set([
  "BASE_PUBLICATION_CONFLICT",
  "LOAD_PUBLICATION_CONFLICT",
  "publication_conflict"
]);

export function applyPublicationConflictState(publishState, error = {}) {
  if (
    Number(error?.status) !== 409 ||
    !STALE_PUBLICATION_CONFLICT_CODES.has(String(error?.code || ""))
  ) return false;
  publishState.revisionStatus = "stale";
  publishState.validation = null;
  return true;
}

export async function submitPublishAttempt({
  publishState,
  refreshBaseline = async () => {},
  buildAttempt = async () => null,
  request = requestJson
} = {}) {
  if (!publishState || typeof publishState !== "object") {
    throw new Error("Conversation Builder could not preserve the publish attempt.");
  }
  let attempt = validPendingPublishRequest(publishState.pendingPublishRequest)
    ? clone(publishState.pendingPublishRequest)
    : null;
  if (!attempt) {
    await refreshBaseline();
    attempt = await buildAttempt();
    if (!validPendingPublishRequest(attempt)) {
      throw new Error("Conversation Builder could not prepare the publish request.");
    }
    publishState.pendingPublishRequest = clone(attempt);
  }
  try {
    const result = await request("/api/builder/publish", {
      method: "POST",
      body: attempt.body
    });
    return { result, attempt };
  } catch (error) {
    if (isDefinitivePublishFailure(error)) publishState.pendingPublishRequest = null;
    throw error;
  }
}

export function completePublishSuccess({
  result,
  expectedFamilyId,
  expectedOperationId,
  completionState,
  statusMessage = "Published!",
  setStatus = () => {},
  celebrate = () => {},
  returnToLibrary = () => {}
} = {}) {
  verifiedPublishResult(result, expectedFamilyId, expectedOperationId);
  setStatus(statusMessage);
  const celebrated = completionState?.celebratedPublishOperationId !== expectedOperationId;
  if (celebrated) {
    if (completionState) completionState.celebratedPublishOperationId = expectedOperationId;
    celebrate();
  }
  returnToLibrary(expectedFamilyId);
  return { celebrated, idempotent: result.idempotent };
}

export async function completePublishTransition({
  result,
  attempt,
  currentDraft = null,
  completionState,
  transitionDraft = async () => ({ saved: false }),
  applyPublishedState = () => {},
  loadCatalog = async () => {},
  setStatus = () => {},
  celebrate = () => {},
  returnToLibrary = () => {}
} = {}) {
  verifiedPublishResult(result, attempt?.familyId, attempt?.operationId);
  const attemptedPayload = publishAttemptPayload(attempt);
  const attemptedDraft = clone(attemptedPayload.draft);
  if (
    currentDraft &&
    !equal(
      normalizePhaseAuthoringDraft(currentDraft),
      normalizePhaseAuthoringDraft(attemptedDraft)
    )
  ) return { completed: false, reason: "draft_changed" };
  const transition = await transitionDraft({
    status: "published",
    familyId: attempt.familyId,
    mode: "editable",
    basePublicationId: result.publicationId,
    draft: clone(attemptedDraft),
    confirmedPublication: true
  });
  const newerDraftRetained = transition?.saved !== true && transition?.conflict === true;
  if (transition?.saved !== true && !newerDraftRetained) return { completed: false };
  applyPublishedState({ result, attempt, transition, newerDraftRetained });
  if (completionState) completionState.pendingPublishRequest = null;
  await loadCatalog();
  const completion = completePublishSuccess({
    result,
    expectedFamilyId: attempt.familyId,
    expectedOperationId: attempt.operationId,
    completionState,
    statusMessage: newerDraftRetained
      ? "Published. A newer draft remains saved."
      : "Published!",
    setStatus,
    celebrate,
    returnToLibrary: (familyId) => returnToLibrary({
      source: "published",
      key: `published:${familyId}`,
      familyId
    })
  });
  return {
    completed: true,
    ...completion,
    ...(newerDraftRetained ? { newerDraftRetained: true } : {})
  };
}

export async function runPublishScenarioSubmission({
  publishState,
  persistDraft = async () => ({ saved: false }),
  refreshBaseline = async () => {},
  buildAttempt = async () => null,
  request = requestJson,
  currentDraft = null,
  applyPublishedState = () => {},
  loadCatalog = async () => {},
  setStatus = () => {},
  celebrate = () => {},
  returnToLibrary = () => {}
} = {}) {
  if (!validPendingPublishRequest(publishState?.pendingPublishRequest)) {
    const prepared = await persistDraft({ status: "draft" });
    if (prepared?.saved !== true) {
      return { completed: false, reason: "draft_save_failed" };
    }
  }
  const { result, attempt } = await submitPublishAttempt({
    publishState,
    refreshBaseline,
    buildAttempt,
    request
  });
  return completePublishTransition({
    result,
    attempt,
    currentDraft,
    completionState: publishState,
    transitionDraft: persistDraft,
    applyPublishedState,
    loadCatalog,
    setStatus,
    celebrate,
    returnToLibrary
  });
}

function renderReviewReadiness() {
  const ready = blockingPhaseEvaluationFindings(state.draft).length === 0;
  if (elements.reviewContinueButton) {
    configureReviewTestAffordance(elements.reviewContinueButton, {
      available: state.reviewStarted,
      validated: ready && state.validation?.ok === true
    });
    elements.reviewContinueButton.title = !ready
      ? "Complete the highlighted learning objective details before downloading."
      : state.validation?.ok === true
        ? ""
        : "Validate the conversation before downloading.";
  }
  renderStageAvailability();
}

function renderChannelVisibility() {
  const channels = state.draft?.scenario?.channels || [];
  $$("[data-channel-tab]").forEach((button) => {
    button.hidden = !channels.includes(button.dataset.channelTab);
  });
  $$("[data-channel-section]").forEach((section) => {
    section.hidden = !channels.includes(section.dataset.channelSection);
  });
  $$("[data-review-channel]").forEach((input) => {
    input.checked = channels.includes(input.dataset.reviewChannel);
    input.disabled = state.loadMode === "editable";
    input.title = state.loadMode === "editable"
      ? "Practice formats stay fixed when revising a published conversation."
      : "";
  });
}

function fillBoundFields() {
  $$("[data-draft-field]").forEach((control) => {
    const value = getPath(state.draft, control.dataset.draftField);
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = value ?? "";
  });
}

const TAXONOMY_LEVELS = ["teamAudience", "topic", "subtopic"];
const TAXONOMY_OPTION_KEYS = {
  teamAudience: "teams",
  topic: "topics",
  subtopic: "subtopics"
};

function taxonomyKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function taxonomyCatalogBaseline(families = []) {
  const rows = Array.isArray(families) ? families : [];
  return Object.fromEntries(TAXONOMY_LEVELS.map((field) => [
    field,
    new Set(rows.map((family) => taxonomyKey(family?.[field])).filter(Boolean))
  ]));
}

export function isTaxonomyValueRemovable(baseline, field, value) {
  const key = taxonomyKey(value);
  return Boolean(key) &&
    TAXONOMY_LEVELS.includes(field) &&
    baseline?.[field] instanceof Set &&
    !baseline[field].has(key);
}

function uniqueTaxonomyValues(values) {
  const unique = new Map();
  values.forEach((rawValue) => {
    const value = String(rawValue || "").trim();
    const key = taxonomyKey(value);
    if (key && !unique.has(key)) unique.set(key, value);
  });
  return [...unique.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

export function taxonomyOptions(families = [], selection = {}) {
  const rows = Array.isArray(families) ? families : [];
  const teamKey = taxonomyKey(selection.teamAudience);
  const topicKey = taxonomyKey(selection.topic);
  const teams = uniqueTaxonomyValues(rows.map((family) => family?.teamAudience));
  const matchingTeamRows = teamKey
    ? rows.filter((family) => taxonomyKey(family?.teamAudience) === teamKey)
    : [];
  const topics = uniqueTaxonomyValues(matchingTeamRows.map((family) => family?.topic));
  const matchingTopicRows = topicKey
    ? matchingTeamRows.filter((family) => taxonomyKey(family?.topic) === topicKey)
    : [];
  const subtopics = uniqueTaxonomyValues(matchingTopicRows.map((family) => family?.subtopic));
  return { teams, topics, subtopics };
}

export function taxonomyChoices(options = [], currentValue = "") {
  const current = String(currentValue || "").trim();
  const currentKey = taxonomyKey(current);
  const choices = uniqueTaxonomyValues(options).map((value) => ({
    value,
    label: value,
    isNew: false
  }));
  if (currentKey && !choices.some((choice) => taxonomyKey(choice.value) === currentKey)) {
    choices.push({
      value: current,
      label: current,
      isNew: true
    });
    choices.sort((left, right) =>
      left.value.localeCompare(right.value, undefined, { sensitivity: "base" })
    );
  }
  return choices;
}

export function nextTaxonomySelection(families = [], selection = {}, field, rawValue) {
  const next = {
    teamAudience: String(selection.teamAudience || "").trim(),
    topic: String(selection.topic || "").trim(),
    subtopic: String(selection.subtopic || "").trim()
  };
  if (!TAXONOMY_LEVELS.includes(field)) return next;
  const previousKey = taxonomyKey(next[field]);
  next[field] = String(rawValue || "").trim();
  if (taxonomyKey(next[field]) === previousKey) return next;
  if (field === "subtopic") return next;

  const options = taxonomyOptions(families, next);
  if (field === "teamAudience" && next.topic &&
      !options.topics.some((value) => taxonomyKey(value) === taxonomyKey(next.topic))) {
    next.topic = "";
    next.subtopic = "";
    return next;
  }
  if (next.subtopic &&
      !options.subtopics.some((value) => taxonomyKey(value) === taxonomyKey(next.subtopic))) {
    next.subtopic = "";
  }
  return next;
}

function taxonomyControlConfigurations() {
  return [
    {
      field: "teamAudience",
      input: elements.teamCombobox,
      listbox: elements.teamListbox,
      status: elements.teamComboboxStatus,
      removeValueButton: elements.teamRemoveValueButton
    },
    {
      field: "topic",
      input: elements.topicCombobox,
      listbox: elements.topicListbox,
      status: elements.topicComboboxStatus,
      removeValueButton: elements.topicRemoveValueButton
    },
    {
      field: "subtopic",
      input: elements.subtopicCombobox,
      listbox: elements.subtopicListbox,
      status: elements.subtopicComboboxStatus,
      removeValueButton: elements.subtopicRemoveValueButton
    }
  ];
}

export function createTaxonomyControlCoordinator({
  controls,
  getFamilies,
  getBaseline = () => taxonomyCatalogBaseline(getFamilies()),
  getScenario,
  onDirty
}) {
  const components = new Map();
  const configurations = () => {
    const options = taxonomyOptions(getFamilies(), getScenario() || {});
    return controls.map((control) => ({
      ...control,
      values: options[TAXONOMY_OPTION_KEYS[control.field]] || []
    }));
  };

  const labelFor = (field) => field === "teamAudience" ? "Team" :
    field[0].toUpperCase() + field.slice(1);

  const componentFor = (configuration) => {
    if (!configuration.input || !configuration.listbox) return null;
    if (components.has(configuration.field)) return components.get(configuration.field);
    const component = createTaxonomyCombobox({
      documentRef: configuration.input.ownerDocument,
      input: configuration.input,
      listbox: configuration.listbox,
      removeButton: configuration.removeValueButton,
      label: labelFor(configuration.field),
      getValue: () => String(getScenario()?.[configuration.field] || "").trim(),
      getOptions: () => {
        const scenario = getScenario() || {};
        const options = taxonomyOptions(getFamilies(), scenario);
        const values = options[TAXONOMY_OPTION_KEYS[configuration.field]] || [];
        return taxonomyChoices(values, scenario[configuration.field]).map((choice) => choice.value);
      },
      canRemove: () => isTaxonomyValueRemovable(
        getBaseline(),
        configuration.field,
        getScenario()?.[configuration.field]
      ),
      onCommit: (value) => commit(configuration.field, value),
      onRemove: () => commit(configuration.field, ""),
      onAnnounce: (message) => {
        if (configuration.status) configuration.status.textContent = message;
      }
    });
    components.set(configuration.field, component);
    return component;
  };

  const render = () => {
    const scenario = getScenario();
    if (!scenario || !controls[0]?.input) return;
    configurations().forEach((configuration) => {
      componentFor(configuration)?.render();
    });
  };

  const commit = (field, rawValue) => {
    const scenario = getScenario();
    if (!scenario) return "";
    const previous = TAXONOMY_LEVELS.map((level) => scenario[level] || "");
    const next = nextTaxonomySelection(getFamilies(), scenario, field, rawValue);
    const changed = TAXONOMY_LEVELS.some((level, index) => previous[index] !== next[level]);
    TAXONOMY_LEVELS.forEach((level) => { scenario[level] = next[level]; });
    if (changed) onDirty();
    render();
    const cleared = TAXONOMY_LEVELS.filter((level, index) =>
      level !== field && previous[index] && !next[level]
    );
    return cleared.length
      ? `${cleared.map(labelFor).join(" and ")} cleared because ${labelFor(field)} changed.`
      : "";
  };

  const wire = () => {
    configurations().forEach((configuration) => componentFor(configuration));
  };

  return { commit, render, wire };
}

const taxonomyControlCoordinator = createTaxonomyControlCoordinator({
  controls: taxonomyControlConfigurations(),
  getFamilies: () => state.publishedFamilies,
  getBaseline: () => state.taxonomyCatalogBaseline,
  getScenario: () => state.draft?.scenario,
  onDirty: setDirty
});

function renderTaxonomyControls() {
  taxonomyControlCoordinator.render();
}

function wireTaxonomyControls() {
  taxonomyControlCoordinator.wire();
}

function createRemoveButton(label = "Remove") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove-button";
  button.textContent = label;
  return button;
}

export function removeIconButton({
  label,
  onClick,
  documentRef = browserDocument
} = {}) {
  if (!documentRef) return null;
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "remove-button phase-icon-button";
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  const icon = documentRef.createElement("img");
  icon.src = "/builder-studio/assets/icons/trash.svg";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  if (typeof onClick === "function") button.addEventListener("click", onClick);
  return button;
}

function renderStringList(path, container) {
  container.innerHTML = "";
  const values = getPath(state.draft, path) || [];
  values.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "editable-row";
    const input = document.createElement("textarea");
    input.rows = 2;
    input.value = value;
    input.setAttribute("aria-label", `${path} item ${index + 1}`);
    input.addEventListener("input", () => {
      const list = clone(getPath(state.draft, path) || []);
      list[index] = input.value;
      setPath(state.draft, path, list);
      markCitationsEdited(`${path}.${index}`);
      setDirty();
      const nextCitation = citationSummary(`${path}.${index}`);
      row.querySelector(".field-citations")?.remove();
      if (nextCitation) row.append(nextCitation);
    });
    const remove = createRemoveButton();
    remove.addEventListener("click", () => {
      const list = clone(getPath(state.draft, path) || []);
      list.splice(index, 1);
      setPath(state.draft, path, list);
      removeListItemCitations(path, index);
      setDirty();
      renderStringList(path, container);
    });
    row.append(input, remove);
    const citations = citationSummary(`${path}.${index}`);
    if (citations) row.append(citations);
    container.append(row);
  });
  if (!values.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No items yet</strong><p>Add one editable item to continue.</p>";
    container.append(empty);
  }
}

function renderAllStringLists() {
  $$("[data-list-editor]").forEach((container) => {
    renderStringList(container.dataset.listEditor, container);
  });
}

function syncLegacyConversationFlow() {
  const projected = normalizePhaseAuthoringDraft(state.draft);
  state.draft.scenario.openingLine = projected.scenario.openingLine;
  state.draft.handling = clone(projected.handling);
  state.draft.guidance = clone(projected.guidance);
}

function moveItem(items, index, direction) {
  const next = clone(Array.isArray(items) ? items : []);
  const nextIndex = index + direction;
  if (index < 0 || index >= next.length || nextIndex < 0 || nextIndex >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function guidanceItemId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function withGuidanceBullets(phase, update) {
  const next = clone(phase);
  next.coachGuidance ||= { title: next.title || "Coach Chewy guidance", bullets: [] };
  next.coachGuidance.bullets = update(clone(next.coachGuidance.bullets || []));
  return next;
}

export function addGuidanceItem(phase, item = {}) {
  return withGuidanceBullets(phase, (bullets) => [
    ...bullets,
    {
      ...clone(item),
      id: item.id || guidanceItemId("guidance"),
      text: String(item.text || ""),
      children: clone(Array.isArray(item.children) ? item.children : [])
    }
  ]);
}

export function editGuidanceItem(phase, index, changes = {}) {
  return withGuidanceBullets(phase, (bullets) => bullets.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...clone(changes), id: item.id } : item
  ));
}

export function removeGuidanceItem(phase, index) {
  return withGuidanceBullets(phase, (bullets) => bullets.filter((_, itemIndex) => itemIndex !== index));
}

export function moveGuidanceItem(phase, index, direction) {
  return withGuidanceBullets(phase, (bullets) => moveItem(bullets, index, direction));
}

function inferredGuidanceKind(text, kind, kindOverride = false) {
  if (kindOverride) return kind === "caution" ? "caution" : "support";
  if (kind === "caution") return "caution";
  return hasCautionPrefix(text) ? "caution" : "support";
}

function hasCautionPrefix(text) {
  return /^(?:do not|don't|never|avoid)\b/i.test(String(text || "").trim());
}

export function nextGuidanceChildKind(child = {}, nextText = "") {
  if (child.kindOverride === true) return child.kind === "caution" ? "caution" : "support";
  if (child.kind === "caution") return "caution";
  return !hasCautionPrefix(child.text) && hasCautionPrefix(nextText)
    ? "caution"
    : "support";
}

export function wireGuidanceChildTextInput(input, { getChild, onChange } = {}) {
  input.addEventListener("input", () => {
    const child = getChild?.() || {};
    onChange?.({
      text: input.value,
      kind: nextGuidanceChildKind(child, input.value)
    });
  });
  return input;
}

function withGuidanceChildren(phase, itemIndex, update) {
  return withGuidanceBullets(phase, (bullets) => bullets.map((item, index) => {
    if (index !== itemIndex) return item;
    return {
      ...item,
      children: update(clone(Array.isArray(item.children) ? item.children : []))
    };
  }));
}

export function addGuidanceChild(phase, itemIndex, child = {}) {
  return withGuidanceChildren(phase, itemIndex, (children) => [
    ...children,
    {
      ...clone(child),
      id: child.id || guidanceItemId("guidance_detail"),
      text: String(child.text || ""),
      kind: inferredGuidanceKind(child.text, child.kind, child.kindOverride)
    }
  ]);
}

export function editGuidanceChild(phase, itemIndex, childIndex, changes = {}) {
  return withGuidanceChildren(phase, itemIndex, (children) => children.map((child, index) =>
    index === childIndex
      ? {
          ...child,
          ...clone(changes),
          id: child.id,
          kind: inferredGuidanceKind(
            changes.text ?? child.text,
            changes.kind ?? child.kind,
            changes.kindOverride ?? child.kindOverride
          )
        }
      : child
  ));
}

export function removeGuidanceChild(phase, itemIndex, childIndex) {
  return withGuidanceChildren(
    phase,
    itemIndex,
    (children) => children.filter((_, index) => index !== childIndex)
  );
}

export function moveGuidanceChild(phase, itemIndex, childIndex, direction) {
  return withGuidanceChildren(
    phase,
    itemIndex,
    (children) => moveItem(children, childIndex, direction)
  );
}

export function addPhase(phases, phase) {
  const items = Array.isArray(phases) ? phases : [];
  return insertPhase(items, phase, items.length);
}

function normalizedChatAdvancePhrases(value) {
  const phrases = Array.isArray(value)
    ? value
    : String(value ?? "").split(/\r?\n/);
  return [...new Set(phrases
    .map((phrase) => String(phrase ?? "").trim().toLowerCase())
    .filter(Boolean))];
}

export function updatePhaseStrongLearnerResponse(phase, response) {
  const next = clone(phase || {});
  const nextResponse = String(response ?? "");
  if (String(next.strongLearnerResponse ?? "") === nextResponse) return next;
  next.strongLearnerResponse = nextResponse;
  next.chatAdvanceRequirements = [];
  return next;
}

export function addChatAdvanceRequirement(
  phase,
  { createId = guidanceItemId } = {}
) {
  const next = clone(phase || {});
  next.chatAdvanceRequirements = [
    ...(Array.isArray(next.chatAdvanceRequirements) ? next.chatAdvanceRequirements : []),
    { id: createId("chat_requirement"), phrases: [] }
  ];
  return next;
}

export function editChatAdvanceRequirementPhrases(phase, requirementId, phrases) {
  const next = clone(phase || {});
  next.chatAdvanceRequirements = (Array.isArray(next.chatAdvanceRequirements)
    ? next.chatAdvanceRequirements
    : []
  ).map((requirement) => requirement.id === requirementId
    ? { ...requirement, phrases: normalizedChatAdvancePhrases(phrases) }
    : requirement
  );
  return next;
}

export function removeChatAdvanceRequirement(phase, requirementId) {
  const next = clone(phase || {});
  next.chatAdvanceRequirements = (Array.isArray(next.chatAdvanceRequirements)
    ? next.chatAdvanceRequirements
    : []
  ).filter((requirement) => requirement.id !== requirementId);
  return next;
}

export function insertPhase(phases, phase, index) {
  const next = clone(Array.isArray(phases) ? phases : []);
  if (next.length >= 12 || !phase) return next;
  const requestedIndex = Number.isInteger(index) ? index : next.length;
  const insertionIndex = Math.max(0, Math.min(requestedIndex, next.length));
  next.splice(insertionIndex, 0, clone(phase));
  return next;
}

export function duplicatePhase(phases, index, { createId = guidanceItemId } = {}) {
  const next = clone(Array.isArray(phases) ? phases : []);
  if (next.length >= 12 || index < 0 || index >= next.length) return next;
  const duplicate = clone(next[index]);
  duplicate.id = createId("phase");
  duplicate.chatAdvanceRequirements = (duplicate.chatAdvanceRequirements || []).map((requirement) => ({
    ...requirement,
    id: createId("chat_requirement"),
    phrases: clone(requirement.phrases || [])
  }));
  if (duplicate.coachGuidance) {
    if (duplicate.coachGuidance.id) duplicate.coachGuidance.id = createId("guidance_group");
    duplicate.coachGuidance.bullets = (duplicate.coachGuidance.bullets || []).map((bullet) => ({
      ...bullet,
      id: createId("guidance"),
      children: (bullet.children || []).map((child) => ({
        ...child,
        id: createId("guidance_detail")
      }))
    }));
  }
  next.splice(index + 1, 0, duplicate);
  return next;
}

export function createBlankPhase(number, { createId = guidanceItemId } = {}) {
  const title = `Phase ${number}`;
  return {
    id: createId("phase"),
    title,
    partnerTurn: "",
    coachGuidance: {
      title,
      bullets: []
    },
    strongLearnerResponse: "",
    chatAdvanceRequirements: [],
    evaluationLinks: []
  };
}

export function removePhase(phases, index) {
  const next = clone(Array.isArray(phases) ? phases : []);
  if (next.length <= 1) return next;
  return next.filter((_, phaseIndex) => phaseIndex !== index);
}

export function movePhase(phases, index, direction) {
  return moveItem(phases, index, direction);
}

export function phaseDisclosureSummary(phase) {
  return {
    openingLine: String(phase?.partnerTurn || "").trim()
  };
}

export function focusPhaseEditorControl(container, focusKey) {
  if (!container || !focusKey) return false;
  const control = [...container.querySelectorAll("[data-focus-key]")]
    .find((item) => item.dataset.focusKey === focusKey);
  return revealAndFocusControl(container, control);
}

function revealAndFocusControl(container, control) {
  if (!container || !control || typeof control.focus !== "function") return false;
  let ancestor = control.parentElement;
  while (ancestor && ancestor !== container) {
    if (ancestor.tagName === "DETAILS") {
      const isPhaseReviewSection = String(ancestor.className || "")
        .split(/\s+/)
        .includes("phase-review-section");
      if (isPhaseReviewSection) {
        ancestor.parentElement?.querySelectorAll(".phase-review-section").forEach((section) => {
          section.open = section === ancestor;
        });
        ancestor.dispatchEvent(new Event("toggle"));
      } else {
        ancestor.open = true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  control.focus();
  return true;
}

export function wirePhaseEditorAction(
  button,
  { accessibleName, tooltip = false, run, afterRender } = {}
) {
  if (accessibleName) {
    button.setAttribute("aria-label", accessibleName);
    if (tooltip) button.dataset.tooltip = accessibleName;
    else delete button.dataset.tooltip;
    button.removeAttribute("title");
  }
  button.addEventListener("click", () => {
    const result = run?.();
    afterRender?.(result);
  });
  return button;
}

export function createConversationPhaseEditorStateBoundary(
  canonicalState,
  { onMaterialChange = () => {}, onAnyCommit = () => {} } = {}
) {
  return {
    getCurrentDraft: () => clone(canonicalState.draft),
    getCurrentGrounding: () => clone(
      canonicalState.draft?.sourceGrounding || canonicalState.sourceGrounding || emptySourceGrounding()
    ),
    onCommit: ({ draft, grounding, materialChange = true, meta = {} }) => {
      canonicalState.draft = clone(draft);
      canonicalState.sourceGrounding = normalizeSourceGrounding(grounding);
      canonicalState.draft.sourceGrounding = clone(canonicalState.sourceGrounding);
      if (materialChange) {
        if ("validation" in canonicalState) canonicalState.validation = null;
        if (
          canonicalState.successfulTestDraftFingerprint &&
          !isCurrentMaterialDraftFingerprint(
            canonicalState.draft,
            canonicalState.successfulTestDraftFingerprint
          )
        ) {
          canonicalState.successfulTestDraftFingerprint = "";
        }
        onMaterialChange(meta);
      }
      onAnyCommit({ materialChange, meta });
    }
  };
}

export function createConversationPhaseEditorCoordinator({
  document: editorDocument,
  container,
  draft,
  grounding = draft?.sourceGrounding,
  getCurrentDraft = null,
  getCurrentGrounding = null,
  onCommit = () => {},
  onToast = () => {},
  getPhaseFindings = () => [],
  onPhaseFieldBlur = () => {},
  renderObjectiveRecommendation = () => null,
  renderSystemReference = null
} = {}) {
  const initialDraft = getCurrentDraft?.() || draft;
  if (!editorDocument || !container || !initialDraft?.flow?.phases) return null;
  let currentDraft = clone(initialDraft);
  let currentGrounding = remapConversationPhaseCitations(
    normalizeSourceGrounding(getCurrentGrounding?.() || grounding),
    currentDraft.flow.phases,
    currentDraft.flow.phases
  );
  let currentDraftId = String(currentDraft.draftId || "");
  let openPhaseId = null;
  let initializedDisclosureDraftId = null;
  let evaluationDetailsOpen = new Map();
  let openReviewSectionByPhase = new Map();
  let phaseFindingRefreshers = new Map();

  const syncFromCanonical = () => {
    const latestDraft = getCurrentDraft?.();
    if (!latestDraft?.flow?.phases) return;
    const latestDraftId = String(latestDraft.draftId || "");
    if (currentDraftId && latestDraftId && currentDraftId !== latestDraftId) openPhaseId = null;
    currentDraftId = latestDraftId;
    currentDraft = clone(latestDraft);
    currentGrounding = remapConversationPhaseCitations(
      normalizeSourceGrounding(
        getCurrentGrounding?.() || latestDraft.sourceGrounding || currentGrounding
      ),
      currentDraft.flow.phases,
      currentDraft.flow.phases
    );
    currentDraft.sourceGrounding = clone(currentGrounding);
  };

  const projectLegacy = () => {
    currentDraft.sourceGrounding = clone(currentGrounding);
    const projected = normalizePhaseAuthoringDraft(currentDraft);
    currentDraft.scenario = { ...(currentDraft.scenario || {}), openingLine: projected.scenario.openingLine };
    currentDraft.handling = clone(projected.handling);
    currentDraft.guidance = clone(projected.guidance);
    currentDraft.flow.cautionsAuthoritative = true;
    currentDraft.sourceGrounding = clone(currentGrounding);
  };
  const notifyCommit = (materialChange = true, meta = {}) => onCommit({
    draft: clone(currentDraft),
    grounding: clone(currentGrounding),
    materialChange,
    meta
  });
  const phaseIndexForId = (phaseId) =>
    currentDraft.flow.phases.findIndex((phase) => phase.id === phaseId);
  const guidanceIndexForId = (phaseIndex, guidanceId) =>
    currentDraft.flow.phases[phaseIndex]?.coachGuidance?.bullets
      ?.findIndex((item) => item.id === guidanceId) ?? -1;
  const childIndexForId = (phaseIndex, guidanceIndex, childId) =>
    currentDraft.flow.phases[phaseIndex]?.coachGuidance?.bullets?.[guidanceIndex]?.children
      ?.findIndex((item) => item.id === childId) ?? -1;
  const runMountedOperation = (control, run) => (...args) => {
    if (typeof container.contains === "function" && !container.contains(control)) return undefined;
    syncFromCanonical();
    return run(...args);
  };
  const wirePhaseBlur = (control, phaseId) => {
    control.addEventListener("blur", runMountedOperation(control, () => onPhaseFieldBlur(phaseId)));
  };
  const replacePhaseFindings = (target, findings) => {
    [...target.querySelectorAll(".phase-field-errors")]
      .filter((issues) => issues.parentElement === target)
      .forEach((issues) => issues.remove());
    if (!findings.length) return;
    const issues = editorDocument.createElement("div");
    issues.className = "phase-field-errors";
    issues.setAttribute("role", "alert");
    findings.forEach((finding) => {
      const message = editorDocument.createElement("p");
      message.textContent = finding.proposedCorrection?.summary || finding.rationale;
      issues.append(message);
    });
    target.append(issues);
  };
  const registerPhaseFindingRefresher = (phaseId, refresh) => {
    phaseFindingRefreshers.get(phaseId)?.push(refresh);
  };
  const appendPhaseFindings = (target, phaseId, phaseIndex, pathPrefix) => {
    const refresh = () => replacePhaseFindings(
      target,
      getPhaseFindings(phaseId).filter((finding) =>
        finding.fieldPath === pathPrefix || finding.fieldPath.startsWith(`${pathPrefix}.`)
      )
    );
    registerPhaseFindingRefresher(phaseId, refresh);
    refresh();
  };
  const synchronizeEvaluationControls = () => {
    syncFromCanonical();
    const objectiveById = new Map((currentDraft.evaluation?.objectives || []).map((objective) => [
      objective.id,
      objective
    ]));
    container.querySelectorAll("[data-objective-label-id]").forEach((node) => {
      node.textContent = objectiveById.get(node.dataset.objectiveLabelId)?.label || "Untitled objective";
    });
    container.querySelectorAll("[data-objective-label-input-id]").forEach((node) => {
      if (editorDocument.activeElement !== node) {
        node.value = objectiveById.get(node.dataset.objectiveLabelInputId)?.label || "";
      }
    });
    const criteriaById = new Map((currentDraft.evaluation?.objectives || []).flatMap((objective) =>
      (objective.criteria || []).map((criterion) => [criterionId(criterion), criterion])
    ));
    container.querySelectorAll("[data-criterion-text-id]").forEach((node) => {
      const criterion = criteriaById.get(node.dataset.criterionTextId);
      node.textContent = typeof criterion === "object" ? criterion?.text || "" : criterion || "";
    });
    container.querySelectorAll("[data-criterion-text-input-id]").forEach((node) => {
      if (editorDocument.activeElement === node) return;
      const criterion = criteriaById.get(node.dataset.criterionTextInputId);
      node.value = typeof criterion === "object" ? criterion?.text || "" : criterion || "";
    });
  };
  const canonicalEvaluationPath = (path) => {
    const match = String(path || "").match(
      /^evaluation\.objectives\.([^.]+)\.(label|description|criteria\.([^.]+)\.text)$/
    );
    if (!match) return path;
    const objectiveIndex = (currentDraft.evaluation?.objectives || [])
      .findIndex((objective) => objective.id === match[1]);
    if (objectiveIndex < 0) return path;
    if (!match[3]) return `evaluation.objectives.${objectiveIndex}.${match[2]}`;
    const criterionIndex = (currentDraft.evaluation.objectives[objectiveIndex].criteria || [])
      .findIndex((criterion) => criterionId(criterion) === match[3]);
    return criterionIndex < 0
      ? `evaluation.objectives.${objectiveIndex}.criteria`
      : `evaluation.objectives.${objectiveIndex}.criteria.${criterionIndex}.text`;
  };
  const canonicalEvaluationCitationPaths = (semanticPath) => {
    return [canonicalEvaluationPath(semanticPath)];
  };
  const commitEvaluationDraft = (nextDraft, meta = {}) => {
    syncFromCanonical();
    const beforeObjectives = currentDraft.evaluation?.objectives || [];
    const hasIncompleteCriterion = (nextDraft.evaluation?.objectives || []).some((objective) =>
      (objective.criteria || []).some((criterion) =>
        !String(typeof criterion === "object" ? criterion?.text || "" : criterion || "").trim()
      )
    );
    const preserveIncompleteCriterion = meta.preserveIncompleteCriterion || hasIncompleteCriterion;
    currentDraft = preserveIncompleteCriterion
      ? clone(nextDraft)
      : prepareEvaluationDraftForCommit(nextDraft);
    if (preserveIncompleteCriterion) projectLegacy();
    currentGrounding = remapCanonicalEvaluationCitations(
      currentGrounding,
      beforeObjectives,
      currentDraft.evaluation?.objectives || []
    );
    const editedPaths = Array.isArray(meta.paths) && meta.paths.length
      ? meta.paths
      : [meta.path];
    editedPaths.filter(Boolean).forEach((path) => {
      currentGrounding = markGroundingPathEdited(
        currentGrounding,
        canonicalEvaluationPath(path)
      );
    });
    currentDraft.sourceGrounding = clone(currentGrounding);
    notifyCommit(true, meta);
    if (meta.citation) {
      refreshSharedEvaluationCitations(meta.path, meta.citation.input);
    }
    if (meta.rerender) {
      render();
      focusPhaseEditorControl(container, meta.focusKey);
    } else {
      synchronizeEvaluationControls();
      if (meta.synchronize) refreshPhaseFindings();
    }
  };
  const phaseCitationPaths = (phaseId, getFieldPath) => () => {
    const phaseIndex = phaseIndexForId(phaseId);
    if (phaseIndex < 0) return [];
    const fieldPath = typeof getFieldPath === "function"
      ? getFieldPath(currentDraft.flow.phases[phaseIndex])
      : getFieldPath;
    if (!fieldPath) return [];
    return conversationPhaseCitationPaths(currentDraft.flow.phases, phaseIndex, fieldPath);
  };
  const citationsForPaths = (paths) => paths.flatMap((path) => citationsForPath(currentGrounding, path));

  const renderFieldCitations = (field, pathSource, actionKey, input, onConfirmed = null) => {
    field.querySelector(".field-citations")?.remove();
    const paths = typeof pathSource === "function" ? pathSource() : pathSource;
    const citations = citationsForPaths(paths);
    if (!citations.length) return;
    const summary = editorDocument.createElement("div");
    summary.className = "field-citations";
    const unique = new Map();
    citations.forEach((citation) => {
      const key = `${citation.documentId}\u0000${citation.passageId}`;
      const existing = unique.get(key);
      unique.set(key, existing
        ? {
            ...existing,
            status: existing.status === "needs_review" || citation.status === "needs_review"
              ? "needs_review"
              : "reviewed"
          }
        : citation);
    });
    unique.forEach((citation) => {
      const row = editorDocument.createElement("span");
      row.dataset.citationStatus = citation.status;
      const label = editorDocument.createElement("span");
      label.textContent = citation.status === "needs_review"
        ? `Source needs review: ${citation.label}`
        : `Source: ${citation.label}`;
      row.append(label);
      if (citation.status === "needs_review") {
        const confirm = editorDocument.createElement("button");
        confirm.type = "button";
        confirm.className = "citation-confirm-button";
        confirm.textContent = "Confirm it still supports this field";
        confirm.dataset.editorAction = `confirm-citation:${actionKey}`;
        wirePhaseEditorAction(confirm, {
          accessibleName: `Confirm source support for ${actionKey.replaceAll(":", " ")}`,
          run: runMountedOperation(confirm, () => {
            const currentPaths = typeof pathSource === "function" ? pathSource() : pathSource;
            currentGrounding = confirmGroundingCitations(currentGrounding, {
              documentId: citation.documentId,
              passageId: citation.passageId,
              paths: currentPaths
            });
            currentDraft.sourceGrounding = clone(currentGrounding);
            notifyCommit(false);
            if (onConfirmed) onConfirmed();
            else {
              renderFieldCitations(field, pathSource, actionKey, input);
              input?.focus();
            }
          })
        });
        row.append(confirm);
      }
      summary.append(row);
    });
    field.append(summary);
  };

  const refreshSharedEvaluationCitations = (semanticPath, focusInput = null) => {
    container.querySelectorAll(
      `[data-evaluation-citation-path="${semanticPath}"]`
    ).forEach((field) => {
      const input = field.querySelector("input") || field.querySelector("textarea");
      const actionKey = field.dataset.evaluationCitationActionKey;
      renderFieldCitations(
        field,
        () => canonicalEvaluationCitationPaths(semanticPath),
        actionKey,
        input,
        () => refreshSharedEvaluationCitations(semanticPath, input)
      );
    });
    focusInput?.focus();
  };

  const syncPhaseEdit = (
    beforePhases,
    phaseIndex,
    fieldPath,
    field,
    pathSource,
    actionKey,
    input
  ) => {
    currentGrounding = remapConversationPhaseCitations(
      currentGrounding,
      beforePhases,
      currentDraft.flow.phases
    );
    currentGrounding = markConversationPhaseCitationsEdited(
      currentGrounding,
      currentDraft.flow.phases,
      phaseIndex,
      fieldPath
    );
    projectLegacy();
    notifyCommit();
    renderFieldCitations(field, pathSource, actionKey, input);
  };

  const moveAndRender = (nextPhases, beforePhases, focusKey, message) => {
    currentDraft.flow.phases = nextPhases;
    currentGrounding = remapConversationPhaseCitations(currentGrounding, beforePhases, nextPhases);
    projectLegacy();
    notifyCommit();
    render();
    focusPhaseEditorControl(container, focusKey);
    onToast(message);
  };

  const labeledControl = (labelText, value, controlKey, tagName = "textarea") => {
    const field = editorDocument.createElement("label");
    field.className = "field";
    const label = editorDocument.createElement("span");
    label.textContent = labelText;
    const input = editorDocument.createElement(tagName);
    input.value = value || "";
    input.dataset.editorControl = controlKey;
    input.dataset.focusKey = controlKey;
    field.append(label, input);
    return { field, input, label };
  };

  const phaseReviewSection = ({
    phaseId,
    key,
    label,
    preview,
    count = "",
    iconName = "",
    meta = "",
    metaIconName = "",
    metaIconHidden = false,
    content
  }) => {
    const details = editorDocument.createElement("details");
    details.className = "phase-review-section";
    details.dataset.phaseReviewSection = key;
    details.dataset.phaseReviewPhase = phaseId;
    details.open = openReviewSectionByPhase.get(phaseId) === key;
    const summary = editorDocument.createElement("summary");
    summary.className = "phase-review-summary";
    const iconWrap = editorDocument.createElement("span");
    iconWrap.className = "phase-review-icon";
    if (iconName) {
      const icon = editorDocument.createElement("img");
      icon.src = `/builder-studio/assets/icons/${iconName}.svg`;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      iconWrap.append(icon);
    }
    const copy = editorDocument.createElement("span");
    copy.className = "phase-review-summary-copy";
    const heading = editorDocument.createElement("span");
    heading.className = "phase-review-heading";
    const headingLabel = editorDocument.createElement("span");
    headingLabel.className = "phase-review-label";
    headingLabel.textContent = label;
    heading.append(headingLabel);
    let countNode = null;
    if (count) {
      countNode = editorDocument.createElement("span");
      countNode.className = "phase-review-count";
      countNode.textContent = count;
      heading.append(countNode);
    }
    const previewNode = editorDocument.createElement("span");
    previewNode.className = "phase-review-preview";
    previewNode.textContent = preview;
    copy.append(heading, previewNode);
    let metaNode = null;
    let metaTextNode = null;
    let metaIconNode = null;
    if (meta) {
      metaNode = editorDocument.createElement("span");
      metaNode.className = "phase-review-meta";
      if (metaIconName) {
        metaIconNode = editorDocument.createElement("img");
        metaIconNode.src = `/builder-studio/assets/icons/${metaIconName}.svg`;
        metaIconNode.alt = "";
        metaIconNode.hidden = metaIconHidden;
        metaIconNode.setAttribute("aria-hidden", "true");
        metaNode.append(metaIconNode);
      }
      metaTextNode = editorDocument.createElement("span");
      metaTextNode.textContent = meta;
      metaNode.append(metaTextNode);
      copy.append(metaNode);
    }
    const chevron = editorDocument.createElement("img");
    chevron.className = "phase-review-chevron";
    chevron.src = "/builder-studio/assets/icons/chevron-down.svg";
    chevron.alt = "";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(iconWrap, copy, chevron);
    const editor = editorDocument.createElement("div");
    editor.className = "phase-review-editor";
    editor.append(content);
    details.append(summary, editor);
    details.addEventListener("toggle", runMountedOperation(details, () => {
      if (!details.open) {
        if (openReviewSectionByPhase.get(phaseId) === key) {
          openReviewSectionByPhase.delete(phaseId);
        }
        return;
      }
      openReviewSectionByPhase.set(phaseId, key);
      details.parentElement?.querySelectorAll(".phase-review-section").forEach((section) => {
        if (section !== details) section.open = false;
      });
    }));
    return {
      details,
      preview: previewNode,
      count: countNode,
      meta: metaNode,
      metaText: metaTextNode,
      metaIcon: metaIconNode
    };
  };

  const phaseAction = (
    label,
    actionKey,
    accessibleName,
    run,
    disabled = false,
    remove = false,
    iconName = ""
  ) => {
    const button = remove
      ? removeIconButton({ label: accessibleName, documentRef: editorDocument })
      : editorDocument.createElement("button");
    button.type = "button";
    if (!remove) button.className = `text-button${iconName ? " phase-icon-button" : ""}`;
    if (iconName && !remove) {
      const icon = editorDocument.createElement("img");
      icon.src = `/builder-studio/assets/icons/${iconName}.svg`;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    } else if (!remove) {
      button.textContent = label;
    }
    button.disabled = disabled;
    button.dataset.editorAction = actionKey;
    button.dataset.focusKey = actionKey;
    return wirePhaseEditorAction(button, {
      accessibleName,
      tooltip: Boolean(iconName),
      run: runMountedOperation(button, run)
    });
  };

  const isPhaseOpen = (phaseId) => Boolean(phaseId) && openPhaseId === phaseId;
  const synchronizePhaseDisclosures = () => {
    container.querySelectorAll(".phase-card").forEach((card) => {
      const phaseId = card.dataset.phaseId;
      const phaseIndex = phaseIndexForId(phaseId);
      const open = isPhaseOpen(phaseId);
      const body = card.querySelector(".phase-card-body");
      const bodyId = body?.getAttribute("id");
      const label = `${open ? "Collapse" : "Expand"} phase ${phaseIndex + 1}`;
      card.dataset.open = String(open);
      card.querySelectorAll("[data-phase-disclosure]").forEach((control) => {
        control.setAttribute("aria-expanded", String(open));
        control.setAttribute("aria-label", label);
        control.dataset.tooltip = label;
        if (bodyId) control.setAttribute("aria-controls", bodyId);
      });
      if (body) body.hidden = !open;
    });
  };
  const togglePhase = (phaseId) => {
    const summary = [...container.querySelectorAll("[data-phase-summary-toggle]")]
      .find((item) => item.dataset.phaseSummaryToggle === phaseId);
    return preserveElementViewportPosition({
      element: summary,
      mutate: () => {
        syncFromCanonical();
        if (phaseIndexForId(phaseId) < 0) return false;
        openPhaseId = isPhaseOpen(phaseId) ? null : phaseId;
        synchronizePhaseDisclosures();
        return true;
      }
    });
  };
  const openPhase = (phaseId) => {
    syncFromCanonical();
    if (phaseIndexForId(phaseId) < 0) return false;
    openPhaseId = phaseId;
    synchronizePhaseDisclosures();
    return true;
  };

  const render = () => {
    syncFromCanonical();
    container.innerHTML = "";
    phaseFindingRefreshers = new Map();
    const phases = currentDraft.flow.phases;
    if (initializedDisclosureDraftId !== currentDraftId) {
      initializedDisclosureDraftId = currentDraftId;
      openPhaseId = phases[0]?.id || null;
      evaluationDetailsOpen = new Map();
      openReviewSectionByPhase = new Map();
    }
    if (openPhaseId && !phases.some((phase) => phase.id === openPhaseId)) openPhaseId = null;
    phases.forEach((phase, phaseIndex) => {
      phaseFindingRefreshers.set(phase.id, []);
      const disclosure = phaseDisclosureSummary(phase);
      const card = editorDocument.createElement("article");
      card.className = "phase-card";
      card.dataset.phaseId = phase.id;
      const bodyId = `phase-editor-body-${phase.id}`;
      const heading = editorDocument.createElement("div");
      heading.className = "phase-card-heading";
      const summary = editorDocument.createElement("div");
      summary.className = "phase-card-summary";
      summary.dataset.phaseSummaryToggle = phase.id;
      summary.dataset.phaseDisclosure = "";
      summary.setAttribute("role", "button");
      summary.setAttribute("tabindex", "0");
      const phaseDisclosureLabel = `${isPhaseOpen(phase.id) ? "Collapse" : "Expand"} phase ${phaseIndex + 1}`;
      summary.setAttribute("aria-label", phaseDisclosureLabel);
      summary.dataset.tooltip = phaseDisclosureLabel;
      summary.setAttribute("aria-controls", bodyId);
      summary.setAttribute("aria-expanded", String(isPhaseOpen(phase.id)));
      const identity = editorDocument.createElement("div");
      identity.className = "phase-card-identity";
      const phaseNumber = editorDocument.createElement("span");
      phaseNumber.textContent = `Phase ${phaseIndex + 1}`;
      const phaseTitle = editorDocument.createElement("strong");
      phaseTitle.className = "phase-card-title";
      phaseTitle.dataset.phaseSummaryTitle = phase.id;
      phaseTitle.textContent = String(phase.title || "").trim() || "Untitled phase";
      identity.append(phaseNumber, phaseTitle);
      const openingLabel = editorDocument.createElement("span");
      openingLabel.className = "phase-disclosure-opening-label";
      openingLabel.textContent = "Conversation Partner says";
      const opening = editorDocument.createElement("p");
      opening.className = "phase-disclosure-opening";
      opening.dataset.phaseSummaryOpening = phase.id;
      opening.textContent = disclosure.openingLine || "No Conversation Partner opening yet.";
      summary.append(identity, openingLabel, opening);
      summary.addEventListener("click", runMountedOperation(summary, () => togglePhase(phase.id)));
      summary.addEventListener("keydown", runMountedOperation(summary, (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        togglePhase(phase.id);
      }));
      const phaseActions = editorDocument.createElement("div");
      phaseActions.className = "phase-card-actions";
      const toolbar = editorDocument.createElement("div");
      toolbar.className = "phase-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", `Phase ${phaseIndex + 1} actions`);
      const disclosureToggle = phaseAction(
        "",
        `toggle-phase:${phase.id}`,
        phaseDisclosureLabel,
        () => togglePhase(phase.id),
        false,
        false,
        "chevron-down"
      );
      disclosureToggle.className += " phase-disclosure-toggle";
      disclosureToggle.dataset.focusKey = `phase-toggle:${phase.id}`;
      disclosureToggle.dataset.phaseDisclosure = "";
      disclosureToggle.setAttribute("aria-controls", bodyId);
      disclosureToggle.setAttribute("aria-expanded", String(isPhaseOpen(phase.id)));
      toolbar.append(
        disclosureToggle,
        phaseAction(
          "",
          `move-phase-up:${phase.id}`,
          `Move phase ${phaseIndex + 1} up`,
          () => {
            const index = phaseIndexForId(phase.id);
            if (index < 0) return;
            const before = clone(currentDraft.flow.phases);
            const focusKey = isPhaseOpen(phase.id)
              ? `phase-title:${phase.id}`
              : `phase-toggle:${phase.id}`;
            moveAndRender(
              movePhase(before, index, -1),
              before,
              focusKey,
              `Phase ${index + 1} moved up.`
            );
          },
          phaseIndex === 0,
          false,
          "arrow-up"
        ),
        phaseAction(
          "",
          `move-phase-down:${phase.id}`,
          `Move phase ${phaseIndex + 1} down`,
          () => {
            const index = phaseIndexForId(phase.id);
            if (index < 0) return;
            const before = clone(currentDraft.flow.phases);
            const focusKey = isPhaseOpen(phase.id)
              ? `phase-title:${phase.id}`
              : `phase-toggle:${phase.id}`;
            moveAndRender(
              movePhase(before, index, 1),
              before,
              focusKey,
              `Phase ${index + 1} moved down.`
            );
          },
          phaseIndex === phases.length - 1,
          false,
          "arrow-down"
        ),
        phaseAction(
          "",
          `duplicate-phase:${phase.id}`,
          `Duplicate phase ${phaseIndex + 1}`,
          () => {
            const index = phaseIndexForId(phase.id);
            if (index < 0) return;
            const before = clone(currentDraft.flow.phases);
            const next = duplicatePhase(before, index);
            const duplicate = next[index + 1];
            if (!duplicate || next.length === before.length) return;
            openPhaseId = duplicate.id;
            moveAndRender(
              next,
              before,
              `phase-title:${duplicate.id}`,
              `Phase ${index + 1} duplicated.`
            );
          },
          phases.length >= 12,
          false,
          "copy"
        ),
        phaseAction(
          "",
          `remove-phase:${phase.id}`,
          `Delete phase ${phaseIndex + 1}`,
          () => {
            const index = phaseIndexForId(phase.id);
            if (index < 0) return;
            const before = clone(currentDraft.flow.phases);
            const next = removePhase(before, index);
            if (next.length === before.length) return;
            const remaining = next[Math.min(index, next.length - 1)];
            openPhaseId = remaining?.id || null;
            moveAndRender(
              next,
              before,
              remaining ? `phase-title:${remaining.id}` : "",
              `Phase ${index + 1} deleted.`
            );
          },
          phases.length === 1,
          true,
          "trash"
        )
      );
      phaseActions.append(toolbar);
      heading.append(summary, phaseActions);

      const body = editorDocument.createElement("div");
      body.className = "phase-card-body";
      body.dataset.phaseBody = phase.id;
      body.setAttribute("id", bodyId);
      body.hidden = !isPhaseOpen(phase.id);
      let titleReview = null;
      let partnerReview = null;
      let closingPartnerReview = null;
      let guidanceReview = null;
      let strongReview = null;
      let chatRequirementsReview = null;
      const title = labeledControl("Title", phase.title, `phase-title:${phase.id}`, "input");
      title.label.className = "visually-hidden";
      const titleCitationPaths = phaseCitationPaths(phase.id, "title");
      title.input.addEventListener("input", runMountedOperation(title.input, () => {
        const index = phaseIndexForId(phase.id);
        if (index < 0) return;
        const before = clone(currentDraft.flow.phases);
        currentDraft.flow.phases[index] = { ...currentDraft.flow.phases[index], title: title.input.value };
        phaseTitle.textContent = title.input.value.trim() || "Untitled phase";
        titleReview.preview.textContent = title.input.value.trim() || "Untitled phase";
        syncPhaseEdit(
          before,
          index,
          "title",
          title.field,
          titleCitationPaths,
          `${phase.id}:title`,
          title.input
        );
      }));
      renderFieldCitations(
        title.field,
        titleCitationPaths,
        `${phase.id}:title`,
        title.input
      );
      appendPhaseFindings(title.field, phase.id, phaseIndex, `flow.phases.${phaseIndex}.id`);

      const partner = labeledControl(
        "Conversation Partner says",
        phase.partnerTurn,
        `partner-turn:${phase.id}`
      );
      partner.label.className = "visually-hidden";
      const partnerCitationPaths = phaseCitationPaths(phase.id, "partnerTurn");
      partner.input.addEventListener("input", runMountedOperation(partner.input, () => {
        const index = phaseIndexForId(phase.id);
        if (index < 0) return;
        const before = clone(currentDraft.flow.phases);
        currentDraft.flow.phases[index] = {
          ...currentDraft.flow.phases[index],
          partnerTurn: partner.input.value
        };
        opening.textContent = partner.input.value.trim() || "No Conversation Partner opening yet.";
        partnerReview.preview.textContent = partner.input.value.trim() || "No Conversation Partner turn yet.";
        syncPhaseEdit(
          before,
          index,
          "partnerTurn",
          partner.field,
          partnerCitationPaths,
          `${phase.id}:partnerTurn`,
          partner.input
        );
      }));
      wirePhaseBlur(partner.input, phase.id);
      renderFieldCitations(
        partner.field,
        partnerCitationPaths,
        `${phase.id}:partnerTurn`,
        partner.input
      );
      appendPhaseFindings(partner.field, phase.id, phaseIndex, `flow.phases.${phaseIndex}.partnerTurn`);

      let partnerStarts = null;
      let partnerStartsSummaryText = "";
      let partnerStartsSummaryChecked = false;
      if (phaseIndex === 0) {
        partnerStarts = editorDocument.createElement("label");
        partnerStarts.className = "check-field phase-start-field";
        const toggle = editorDocument.createElement("input");
        toggle.type = "checkbox";
        toggle.dataset.editorControl = `partner-starts:${phase.id}`;
        toggle.dataset.focusKey = `partner-starts:${phase.id}`;
        const chatStarts = currentDraft.chat?.customerStarts !== false;
        const voiceStarts = currentDraft.voice?.customerStarts !== false;
        toggle.checked = chatStarts && voiceStarts;
        toggle.indeterminate = chatStarts !== voiceStarts;
        partnerStartsSummaryChecked = toggle.checked && !toggle.indeterminate;
        partnerStartsSummaryText = toggle.indeterminate
          ? "Start order differs by practice format"
          : toggle.checked
            ? "Conversation Partner speaks first"
            : "Learner speaks first";
        const copy = editorDocument.createElement("span");
        copy.textContent = "Conversation Partner speaks first";
        toggle.addEventListener("change", runMountedOperation(toggle, () => {
          const starts = Boolean(toggle.checked);
          currentDraft.chat = { ...(currentDraft.chat || {}), customerStarts: starts };
          currentDraft.voice = { ...(currentDraft.voice || {}), customerStarts: starts };
          toggle.indeterminate = false;
          if (partnerReview?.metaText) {
            partnerReview.metaText.textContent = starts
              ? "Conversation Partner speaks first"
              : "Learner speaks first";
          }
          if (partnerReview?.metaIcon) partnerReview.metaIcon.hidden = !starts;
          projectLegacy();
          notifyCommit();
        }));
        partnerStarts.append(toggle, copy);
      }

      const closingPartner = phaseIndex === phases.length - 1
        ? labeledControl(
            "Final Conversation Partner response",
            currentDraft.flow?.closingPartnerTurn,
            `closing-partner-turn:${phase.id}`
          )
        : null;
      if (closingPartner) {
        closingPartner.label.className = "visually-hidden";
        closingPartner.input.addEventListener("input", runMountedOperation(closingPartner.input, () => {
          currentDraft.flow = {
            ...(currentDraft.flow || {}),
            closingPartnerTurn: closingPartner.input.value
          };
          closingPartnerReview.preview.textContent = closingPartner.input.value.trim()
            || "No final Conversation Partner response yet.";
          projectLegacy();
          notifyCommit();
        }));
        wirePhaseBlur(closingPartner.input, phase.id);
        appendPhaseFindings(
          closingPartner.field,
          phase.id,
          phaseIndex,
          "flow.closingPartnerTurn"
        );
      }

      const guidanceSection = editorDocument.createElement("section");
      guidanceSection.className = "phase-guidance";
      const guidanceHeading = editorDocument.createElement("div");
      guidanceHeading.className = "phase-guidance-heading";
      const guidanceHeadingText = editorDocument.createElement("h5");
      guidanceHeadingText.textContent = "Coach Chewy guidance";
      guidanceHeadingText.className = "visually-hidden";
      guidanceHeading.append(guidanceHeadingText);
      guidanceSection.append(guidanceHeading);
      (phase.coachGuidance?.bullets || []).forEach((bullet, bulletIndex) => {
        const item = editorDocument.createElement("article");
        item.className = "phase-guidance-item";
        item.dataset.guidanceId = bullet.id;
        const guidance = labeledControl(
          `Point ${bulletIndex + 1}`,
          bullet.text,
          `guidance-text:${phase.id}:${bullet.id}`
        );
        const guidanceCitationPaths = phaseCitationPaths(phase.id, (currentPhase) => {
          const currentBulletIndex = currentPhase.coachGuidance?.bullets
            ?.findIndex((item) => item.id === bullet.id) ?? -1;
          return currentBulletIndex < 0 ? "" : `coachGuidance.bullets.${currentBulletIndex}.text`;
        });
        guidance.input.addEventListener("input", runMountedOperation(guidance.input, () => {
          const index = phaseIndexForId(phase.id);
          const currentBulletIndex = guidanceIndexForId(index, bullet.id);
          if (index < 0 || currentBulletIndex < 0) return;
          const before = clone(currentDraft.flow.phases);
          currentDraft.flow.phases[index] = editGuidanceItem(
            currentDraft.flow.phases[index],
            currentBulletIndex,
            { text: guidance.input.value }
          );
          if (currentBulletIndex === 0) {
            guidanceReview.preview.textContent = guidance.input.value.trim() || "No guidance points yet.";
          }
          const path = `coachGuidance.bullets.${currentBulletIndex}.text`;
          syncPhaseEdit(
            before,
            index,
            path,
            guidance.field,
            guidanceCitationPaths,
            `${phase.id}:${bullet.id}:text`,
            guidance.input
          );
        }));
        wirePhaseBlur(guidance.input, phase.id);
        renderFieldCitations(
          guidance.field,
          guidanceCitationPaths,
          `${phase.id}:${bullet.id}:text`,
          guidance.input
        );
        item.append(guidance.field);
        const reference = renderSystemReference?.(bullet);
        if (reference) item.append(reference);
        const guidanceActions = editorDocument.createElement("div");
        guidanceActions.className = "guidance-actions";
        guidanceActions.append(
          phaseAction(
            "",
            `move-guidance-up:${phase.id}:${bullet.id}`,
            `Move guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1} up`,
            () => {
              const index = phaseIndexForId(phase.id);
              const currentBulletIndex = guidanceIndexForId(index, bullet.id);
              if (index < 0 || currentBulletIndex < 0) return;
              const before = clone(currentDraft.flow.phases);
              const next = clone(before);
              next[index] = moveGuidanceItem(next[index], currentBulletIndex, -1);
              moveAndRender(next, before, `guidance-text:${phase.id}:${bullet.id}`, "Guidance point moved up.");
            },
            bulletIndex === 0,
            false,
            "arrow-up"
          ),
          phaseAction(
            "",
            `move-guidance-down:${phase.id}:${bullet.id}`,
            `Move guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1} down`,
            () => {
              const index = phaseIndexForId(phase.id);
              const currentBulletIndex = guidanceIndexForId(index, bullet.id);
              if (index < 0 || currentBulletIndex < 0) return;
              const before = clone(currentDraft.flow.phases);
              const next = clone(before);
              next[index] = moveGuidanceItem(next[index], currentBulletIndex, 1);
              moveAndRender(next, before, `guidance-text:${phase.id}:${bullet.id}`, "Guidance point moved down.");
            },
            bulletIndex === (phase.coachGuidance?.bullets || []).length - 1,
            false,
            "arrow-down"
          ),
          phaseAction(
            "Add Supporting Point",
            `add-child:${phase.id}:${bullet.id}`,
            `Add supporting point under guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1}`,
            () => {
              const index = phaseIndexForId(phase.id);
              const currentBulletIndex = guidanceIndexForId(index, bullet.id);
              if (index < 0 || currentBulletIndex < 0) return;
              const before = clone(currentDraft.flow.phases);
              const next = clone(before);
              next[index] = addGuidanceChild(next[index], currentBulletIndex, { text: "" });
              const added = next[index].coachGuidance.bullets[currentBulletIndex].children.at(-1);
              moveAndRender(next, before, `child-text:${phase.id}:${added.id}`, "Supporting point added.");
            },
            false,
            false,
            "plus"
          ),
          phaseAction(
            "Remove",
            `remove-guidance:${phase.id}:${bullet.id}`,
            `Remove guidance point ${bulletIndex + 1} from phase ${phaseIndex + 1}`,
            () => {
              const index = phaseIndexForId(phase.id);
              const currentBulletIndex = guidanceIndexForId(index, bullet.id);
              if (index < 0 || currentBulletIndex < 0) return;
              const before = clone(currentDraft.flow.phases);
              const next = clone(before);
              next[index] = removeGuidanceItem(next[index], currentBulletIndex);
              const remaining = next[index].coachGuidance.bullets[
                Math.min(currentBulletIndex, next[index].coachGuidance.bullets.length - 1)
              ];
              moveAndRender(
                next,
                before,
                remaining ? `guidance-text:${phase.id}:${remaining.id}` : `add-guidance:${phase.id}`,
                "Guidance point removed."
              );
            },
            false,
            true,
            "minus"
          )
        );
        item.append(guidanceActions);
        const children = editorDocument.createElement("div");
        children.className = "guidance-children";
        (bullet.children || []).forEach((child, childIndex) => {
          const childRow = editorDocument.createElement("div");
          childRow.className = "guidance-child";
          childRow.dataset.kind = child.kind;
          const childControl = labeledControl(
            child.kind === "caution" ? "Caution" : "Supporting point",
            child.text,
            `child-text:${phase.id}:${child.id}`
          );
          const childCitationPaths = phaseCitationPaths(phase.id, (currentPhase) => {
            const currentBulletIndex = currentPhase.coachGuidance?.bullets
              ?.findIndex((item) => item.id === bullet.id) ?? -1;
            const currentChildIndex = currentPhase.coachGuidance?.bullets?.[currentBulletIndex]?.children
              ?.findIndex((item) => item.id === child.id) ?? -1;
            return currentBulletIndex < 0 || currentChildIndex < 0
              ? ""
              : `coachGuidance.bullets.${currentBulletIndex}.children.${currentChildIndex}.text`;
          });
          const style = editorDocument.createElement("select");
          style.dataset.editorControl = `child-style:${phase.id}:${child.id}`;
          style.dataset.focusKey = `child-style:${phase.id}:${child.id}`;
          [["support", "Supporting point"], ["caution", "Caution"]].forEach(([value, label]) => {
            const option = editorDocument.createElement("option");
            option.value = value;
            option.textContent = label;
            style.append(option);
          });
          style.value = child.kind;
          const styleField = editorDocument.createElement("label");
          styleField.className = "guidance-kind-field";
          const styleLabel = editorDocument.createElement("span");
          styleLabel.textContent = "Style";
          styleField.append(styleLabel, style);
          const synchronizeChildKindPresentation = (kind) => {
            const kindLabel = kind === "caution" ? "caution" : "supporting point";
            childRow.dataset.kind = kind;
            childControl.label.textContent = kind === "caution" ? "Caution" : "Supporting point";
            style.value = kind;
            const remove = childRow.querySelector(
              `[data-editor-action="remove-child:${phase.id}:${child.id}"]`
            );
            if (!remove) return;
            const accessibleName = `Remove ${kindLabel} ${childIndex + 1} under guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1}`;
            remove.setAttribute("aria-label", accessibleName);
            remove.dataset.tooltip = accessibleName;
          };
          wireGuidanceChildTextInput(childControl.input, {
            getChild: () => {
              syncFromCanonical();
              const index = phaseIndexForId(phase.id);
              return currentDraft.flow.phases[index]?.coachGuidance?.bullets
                ?.find((item) => item.id === bullet.id)?.children?.find((item) => item.id === child.id) || child;
            },
            onChange: runMountedOperation(childControl.input, ({ text, kind }) => {
              const index = phaseIndexForId(phase.id);
              const currentBulletIndex = guidanceIndexForId(index, bullet.id);
              const currentChildIndex = childIndexForId(index, currentBulletIndex, child.id);
              if (index < 0 || currentBulletIndex < 0 || currentChildIndex < 0) return;
              const before = clone(currentDraft.flow.phases);
              currentDraft.flow.phases[index] = editGuidanceChild(
                currentDraft.flow.phases[index],
                currentBulletIndex,
                currentChildIndex,
                { text, kind }
              );
              synchronizeChildKindPresentation(kind);
              const path = `coachGuidance.bullets.${currentBulletIndex}.children.${currentChildIndex}.text`;
              syncPhaseEdit(
                before,
                index,
                path,
                childControl.field,
                childCitationPaths,
                `${phase.id}:${child.id}:text`,
                childControl.input
              );
            })
          });
          style.addEventListener("change", runMountedOperation(style, () => {
            const index = phaseIndexForId(phase.id);
            const currentBulletIndex = guidanceIndexForId(index, bullet.id);
            const currentChildIndex = childIndexForId(index, currentBulletIndex, child.id);
            if (index < 0 || currentBulletIndex < 0 || currentChildIndex < 0) return;
            const before = clone(currentDraft.flow.phases);
            currentDraft.flow.phases[index] = editGuidanceChild(
              currentDraft.flow.phases[index],
              currentBulletIndex,
              currentChildIndex,
              { kind: style.value, kindOverride: true }
            );
            synchronizeChildKindPresentation(style.value);
            const path = `coachGuidance.bullets.${currentBulletIndex}.children.${currentChildIndex}.kind`;
            syncPhaseEdit(
              before,
              index,
              path,
              childControl.field,
              childCitationPaths,
              `${phase.id}:${child.id}:text`,
              childControl.input
            );
          }));
          renderFieldCitations(
            childControl.field,
            childCitationPaths,
            `${phase.id}:${child.id}:text`,
            childControl.input
          );
          const childActions = editorDocument.createElement("div");
          childActions.className = "guidance-actions guidance-child-actions";
          childActions.append(
            phaseAction(
              "",
              `move-child-up:${phase.id}:${child.id}`,
              `Move ${child.kind === "caution" ? "caution" : "supporting point"} ${childIndex + 1} under guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1} up`,
              () => {
                const index = phaseIndexForId(phase.id);
                const currentBulletIndex = guidanceIndexForId(index, bullet.id);
                const currentChildIndex = childIndexForId(index, currentBulletIndex, child.id);
                if (index < 0 || currentBulletIndex < 0 || currentChildIndex < 0) return;
                const before = clone(currentDraft.flow.phases);
                const next = clone(before);
                const currentChild = next[index].coachGuidance.bullets[currentBulletIndex].children[currentChildIndex];
                next[index] = moveGuidanceChild(next[index], currentBulletIndex, currentChildIndex, -1);
                moveAndRender(
                  next,
                  before,
                  `child-text:${phase.id}:${child.id}`,
                  `${currentChild.kind === "caution" ? "Caution" : "Supporting point"} moved up.`
                );
              },
              childIndex === 0,
              false,
              "arrow-up"
            ),
            phaseAction(
              "",
              `move-child-down:${phase.id}:${child.id}`,
              `Move ${child.kind === "caution" ? "caution" : "supporting point"} ${childIndex + 1} under guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1} down`,
              () => {
                const index = phaseIndexForId(phase.id);
                const currentBulletIndex = guidanceIndexForId(index, bullet.id);
                const currentChildIndex = childIndexForId(index, currentBulletIndex, child.id);
                if (index < 0 || currentBulletIndex < 0 || currentChildIndex < 0) return;
                const before = clone(currentDraft.flow.phases);
                const next = clone(before);
                const currentChild = next[index].coachGuidance.bullets[currentBulletIndex].children[currentChildIndex];
                next[index] = moveGuidanceChild(next[index], currentBulletIndex, currentChildIndex, 1);
                moveAndRender(
                  next,
                  before,
                  `child-text:${phase.id}:${child.id}`,
                  `${currentChild.kind === "caution" ? "Caution" : "Supporting point"} moved down.`
                );
              },
              childIndex === (bullet.children || []).length - 1,
              false,
              "arrow-down"
            ),
            phaseAction(
              "Remove",
              `remove-child:${phase.id}:${child.id}`,
              `Remove ${child.kind === "caution" ? "caution" : "supporting point"} ${childIndex + 1} under guidance point ${bulletIndex + 1} in phase ${phaseIndex + 1}`,
              () => {
                const index = phaseIndexForId(phase.id);
                const currentBulletIndex = guidanceIndexForId(index, bullet.id);
                const currentChildIndex = childIndexForId(index, currentBulletIndex, child.id);
                if (index < 0 || currentBulletIndex < 0 || currentChildIndex < 0) return;
                const before = clone(currentDraft.flow.phases);
                const next = clone(before);
                const currentChild = next[index].coachGuidance.bullets[currentBulletIndex].children[currentChildIndex];
                next[index] = removeGuidanceChild(next[index], currentBulletIndex, currentChildIndex);
                const remainingChildren = next[index].coachGuidance.bullets[currentBulletIndex].children;
                const remaining = remainingChildren[Math.min(currentChildIndex, remainingChildren.length - 1)];
                moveAndRender(
                  next,
                  before,
                  remaining ? `child-text:${phase.id}:${remaining.id}` : `add-child:${phase.id}:${bullet.id}`,
                  `${currentChild.kind === "caution" ? "Caution" : "Supporting point"} removed.`
                );
              },
              false,
              true,
              "minus"
            )
          );
          childRow.append(childControl.field, styleField, childActions);
          children.append(childRow);
        });
        item.append(children);
        guidanceSection.append(item);
      });
      if (!(phase.coachGuidance?.bullets || []).length) {
        const empty = editorDocument.createElement("p");
        empty.className = "phase-guidance-empty";
        empty.textContent = "No guidance points yet.";
        guidanceSection.append(empty);
      }
      const addMainPoint = phaseAction(
        "Add Main Point",
        `add-guidance:${phase.id}`,
        `Add guidance point to phase ${phaseIndex + 1}`,
        () => {
          const index = phaseIndexForId(phase.id);
          if (index < 0) return;
          const before = clone(currentDraft.flow.phases);
          const next = clone(before);
          next[index] = addGuidanceItem(next[index], { text: "" });
          const added = next[index].coachGuidance.bullets.at(-1);
          moveAndRender(next, before, `guidance-text:${phase.id}:${added.id}`, "Guidance point added.");
        }
      );
      addMainPoint.className = "button secondary compact-button phase-list-add";
      guidanceSection.append(addMainPoint);
      appendPhaseFindings(
        guidanceSection,
        phase.id,
        phaseIndex,
        `flow.phases.${phaseIndex}.coachGuidance`
      );

      const chatRequirementsSection = editorDocument.createElement("section");
      chatRequirementsSection.className = "phase-guidance";
      const updateChatRequirementsSummary = () => {
        if (!chatRequirementsReview) return;
        const index = phaseIndexForId(phase.id);
        const requirements = currentDraft.flow.phases[index]?.chatAdvanceRequirements || [];
        chatRequirementsReview.preview.textContent = requirements.length
          ? "Every required concept must match before Chat advances."
          : "Needs review — add required Learner phrases.";
        if (chatRequirementsReview.count) {
          chatRequirementsReview.count.textContent = `${requirements.length} ${requirements.length === 1 ? "concept" : "concepts"}`;
        }
      };
      const renderChatRequirementsEditor = () => {
        chatRequirementsSection.innerHTML = "";
        const index = phaseIndexForId(phase.id);
        if (index < 0) return;
        const requirements = currentDraft.flow.phases[index].chatAdvanceRequirements || [];
        const explanation = editorDocument.createElement("p");
        explanation.className = "phase-guidance-empty";
        explanation.textContent = "Add one group for each required Learner concept. Put alternative phrases for the same concept on separate lines; every group is required.";
        chatRequirementsSection.append(explanation);
        requirements.forEach((requirement, requirementIndex) => {
          const item = editorDocument.createElement("article");
          item.className = "phase-guidance-item";
          item.dataset.chatRequirementId = requirement.id;
          const phrases = labeledControl(
            `Required concept ${requirementIndex + 1} phrases (one per line)`,
            (requirement.phrases || []).join("\n"),
            `chat-requirement-phrases:${phase.id}:${requirement.id}`
          );
          phrases.input.addEventListener("input", runMountedOperation(phrases.input, () => {
            const currentIndex = phaseIndexForId(phase.id);
            if (currentIndex < 0) return;
            currentDraft.flow.phases[currentIndex] = editChatAdvanceRequirementPhrases(
              currentDraft.flow.phases[currentIndex],
              requirement.id,
              phrases.input.value
            );
            projectLegacy();
            notifyCommit();
            updateChatRequirementsSummary();
            refreshPhaseFindings(phase.id);
          }));
          wirePhaseBlur(phrases.input, phase.id);
          const actions = editorDocument.createElement("div");
          actions.className = "guidance-actions";
          actions.append(phaseAction(
            "Remove",
            `remove-chat-requirement:${phase.id}:${requirement.id}`,
            `Remove required Chat concept ${requirementIndex + 1} from phase ${phaseIndex + 1}`,
            () => {
              const currentIndex = phaseIndexForId(phase.id);
              if (currentIndex < 0) return;
              currentDraft.flow.phases[currentIndex] = removeChatAdvanceRequirement(
                currentDraft.flow.phases[currentIndex],
                requirement.id
              );
              projectLegacy();
              notifyCommit();
              renderChatRequirementsEditor();
              updateChatRequirementsSummary();
              refreshPhaseFindings(phase.id);
              const remaining = currentDraft.flow.phases[currentIndex].chatAdvanceRequirements || [];
              const nextRequirement = remaining[Math.min(requirementIndex, remaining.length - 1)];
              focusPhaseEditorControl(
                container,
                nextRequirement
                  ? `chat-requirement-phrases:${phase.id}:${nextRequirement.id}`
                  : `add-chat-requirement:${phase.id}`
              );
              onToast("Required Chat concept removed.");
            },
            false,
            true,
            "minus"
          ));
          item.append(phrases.field, actions);
          chatRequirementsSection.append(item);
        });
        const addRequirement = phaseAction(
          "Add required concept",
          `add-chat-requirement:${phase.id}`,
          `Add required Chat concept to phase ${phaseIndex + 1}`,
          () => {
            const currentIndex = phaseIndexForId(phase.id);
            if (currentIndex < 0) return;
            currentDraft.flow.phases[currentIndex] = addChatAdvanceRequirement(
              currentDraft.flow.phases[currentIndex]
            );
            const added = currentDraft.flow.phases[currentIndex].chatAdvanceRequirements.at(-1);
            projectLegacy();
            notifyCommit();
            renderChatRequirementsEditor();
            updateChatRequirementsSummary();
            refreshPhaseFindings(phase.id);
            focusPhaseEditorControl(
              container,
              `chat-requirement-phrases:${phase.id}:${added.id}`
            );
            onToast("Required Chat concept added.");
          }
        );
        addRequirement.className = "button secondary compact-button phase-list-add";
        chatRequirementsSection.append(addRequirement);
      };
      const includesChat = currentDraft.scenario?.channels?.includes("chat");
      if (includesChat) {
        renderChatRequirementsEditor();
        appendPhaseFindings(
          chatRequirementsSection,
          phase.id,
          phaseIndex,
          `flow.phases.${phaseIndex}.chatAdvanceRequirements`
        );
      }

      const strong = labeledControl(
        "Example of a strong Learner response",
        phase.strongLearnerResponse,
        `strong-response:${phase.id}`
      );
      strong.label.className = "visually-hidden";
      const strongCitationPaths = phaseCitationPaths(phase.id, "strongLearnerResponse");
      strong.input.addEventListener("input", runMountedOperation(strong.input, () => {
        const index = phaseIndexForId(phase.id);
        if (index < 0) return;
        const before = clone(currentDraft.flow.phases);
        const hadChatRequirements = Boolean(
          currentDraft.flow.phases[index].chatAdvanceRequirements?.length
        );
        currentDraft.flow.phases[index] = updatePhaseStrongLearnerResponse(
          currentDraft.flow.phases[index],
          strong.input.value
        );
        strongReview.preview.textContent = strong.input.value.trim() || "No strong response yet.";
        syncPhaseEdit(
          before,
          index,
          "strongLearnerResponse",
          strong.field,
          strongCitationPaths,
          `${phase.id}:strongLearnerResponse`,
          strong.input
        );
        if (hadChatRequirements && includesChat) {
          renderChatRequirementsEditor();
          updateChatRequirementsSummary();
          refreshPhaseFindings(phase.id);
          onToast("Required Chat phrases cleared because the strong response changed.");
        }
      }));
      wirePhaseBlur(strong.input, phase.id);
      renderFieldCitations(
        strong.field,
        strongCitationPaths,
        `${phase.id}:strongLearnerResponse`,
        strong.input
      );
      appendPhaseFindings(
        strong.field,
        phase.id,
        phaseIndex,
        `flow.phases.${phaseIndex}.strongLearnerResponse`
      );

      if (!evaluationDetailsOpen.has(phase.id)) evaluationDetailsOpen.set(phase.id, false);
      const evaluates = renderPhaseEvaluation(phase, phaseIndex, {
        document: editorDocument,
        draft: currentDraft,
        getDraft: () => {
          syncFromCanonical();
          return currentDraft;
        },
        onDraftChange: commitEvaluationDraft,
        onBlur: onPhaseFieldBlur,
        renderObjectiveRecommendation,
        open: evaluationDetailsOpen.get(phase.id),
        onOpenChange: (open) => evaluationDetailsOpen.set(phase.id, open),
        decorateField: (field, citationField) => {
          const semanticPath = citationField.field === "criterion"
            ? `evaluation.objectives.${citationField.objectiveId}.criteria.${citationField.criterionId}.text`
            : `evaluation.objectives.${citationField.objectiveId}.${citationField.field}`;
          const actionKey = citationField.field === "criterion"
            ? `${citationField.objectiveId}:${citationField.criterionId}:text`
            : `${citationField.objectiveId}:${citationField.field}`;
          field.dataset.evaluationCitationPath = semanticPath;
          field.dataset.evaluationCitationActionKey = actionKey;
          renderFieldCitations(
            field,
            () => canonicalEvaluationCitationPaths(semanticPath),
            actionKey,
            citationField.input,
            () => refreshSharedEvaluationCitations(semanticPath, citationField.input)
          );
        }
      });
      titleReview = phaseReviewSection({
        phaseId: phase.id,
        key: "title",
        label: "Title",
        preview: String(phase.title || "").trim() || "Untitled phase",
        iconName: "letter-t",
        content: title.field
      });
      const partnerEditor = editorDocument.createElement("div");
      partnerEditor.className = "phase-partner-editor";
      partnerEditor.append(partner.field);
      if (partnerStarts) partnerEditor.append(partnerStarts);
      partnerReview = phaseReviewSection({
        phaseId: phase.id,
        key: "partner",
        label: "Conversation Partner says",
        preview: String(phase.partnerTurn || "").trim() || "No Conversation Partner turn yet.",
        iconName: "user",
        meta: partnerStartsSummaryText,
        metaIconName: partnerStartsSummaryText ? "square-check" : "",
        metaIconHidden: !partnerStartsSummaryChecked,
        content: partnerEditor
      });
      const guidancePoints = phase.coachGuidance?.bullets || [];
      guidanceReview = phaseReviewSection({
        phaseId: phase.id,
        key: "guidance",
        label: "Coach Chewy guidance",
        preview: String(guidancePoints[0]?.text || "").trim() || "No guidance points yet.",
        count: `${guidancePoints.length} ${guidancePoints.length === 1 ? "point" : "points"}`,
        iconName: "dog",
        content: guidanceSection
      });
      strongReview = phaseReviewSection({
        phaseId: phase.id,
        key: "strong-response",
        label: "Strong response",
        preview: String(phase.strongLearnerResponse || "").trim() || "No strong response yet.",
        iconName: "shield-check",
        content: strong.field
      });
      if (includesChat) {
        const requirements = phase.chatAdvanceRequirements || [];
        chatRequirementsReview = phaseReviewSection({
          phaseId: phase.id,
          key: "chat-requirements",
          label: "Chat advance requirements",
          preview: requirements.length
            ? "Every required concept must match before Chat advances."
            : "Needs review — add required Learner phrases.",
          count: `${requirements.length} ${requirements.length === 1 ? "concept" : "concepts"}`,
          iconName: "square-check",
          content: chatRequirementsSection
        });
      }
      if (closingPartner) {
        closingPartnerReview = phaseReviewSection({
          phaseId: phase.id,
          key: "closing-partner",
          label: "Final Conversation Partner response",
          preview: String(currentDraft.flow?.closingPartnerTurn || "").trim()
            || "No final Conversation Partner response yet.",
          iconName: "user",
          content: closingPartner.field
        });
      }
      body.append(
        titleReview.details,
        partnerReview.details,
        guidanceReview.details,
        strongReview.details,
        ...(chatRequirementsReview ? [chatRequirementsReview.details] : []),
        ...(closingPartnerReview ? [closingPartnerReview.details] : []),
        evaluates
      );
      card.append(heading, body);
      container.append(card);
      if (phaseIndex < phases.length - 1 && phases.length < 12) {
        const boundary = editorDocument.createElement("div");
        boundary.className = "phase-boundary";
        const insert = editorDocument.createElement("button");
        insert.type = "button";
        insert.className = "phase-boundary-insert";
        insert.dataset.phaseInsertIndex = String(phaseIndex + 1);
        insert.dataset.focusKey = `insert-phase:${phase.id}`;
        insert.setAttribute(
          "aria-label",
          `Insert a phase between phases ${phaseIndex + 1} and ${phaseIndex + 2}`
        );
        insert.dataset.tooltip = insert.getAttribute("aria-label");
        insert.removeAttribute("title");
        const icon = editorDocument.createElement("img");
        icon.src = "/builder-studio/assets/icons/plus.svg";
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        insert.append(icon);
        insert.addEventListener("click", runMountedOperation(insert, () => {
          const currentIndex = phaseIndexForId(phase.id);
          if (currentIndex < 0) return;
          const before = clone(currentDraft.flow.phases);
          const insertionIndex = currentIndex + 1;
          const added = createBlankPhase(insertionIndex + 1);
          const next = insertPhase(before, added, insertionIndex);
          if (next.length === before.length) return;
          openPhaseId = added.id;
          moveAndRender(
            next,
            before,
            `phase-title:${added.id}`,
            `Phase ${insertionIndex + 1} added.`
          );
        }));
        boundary.append(insert);
        container.append(boundary);
      }
    });
    synchronizePhaseDisclosures();
    syncSelectTitles(container);
  };

  const refreshPhaseFindings = (phaseId) => {
    syncFromCanonical();
    const refreshers = phaseId === undefined
      ? [...phaseFindingRefreshers.values()].flat()
      : phaseFindingRefreshers.get(phaseId);
    if (!refreshers?.length) return false;
    refreshers.forEach((refresh) => refresh());
    return true;
  };

  projectLegacy();
  return {
    render,
    refreshPhaseFindings,
    synchronizeEvaluationControls,
    openPhase,
    isPhaseOpen,
    getDraft: () => clone(currentDraft),
    getGrounding: () => clone(currentGrounding)
  };
}

export function createPointerAwareValidationRefreshGate({
  document: editorDocument,
  scope,
  isCurrent = () => true,
  onFlush = () => {},
  queueMicrotask: enqueueMicrotask = (callback) => {
    if (typeof globalThis.queueMicrotask === "function") {
      globalThis.queueMicrotask(callback);
    } else {
      Promise.resolve().then(callback);
    }
  },
  scheduleTask = (callback, delay = 0) => globalThis.setTimeout(callback, delay),
  cancelTask = (taskId) => globalThis.clearTimeout(taskId)
} = {}) {
  const pendingPhaseIds = new Set();
  const eventWindow = editorDocument?.defaultView || null;
  let activePointer = null;
  let pointerTask = null;
  let nextPointerEpoch = 0;
  let flushQueued = false;
  let destroyed = false;

  const cancelPointerTask = () => {
    if (!pointerTask) return;
    cancelTask(pointerTask.id);
    pointerTask = null;
  };
  const flush = () => {
    if (destroyed || activePointer || !pendingPhaseIds.size) return;
    const phaseIds = [...pendingPhaseIds].filter((phaseId) => isCurrent(phaseId));
    pendingPhaseIds.clear();
    if (phaseIds.length) onFlush(phaseIds);
  };
  const queueFlush = () => {
    if (destroyed || flushQueued) return;
    flushQueued = true;
    enqueueMicrotask(() => {
      flushQueued = false;
      flush();
    });
  };
  const pointerIdFor = (event) => {
    const pointerId = Number(event?.pointerId);
    return Number.isFinite(pointerId) ? pointerId : null;
  };
  const isCorrelated = (event) => {
    if (!activePointer) return false;
    const pointerId = pointerIdFor(event);
    return pointerId === null || pointerId === activePointer.id;
  };
  const clearPointerAndFlush = () => {
    activePointer = null;
    cancelPointerTask();
    flush();
  };
  const schedulePointerTask = (kind, delay, pointer, onComplete) => {
    cancelPointerTask();
    const task = { id: null, kind, epoch: pointer.epoch };
    pointerTask = task;
    task.id = scheduleTask(() => {
      if (
        destroyed ||
        pointerTask !== task ||
        activePointer?.epoch !== task.epoch
      ) {
        return;
      }
      pointerTask = null;
      onComplete();
    }, delay);
  };
  const handlePointerDown = (event) => {
    const pointerId = pointerIdFor(event);
    if (
      destroyed ||
      pointerId === null ||
      event?.isPrimary === false ||
      (event?.button !== undefined && event.button !== 0) ||
      !scope?.contains?.(editorDocument?.activeElement)
    ) {
      return;
    }
    cancelPointerTask();
    nextPointerEpoch += 1;
    activePointer = {
      epoch: nextPointerEpoch,
      id: pointerId,
      type: String(event?.pointerType || "mouse").toLowerCase()
    };
  };
  const handlePointerUp = (event) => {
    if (!isCorrelated(event)) return;
    const pointer = activePointer;
    const delay = pointer.type === "touch" ? 500 : 0;
    schedulePointerTask("no-click", delay, pointer, () => {
      activePointer = null;
      flush();
    });
  };
  const handleClick = (event) => {
    if (!isCorrelated(event)) return;
    const pointer = activePointer;
    schedulePointerTask("post-click", 0, pointer, () => {
      activePointer = null;
      flush();
    });
  };
  const handlePointerCancel = (event) => {
    if (!isCorrelated(event)) return;
    clearPointerAndFlush();
  };
  const handleWindowBlur = () => clearPointerAndFlush();

  editorDocument?.addEventListener?.("pointerdown", handlePointerDown, true);
  editorDocument?.addEventListener?.("pointerup", handlePointerUp, true);
  editorDocument?.addEventListener?.("pointercancel", handlePointerCancel, true);
  editorDocument?.addEventListener?.("click", handleClick, true);
  eventWindow?.addEventListener?.("blur", handleWindowBlur);

  return {
    request(phaseId) {
      if (destroyed || phaseId === undefined || phaseId === null) return;
      pendingPhaseIds.add(phaseId);
      if (!activePointer) queueFlush();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editorDocument?.removeEventListener?.("pointerdown", handlePointerDown, true);
      editorDocument?.removeEventListener?.("pointerup", handlePointerUp, true);
      editorDocument?.removeEventListener?.("pointercancel", handlePointerCancel, true);
      editorDocument?.removeEventListener?.("click", handleClick, true);
      eventWindow?.removeEventListener?.("blur", handleWindowBlur);
      cancelPointerTask();
      activePointer = null;
      pendingPhaseIds.clear();
    }
  };
}

export function createReviewConversationPhaseEditorCoordinator({
  document: editorDocument,
  container,
  canonicalState,
  onDirty = () => {},
  onObjectiveLabelChange = onDirty,
  onRenderReadiness = () => {},
  onRenderBlockingSummary = () => {},
  onPhaseFieldBlur = () => {},
  ...coordinatorOptions
} = {}) {
  const stateBoundary = createConversationPhaseEditorStateBoundary(canonicalState, {
    onMaterialChange: (meta) => {
      if (meta.objectiveLabelId) onObjectiveLabelChange(meta.objectiveLabelId);
      else onDirty();
      onRenderReadiness();
      onRenderBlockingSummary();
    }
  });
  const validationRefreshGate = createPointerAwareValidationRefreshGate({
    document: editorDocument,
    scope: container,
    isCurrent: (phaseId) => Boolean(canonicalState?.draft?.flow?.phases?.some(
      (phase) => phase.id === phaseId
    )),
    onFlush: (phaseIds) => phaseIds.forEach(onPhaseFieldBlur)
  });
  const coordinator = createConversationPhaseEditorCoordinator({
    ...coordinatorOptions,
    document: editorDocument,
    container,
    ...stateBoundary,
    onPhaseFieldBlur: validationRefreshGate.request
  });
  if (!coordinator) {
    validationRefreshGate.destroy();
    return null;
  }
  return Object.assign(coordinator, { destroy: validationRefreshGate.destroy });
}

function addConversationPhase() {
  const phases = clone(state.draft.flow.phases);
  if (phases.length >= 12) return;
  const number = phases.length + 1;
  const addedPhase = createBlankPhase(number);
  state.draft.flow.phases = addPhase(phases, addedPhase);
  setSourceGrounding(remapConversationPhaseCitations(
    currentSourceGrounding(),
    phases,
    state.draft.flow.phases
  ));
  syncLegacyConversationFlow();
  setDirty();
  renderConversationPhases();
  conversationPhaseEditorCoordinator?.openPhase(addedPhase.id);
  focusPhaseEditorControl(elements.phaseList, `phase-title:${addedPhase.id}`);
  showToast(`Phase ${number} added.`);
  elements.phaseList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderConversationPhases() {
  if (!elements.phaseList) return;
  elements.addPhaseButton.disabled = (state.draft?.flow?.phases || []).length >= 12;
  if (!conversationPhaseEditorCoordinator) {
    conversationPhaseEditorCoordinator = createReviewConversationPhaseEditorCoordinator({
      document,
      container: elements.phaseList,
      canonicalState: state,
      onDirty: setDirty,
      onObjectiveLabelChange: commitObjectiveLabelMutation,
      onRenderReadiness: renderReviewReadiness,
      onRenderBlockingSummary: renderReviewBlockingSummary,
      onToast: showToast,
      getPhaseFindings: (phaseId) => {
        if (!state.reviewIssuePhaseIds.has(phaseId) && !state.reviewTestAttempted) return [];
        return reviewFindingTargets(state.draft)
          .filter((target) => target.phaseId === phaseId)
          .map((target) => target.finding);
      },
      onPhaseFieldBlur: (phaseId) => {
        state.reviewIssuePhaseIds.add(phaseId);
        conversationPhaseEditorCoordinator?.refreshPhaseFindings(phaseId);
      },
      renderObjectiveRecommendation: ({ objectiveId, phaseId }) =>
        createObjectiveRecommendationControls(objectiveId, `phase:${phaseId}`, document),
      renderSystemReference: createGuidanceSystemReferenceRenderer({
        document,
        assetLoader: scenarioAssetLoader,
        getPublicationId: () => state.assetPublicationId,
        dialog: elements.guidanceImageDialog,
        dialogImage: elements.guidanceImageDialogImage,
        dialogCaption: elements.guidanceImageDialogCaption,
        objectUrls: guidanceImageObjectUrls
      })
    });
  }
  conversationPhaseEditorCoordinator.render();
  syncSelectTitles(elements.phaseList);
}

export function createGuidanceSystemReferenceRenderer({
  document: referenceDocument,
  assetLoader = null,
  getPublicationId = () => "",
  dialog = null,
  dialogImage = null,
  dialogCaption = null,
  objectUrls = new Set()
} = {}) {
  return (bullet) => {
    const reference = bullet?.systemReference;
    if (!referenceDocument || reference?.type !== "image") return null;
    const figure = referenceDocument.createElement("figure");
    figure.className = "guidance-image-preview";
    figure.dataset.guidanceReference = reference.assetKey;
    const button = referenceDocument.createElement("button");
    button.type = "button";
    const label = `Enlarge ${reference.alt}`;
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    button.removeAttribute("title");
    const image = referenceDocument.createElement("img");
    const sourceScenarioId = String(reference.assetKey || "")
      .match(/^assets\/scenarios\/([^/]+)\//)?.[1] || "";
    image.alt = reference.alt;
    image.dataset.assetKey = reference.assetKey;
    button.disabled = Boolean(sourceScenarioId);
    button.append(image);
    button.addEventListener("click", () => {
      if (!image.src || !dialog || !dialogImage || !dialogCaption) return;
      dialogImage.src = image.src;
      dialogImage.alt = reference.alt;
      dialogCaption.textContent = reference.caption || bullet.text;
      dialog.showModal();
    });
    const caption = referenceDocument.createElement("figcaption");
    caption.textContent = reference.caption || bullet.text;
    if (sourceScenarioId && assetLoader) {
      assetLoader.load({
        scenarioId: sourceScenarioId,
        assetKey: reference.assetKey,
        publicationId: getPublicationId()
      }).then((blob) => {
        if (!image.isConnected) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.add(objectUrl);
        image.src = objectUrl;
        button.disabled = false;
      }).catch(() => {
        if (!image.isConnected) return;
        button.hidden = true;
        caption.textContent = "Reference image unavailable.";
      });
    } else {
      image.src = "/builder-studio/assets/coach-chewy.png";
      button.disabled = false;
    }
    figure.append(button, caption);
    return figure;
  };
}

function clearGuidanceImageObjectUrls() {
  guidanceImageObjectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  guidanceImageObjectUrls.clear();
  if (elements.guidanceImageDialog?.open) elements.guidanceImageDialog.close();
  if (elements.guidanceImageDialogImage) {
    elements.guidanceImageDialogImage.removeAttribute("src");
  }
}

function normalizeHotkey(item) {
  if (!item || typeof item !== "object") return null;
  const hotkey = String(item.hotkey || item.key || item.id || "").trim();
  const template = String(
    item.template || item.canned_text || item.cannedText || item.response || item.text || ""
  ).trim();
  if (!hotkey || !template) return null;
  return {
    hotkey: hotkey.toLowerCase(),
    template,
    category: String(item.category || item.label || "Standard Text").trim(),
    notes: Array.isArray(item.notes) ? item.notes.map(String) : [],
    recommended: Boolean(item.recommended || item.isRecommended),
    selected: Boolean(item.selected),
    agentRole: String(item.agent_role || item.agentRole || "").trim().toLowerCase()
  };
}

function hotkeySelected(item) {
  return Boolean(selectedHotkey(item));
}

function selectedHotkey(item) {
  const responseId = String(item?.id || "").trim();
  return state.draft.chat.standardText.find(
    (selected) =>
      responseId
        ? selected.id === responseId
        : selected.hotkey.toLowerCase() === item.hotkey.toLowerCase() &&
          selected.template === item.template
  );
}

function approvedResponseSignature(response) {
  return JSON.stringify({
    hotkey: String(response?.hotkey || "").toLowerCase(),
    category: String(response?.category || ""),
    template: String(response?.template || "")
  });
}

function commitApprovedResponseSet(nextDraft) {
  const before = state.draft?.chat?.standardText || [];
  const normalizedChat = normalizeStudioDraft(nextDraft).chat;
  const next = clone(nextDraft);
  next.chat = {
    ...(next.chat || {}),
    standardText: normalizedChat.standardText,
    approvedResponseAssignments: normalizedChat.approvedResponseAssignments
  };
  const afterById = new Map(next.chat.standardText.map((response) => [response.id, response]));
  before.forEach((response) => {
    const replacement = afterById.get(response.id);
    if (!replacement) {
      invalidateContentRecommendation("response", response.id, { remove: true });
    } else if (approvedResponseSignature(replacement) !== approvedResponseSignature(response)) {
      invalidateContentRecommendation("response", response.id);
    }
  });
  state.draft = next;
}

export function updateStandardTextSelection({
  draft,
  response,
  selected
} = {}) {
  const next = clone(draft || {});
  next.chat ||= {};
  const current = Array.isArray(next.chat.standardText)
    ? clone(next.chat.standardText)
    : [];
  const responseId = String(response?.id || "").trim();
  const hotkey = String(response?.hotkey || "").trim().toLowerCase();
  const template = String(response?.template || "").trim();
  const matches = responseId
    ? (entry) => entry.id === responseId
    : (entry) =>
        hotkey &&
        entry.hotkey?.toLowerCase() === hotkey &&
        (!template || entry.template === template);

  if (selected) {
    if (!hotkey || !template) return next;
    const candidate = {
      ...(responseId ? { id: responseId } : {}),
      hotkey,
      category: String(response?.category || "").trim(),
      template,
      notes: Array.isArray(response?.notes) ? response.notes.map(String) : []
    };
    const index = current.findIndex(matches);
    if (index < 0) current.push(candidate);
    else current[index] = candidate;
  } else {
    const removedIds = new Set(current.filter(matches).map((entry) => entry.id).filter(Boolean));
    next.chat.approvedResponseAssignments = (
      Array.isArray(next.chat.approvedResponseAssignments)
        ? next.chat.approvedResponseAssignments
        : []
    ).filter((assignment) => !removedIds.has(assignment.responseId));
    next.chat.standardText = current.filter((entry) => !matches(entry));
    return next;
  }

  next.chat.standardText = current;
  const normalizedChat = normalizeStudioDraft(next).chat;
  next.chat.standardText = normalizedChat.standardText;
  next.chat.approvedResponseAssignments = normalizedChat.approvedResponseAssignments;
  return next;
}

function setHotkeySelected(item, selected) {
  const previous = selectedHotkey(item);
  const nextDraft = updateStandardTextSelection({
    draft: state.draft,
    response: item,
    selected
  });
  commitApprovedResponseSet(nextDraft);
  setDirty();
  renderHotkeys();
  const current = selectedHotkey(item);
  if (selected && current?.id && current.id !== previous?.id) {
    requestContentRecommendation("response", current.id);
  }
}

function appendApprovedResponseAssignment(card, responseId, before = null) {
  const assignment = (state.draft.chat.approvedResponseAssignments || [])
    .find((item) => item.responseId === responseId);
  if (!assignment) return;
  const mapping = document.createElement("div");
  mapping.className = "approved-response-assignment";
  const phase = document.createElement("strong");
  phase.textContent = phaseTitleForId(assignment.phaseId);
  const instruction = document.createElement("small");
  instruction.textContent = assignment.instruction;
  mapping.append(phase, instruction);
  if (before) card.insertBefore(mapping, before);
  else card.append(mapping);
}

function makeHotkeyCard(item, selectable = true) {
  const card = document.createElement("article");
  card.className = "hotkey-card";
  if (!selectable && item.id) {
    card.dataset.responseId = item.id;
    card.dataset.contentRecommendationSource = contentRecommendationKey("response", item.id);
    card.dataset.contentRecommendationLocation = "selected";
  }
  if (selectable) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = hotkeySelected(item);
    checkbox.setAttribute("aria-label", `Select ${item.hotkey} ${item.category}`);
    checkbox.addEventListener("change", () => setHotkeySelected(item, checkbox.checked));
    card.append(checkbox);
  } else {
    const spacer = document.createElement("span");
    card.append(spacer);
  }
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${item.hotkey.toUpperCase()} - ${item.category}`;
  const response = document.createElement("small");
  response.textContent = item.template;
  copy.append(title, response);
  card.append(copy);
  if (!selectable) {
    const remove = removeIconButton({
      label: `Remove approved response ${item.hotkey.toUpperCase()}`,
      onClick: () => setHotkeySelected(item, false)
    });
    card.append(remove);
    appendApprovedResponseAssignment(card, item.id);
    const recommendationReview = document.createElement("div");
    recommendationReview.className = "content-recommendation-review";
    recommendationReview.setAttribute("role", "status");
    recommendationReview.setAttribute("aria-live", "polite");
    renderContentRecommendationReview(recommendationReview, {
      kind: "response",
      sourceId: item.id,
      response: contentRecommendationSource("response", item.id) || item,
      focusLocation: "selected"
    });
    card.append(recommendationReview);
  } else {
    const stateText = document.createElement("small");
    stateText.textContent = hotkeySelected(item) ? "Selected" : "Available";
    card.append(stateText);
  }
  return card;
}

function renderHotkeyCollection(container, items, selectable = true) {
  container.innerHTML = "";
  items.forEach((item) => container.append(makeHotkeyCard(item, selectable)));
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No approved responses found</strong><p>Try another search or add one yourself.</p>";
    container.append(empty);
  }
}

function renderHotkeys() {
  const profile = String(state.draft.chat.hotkeyProfile || "core").toLowerCase();
  const library = state.hotkeys.filter(
    (item) => !item.agentRole || item.agentRole === profile
  );
  const recommended = library.filter((item) => item.recommended || item.selected).slice(0, 5);
  renderHotkeyCollection(
    elements.recommendedHotkeys,
    recommended.length ? recommended : library.slice(0, 3)
  );
  const query = elements.hotkeySearchInput.value.trim().toLowerCase();
  const filtered = library.filter((item) =>
    [item.hotkey, item.category, item.template].some((value) =>
      String(value).toLowerCase().includes(query)
    )
  );
  renderHotkeyCollection(elements.hotkeyLibrary, filtered);
  const selected = (state.draft.chat.standardText || []).map((item) => ({
    ...item,
    category:
      library.find(
        (entry) =>
          entry.hotkey.toLowerCase() === item.hotkey.toLowerCase() &&
          entry.template === item.template
      )
        ?.category || "Selected Standard Text"
  }));
  renderHotkeyCollection(elements.selectedHotkeys, selected, false);
  elements.selectedHotkeysSection.hidden = selected.length === 0;
}

export function recommendedStandardTextDefaults({
  hotkeys = [],
  profile = "core",
  existing = []
} = {}) {
  if (Array.isArray(existing) && existing.length) {
    return existing.map((item) => ({
      ...item,
      ...(Array.isArray(item.notes) ? { notes: [...item.notes] } : {})
    }));
  }
  const normalizedProfile = String(profile || "core").trim().toLowerCase();
  const eligible = (Array.isArray(hotkeys) ? hotkeys : []).filter((item) => {
    const agentRole = String(item?.agentRole || "").trim().toLowerCase();
    return !agentRole || agentRole === normalizedProfile;
  });
  const preferred = eligible
    .filter((item) => item.recommended || item.selected)
    .slice(0, 3);
  const defaults = preferred.length ? preferred : eligible.slice(0, 3);
  return defaults.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    hotkey: item.hotkey,
    ...(item.category ? { category: item.category } : {}),
    template: item.template,
    notes: Array.isArray(item.notes) ? [...item.notes] : []
  }));
}

export function prepareStandardTextMode({
  draft
} = {}) {
  const nextDraft = clone(draft || {});
  nextDraft.chat = {
    ...(nextDraft.chat || {}),
    standardText: Array.isArray(nextDraft.chat?.standardText)
      ? nextDraft.chat.standardText
      : []
  };
  return {
    draft: nextDraft,
    mode: nextDraft.chat.standardText.length ? "recommended" : "none"
  };
}

export function updateStandardTextProfile({
  draft,
  profile,
  hotkeys = [],
  mode = "recommended"
} = {}) {
  const nextDraft = clone(draft || {});
  nextDraft.chat = {
    ...(nextDraft.chat || {}),
    hotkeyProfile: String(profile || nextDraft.chat?.hotkeyProfile || "core"),
    standardText: Array.isArray(nextDraft.chat?.standardText)
      ? nextDraft.chat.standardText
      : []
  };
  if (mode === "recommended") {
    nextDraft.chat.standardText = recommendedStandardTextDefaults({
      hotkeys,
      profile: nextDraft.chat.hotkeyProfile,
      existing: []
    });
    if (Object.hasOwn(nextDraft.chat, "approvedResponseAssignments")) {
      nextDraft.chat.approvedResponseAssignments = [];
    }
  }
  return nextDraft;
}

function setStandardTextMode(mode, { applyDefault = false } = {}) {
  state.standardTextMode = mode;
  $$('input[name="standardTextMode"]').forEach((input) => {
    input.checked = input.value === mode;
  });
  $$("[data-standard-text-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.standardTextPanel !== mode;
  });
  if (mode === "none") {
    if (
      state.draft.chat.standardText.length ||
      state.draft.chat.approvedResponseAssignments?.length
    ) {
      const nextDraft = clone(state.draft);
      nextDraft.chat.standardText = [];
      nextDraft.chat.approvedResponseAssignments = [];
      commitApprovedResponseSet(nextDraft);
      setDirty();
    }
  } else if (mode === "recommended" && applyDefault && !state.draft.chat.standardText.length) {
    const defaults = recommendedStandardTextDefaults({
      hotkeys: state.hotkeys,
      profile: state.draft.chat.hotkeyProfile,
      existing: state.draft.chat.standardText
    });
    if (defaults.length) {
      const nextDraft = clone(state.draft);
      nextDraft.chat.standardText = defaults;
      commitApprovedResponseSet(nextDraft);
      setDirty();
    }
  }
  renderHotkeys();
}

function healthCheckForCurrentDraft() {
  state.healthCheck = runScenarioHealthCheck(state.draft);
  return state.healthCheck;
}

export function renderReviewFindingActions({
  document: actionDocument = browserDocument,
  targets = [],
  phaseCoordinator = null,
  phaseList = null,
  onOpen = () => {}
} = {}) {
  const actions = actionDocument.createElement("div");
  actions.className = "review-blocking-actions";
  const uniqueTargets = [...new Map(targets.map((target) => [
    `${target.phaseId}:${target.focusKey}`,
    target
  ])).values()];
  uniqueTargets.forEach((target) => {
    const button = actionDocument.createElement("button");
    button.type = "button";
    button.className = "button secondary compact-button";
    button.textContent = `Open phase ${target.phaseIndex + 1}`;
    button.addEventListener("click", () => {
      phaseCoordinator?.openPhase?.(target.phaseId);
      const card = phaseList?.querySelector(`[data-phase-id="${target.phaseId}"]`);
      card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (phaseList) focusPhaseEditorControl(phaseList, target.focusKey);
      onOpen(target);
    });
    actions.append(button);
  });
  return actions;
}

function renderReviewBlockingSummary() {
  if (!elements.reviewBlockingSummary) return;
  const findings = blockingPhaseEvaluationFindings(state.draft);
  const targets = reviewFindingTargets(state.draft, findings);
  elements.reviewBlockingSummary.innerHTML = "";
  elements.reviewBlockingSummary.hidden = !state.reviewTestAttempted || !findings.length;
  if (elements.reviewBlockingSummary.hidden) return;
  const heading = document.createElement("strong");
  heading.textContent = "Complete these phase details before downloading";
  const detail = document.createElement("p");
  detail.textContent = `${findings.length} ${findings.length === 1 ? "item needs" : "items need"} your attention.`;
  const actions = renderReviewFindingActions({
    document,
    targets,
    phaseCoordinator: conversationPhaseEditorCoordinator,
    phaseList: elements.phaseList
  });
  elements.reviewBlockingSummary.append(heading, detail, actions);
}

function revealReviewBlockingIssues() {
  state.reviewTestAttempted = true;
  state.draft.flow.phases.forEach((phase) => state.reviewIssuePhaseIds.add(phase.id));
  renderReviewBlockingSummary();
  renderConversationPhases();
  const firstTarget = reviewFindingTargets(state.draft)[0];
  if (firstTarget) {
    conversationPhaseEditorCoordinator?.openPhase(firstTarget.phaseId);
    focusPhaseEditorControl(elements.phaseList, firstTarget.focusKey);
  }
}

function renderHealthCheck() {
  if (!elements.healthCheckSummary || !elements.healthCheckFindings) return;
  elements.healthCheckFindings.innerHTML = "";
  if (!state.draft) {
    elements.healthCheckSummary.innerHTML = "<strong>Create a draft to run the Conversation Health Check.</strong>";
    return;
  }
  const health = state.healthCheck || healthCheckForCurrentDraft();
  const { critical, warning } = health.summary;
  elements.healthCheckSummary.innerHTML = "";
  const headline = document.createElement("strong");
  headline.textContent = critical
    ? `${critical} critical ${critical === 1 ? "finding" : "findings"} must be fixed before downloading`
    : "No critical integrity or safety failures";
  const detail = document.createElement("span");
  detail.textContent = warning
    ? `${warning} ${warning === 1 ? "warning is" : "warnings are"} available for creator review.`
    : "No warnings found in the current authored fields.";
  elements.healthCheckSummary.dataset.status = critical ? "critical" : warning ? "warning" : "passed";
  elements.healthCheckSummary.append(headline, detail);

  if (!health.findings.length) {
    const empty = document.createElement("div");
    empty.className = "quality-empty";
    empty.innerHTML = "<strong>The authored fields are aligned</strong><p>Roles, accessible facts, objectives, criteria, guidance, privacy, promises, and Chat and Voice parity passed this check.</p>";
    elements.healthCheckFindings.append(empty);
    return;
  }

  [...health.findings]
    .sort((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical"))
    .forEach((item) => {
      const card = document.createElement("article");
      card.className = "health-finding";
      card.dataset.severity = item.severity;

      const header = document.createElement("div");
      header.className = "finding-header";
      const badge = document.createElement("span");
      badge.className = "quality-badge";
      badge.textContent = item.severity === "critical" ? "Critical" : "Warning";
      const title = document.createElement("strong");
      title.textContent = item.category;
      header.append(badge, title);

      const location = document.createElement("p");
      location.className = "finding-location";
      location.textContent = `${item.section} · ${item.fieldPath}`;
      const rationale = document.createElement("p");
      rationale.textContent = item.rationale;
      const correction = document.createElement("p");
      correction.className = "finding-correction";
      correction.textContent = `Proposed correction: ${item.proposedCorrection.summary}`;

      const actions = document.createElement("div");
      actions.className = "finding-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "button secondary compact-button";
      openButton.textContent = "Open section";
      openButton.addEventListener("click", () => {
        openReviewSection(reviewSectionForIssue(item.section || item.fieldPath));
      });
      actions.append(openButton);

      if (Object.hasOwn(item.proposedCorrection, "replacement")) {
        const applyButton = document.createElement("button");
        applyButton.type = "button";
        applyButton.className = "button secondary compact-button";
        applyButton.textContent = "Apply this field fix";
        applyButton.addEventListener("click", () => {
          setPath(state.draft, item.fieldPath, clone(item.proposedCorrection.replacement));
          markCitationsEdited(item.fieldPath);
          setDirty();
          renderReview();
          showToast(`Updated only ${item.fieldPath}. Review the field before continuing.`);
        });
        actions.append(applyButton);
      }

      card.append(header, location, rationale, correction, actions);
      elements.healthCheckFindings.append(card);
    });
}

function renderReview() {
  if (!state.draft) return;
  fillBoundFields();
  renderSetupObjectiveEditor();
  refreshSetupObjectiveErrors();
  renderTaxonomyControls();
  renderChannelVisibility();
  renderAllStringLists();
  renderConversationPhases();
  renderHotkeys();
  healthCheckForCurrentDraft();
  renderReviewBlockingSummary();
  renderReviewReadiness();
  renderValidation();
  syncSelectTitles(browserDocument);
}

function renderSetupObjectiveEditor() {
  if (!elements.setupObjectiveList || !state.draft) return;
  elements.setupObjectiveList.innerHTML = "";
  (state.draft.evaluation?.objectives || []).forEach((objective, index) => {
    const row = document.createElement("div");
    row.className = "setup-objective-row";
    row.dataset.objectiveId = objective.id;
    row.dataset.contentRecommendationSource = contentRecommendationKey("objective", objective.id);
    row.dataset.contentRecommendationLocation = "setup";
    const number = document.createElement("span");
    number.className = "setup-objective-number";
    number.textContent = String(index + 1);
    const field = document.createElement("div");
    field.className = "setup-objective-field";
    const input = document.createElement("input");
    input.type = "text";
    input.value = objective.label || "";
    input.maxLength = 240;
    input.setAttribute("aria-label", `Learning objective ${index + 1}`);
    const recommendationControls = createObjectiveRecommendationControls(
      objective.id,
      "setup",
      document
    );
    input.addEventListener("input", () => {
      state.draft = updateObjectiveLabel(state.draft, objective.id, input.value);
      commitObjectiveLabelMutation(objective.id);
      markCitationsEdited(`evaluation.objectives.${index}.label`);
      conversationPhaseEditorCoordinator?.synchronizeEvaluationControls();
      refreshSetupObjectiveErrors();
      renderReviewReadiness();
      renderReviewBlockingSummary();
    });
    field.append(input, recommendationControls);
    const removeLabel = `Remove learning objective ${index + 1}`;
    const remove = removeIconButton({
      label: removeLabel,
      onClick: () => {
        invalidateContentRecommendation("objective", objective.id, { remove: true });
        state.draft = removeObjective(state.draft, objective.id);
        state.sourceGrounding = clone(state.draft.sourceGrounding);
        setDirty();
        renderSetupObjectiveEditor();
        refreshSetupObjectiveErrors();
        renderConversationPhases();
        renderReviewReadiness();
        renderReviewBlockingSummary();
        const focusIndex = Math.min(index, (state.draft.evaluation?.objectives || []).length - 1);
        elements.setupObjectiveList.querySelectorAll("input")[focusIndex]?.focus();
      }
    });
    remove.disabled = (state.draft.evaluation?.objectives || []).length <= 1;
    row.append(number, field, remove);
    elements.setupObjectiveList.append(row);
  });
}

function refreshSetupObjectiveErrors() {
  elements.addSetupObjectiveButton.disabled = (state.draft?.evaluation?.objectives || []).length >= 12;
}

export function previewGuidanceForDraft(draft) {
  return (draft?.flow?.phases || []).map((phase, index) => ({
    id: phase.id,
    title: phase.title || `Phase ${index + 1}`,
    bullets: (phase.coachGuidance?.bullets || []).map((bullet) => ({
      text: bullet.text || "",
      children: (bullet.children || []).map((child) => ({
        text: child.text || "",
        kind: child.kind === "caution" ? "caution" : "support",
      })),
    })),
  }));
}

function renderCreateSummary() {
  if (!state.draft) return;
  elements.customerSituationInput.value = state.draft.scenario.description;
  elements.learnerApproachInput.value = [
    ...state.draft.handling.correct,
    ...state.draft.handling.avoid.map((item) => `Avoid: ${item}`)
  ].join("\n");
}

async function composeDraft() {
  const generated = composeStudioScenarios(normalizePhaseAuthoringDraft(state.draft));
  const baselineGenerated = state.loadedBaselineDraft
    ? composeStudioScenarios(state.loadedBaselineDraft)
    : null;
  state.composed = {
    ...generated,
    scenarios: composeWithCanonicalFidelity({
      draft: state.draft,
      baselineDraft: state.loadedBaselineDraft,
      canonicalScenarios: state.loadedCanonicalScenarios,
      baselineGeneratedScenarios: baselineGenerated?.scenarios || [],
      generatedScenarios: generated.scenarios
    })
  };
  state.composed.chatScenario = state.composed.scenarios
    .find((scenario) => scenario?.channels?.[0] === "chat") || null;
  state.composed.voiceScenario = state.composed.scenarios
    .find((scenario) => scenario?.channels?.[0] === "voice") || null;
  return state.composed;
}

function scenarioForChannel(channel) {
  const composed = state.composed || composeStudioScenarios(normalizePhaseAuthoringDraft(state.draft));
  return (
    composed.scenarios?.find((scenario) => scenario?.channels?.[0] === channel) ||
    composed[`${channel}Scenario`] ||
    null
  );
}

function fillSelect(select, options, selectedValue) {
  select.innerHTML = "";
  options.forEach((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    const element = document.createElement("option");
    element.value = value;
    element.textContent = label;
    element.selected = value === selectedValue;
    select.append(element);
  });
}

export function fillVoiceSelect(select, selectedValue) {
  select.innerHTML = "";
  const documentRef = select.ownerDocument || document;
  REALTIME_VOICE_GROUPS.forEach(({ label, ids }) => {
    const optgroup = documentRef.createElement("optgroup");
    optgroup.label = label;
    REALTIME_VOICE_OPTIONS
      .filter(({ id, group }) => group === label && ids.includes(id))
      .forEach(({ id, label: optionLabel }) => {
        const option = documentRef.createElement("option");
        option.value = id;
        option.textContent = optionLabel;
        option.selected = id === selectedValue;
        optgroup.append(option);
      });
    select.append(optgroup);
  });
}

async function prepareTuneStage() {
  if (!state.draft) return;
  await composeDraft();
  const channels = state.draft.scenario.channels;
  const current =
    channels.includes(elements.previewChannelSelect.value)
      ? elements.previewChannelSelect.value
      : channels[0];
  fillSelect(
    elements.previewChannelSelect,
    channels.map((channel) => ({
      value: channel,
      label: channel === "voice" ? "Voice" : "Chat"
    })),
    current
  );
  elements.previewTitle.textContent = state.draft.scenario.title;
  elements.previewDescription.textContent = state.draft.scenario.description;
  elements.previewConversationAbout.textContent = state.draft.scenario.description;
  elements.previewLearnerGoal.textContent = state.draft.scenario.learnerGoal;
  elements.playPreviewButton.textContent = "Start conversation";
  elements.noApiNotice.hidden = Boolean(state.apiBase);
  elements.playPreviewButton.disabled = !state.apiBase;
  elements.previewStatus.textContent = state.apiBase
    ? ""
    : "Not live tested. A simulator API is not configured.";
}

function setPreviewStatus(message) {
  elements.previewStatus.textContent = message;
}

function clearTranscript() {
  state.streamingTurn = null;
  state.transcriptFamily = "";
  state.completedResponseText = "";
  state.previewTurns = [];
}

function addTranscriptTurn(role, text = "") {
  const transcriptIndex = state.previewTurns.length;
  state.previewTurns.push({
    role,
    text: String(text || "")
  });
  return { copy: { textContent: String(text || "") }, transcriptIndex };
}

function appendCustomerDelta(delta, family) {
  const text = String(delta || "");
  if (!text) return;
  if (state.transcriptFamily && state.transcriptFamily !== family) return;
  state.transcriptFamily = family;
  if (!state.streamingTurn) state.streamingTurn = addTranscriptTurn("customer");
  state.streamingTurn.copy.textContent += text;
  state.previewTurns[state.streamingTurn.transcriptIndex].text =
    state.streamingTurn.copy.textContent;
}

export function isDuplicateRealtimeTranscript(previousText, nextText) {
  const previous = String(previousText || "").trim();
  const next = String(nextText || "").trim();
  if (!previous || !next) return false;
  return (
    previous === next ||
    previous.endsWith(next) ||
    next.endsWith(previous)
  );
}

export function buildReconnectTranscriptInstructions(turns = []) {
  const transcript = (Array.isArray(turns) ? turns : [])
    .filter((turn) => ["customer", "learner"].includes(turn?.role))
    .map((turn) => ({
      role: turn.role,
      text: String(turn.text || "").trim()
    }))
    .filter((turn) => turn.text)
    .slice(-16)
    .map(
      (turn) =>
        `${turn.role === "learner" ? "Learner" : "Conversation Partner"}: ${turn.text}`
    )
    .join("\n")
    .slice(-6000);
  if (!transcript) return "";
  return [
    "This authoring preview reconnected after a temporary interruption.",
    "Continue from the exact transcript below without repeating the opening or changing any conversation facts.",
    transcript
  ].join("\n");
}

function finishCustomerTurn(text = "", family = "") {
  if (family && state.transcriptFamily && state.transcriptFamily !== family) {
    return;
  }
  const finalText = String(text || "").trim();
  if (!state.streamingTurn && finalText) {
    if (isDuplicateRealtimeTranscript(state.completedResponseText, finalText)) {
      return;
    }
    state.streamingTurn = addTranscriptTurn("customer", finalText);
  } else if (state.streamingTurn && finalText && !state.streamingTurn.copy.textContent.trim()) {
    state.streamingTurn.copy.textContent = finalText;
    state.previewTurns[state.streamingTurn.transcriptIndex].text = finalText;
  }
  if (state.streamingTurn?.copy?.textContent?.trim()) {
    state.completedResponseText = state.streamingTurn.copy.textContent.trim();
  }
  state.streamingTurn = null;
  state.transcriptFamily = "";
}

export function buildRealtimeSessionUpdate({
  scenario,
  tuningOverride,
  channel,
  includeVoice = true,
  includeInputConfiguration = false
}) {
  const previewChannel = channel === "voice" ? "voice" : "chat";
  const tuning = normalizeScenarioTuning(scenario, tuningOverride);
  const session = {
    type: "realtime",
    instructions: buildAuthoringPreviewInstructions(scenario, tuning),
    output_modalities: [previewChannel === "voice" ? "audio" : "text"]
  };
  if (previewChannel === "voice") {
    session.audio = {
      ...(includeInputConfiguration
        ? {
            input: {
              turn_detection: null
            }
          }
        : {}),
      output: {
        ...(includeVoice && tuning.voice?.id ? { voice: tuning.voice.id } : {}),
        speed: tuning.voice?.speed || 1
      }
    };
  }
  return session;
}

function sendRealtimeEvent(event) {
  if (state.dataChannel?.readyState !== "open") return false;
  try {
    state.dataChannel.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

function clearResponseWatchdog() {
  if (state.responseTimer) {
    window.clearTimeout(state.responseTimer);
    state.responseTimer = 0;
  }
}

function startResponseWatchdog() {
  clearResponseWatchdog();
  const generation = state.previewGeneration;
  state.responseTimer = window.setTimeout(() => {
    if (generation !== state.previewGeneration || !state.responsePending) return;
    reconnectPreview("The Conversation Partner response timed out.", {
      resumeResponse: true
    });
  }, 30000);
}

function selectedPreviewChannel() {
  return state.activeScenario?.channels?.[0] === "voice" ? "voice" : "chat";
}

function previewButtonLabel({ restartVoice = "" } = {}) {
  if (restartVoice) {
    return `Restart with ${restartVoice[0].toUpperCase()}${restartVoice.slice(1)}`;
  }
  if (state.sessionReady) {
    return "Restart conversation";
  }
  return "Start conversation";
}

function updatePreviewButtonLabel(options = {}) {
  if (!elements.playPreviewButton) return;
  elements.playPreviewButton.textContent = previewButtonLabel(options);
}

function applyLiveTuningUpdate() {
  if (
    !state.sessionReady ||
    state.dataChannel?.readyState !== "open" ||
    !state.activeScenario
  ) {
    return false;
  }
  if (state.responsePending) {
    state.liveTuningUpdateQueued = true;
    setPreviewStatus(
      "Tuning queued. It will apply after this Conversation Partner response and affect the next one."
    );
    return false;
  }

  const channel = selectedPreviewChannel();
  const tuning = normalizeScenarioTuning(state.activeScenario, state.draft.tuning);
  const nextVoice = channel === "voice" ? tuning.voice?.id || "" : "";
  const voiceChanged =
    channel === "voice" && Boolean(state.appliedVoice) && nextVoice !== state.appliedVoice;
  state.voiceRestartRequired = voiceChanged && state.audioOutputStarted;
  const includeVoice = channel === "voice" && !state.audioOutputStarted;
  const session = buildRealtimeSessionUpdate({
    scenario: state.activeScenario,
    tuningOverride: tuning,
    channel,
    includeVoice
  });
  const sent = sendRealtimeEvent({ type: "session.update", session });
  if (!sent) return false;

  state.liveTuningUpdateQueued = false;
  if (includeVoice && nextVoice) {
    state.appliedVoice = nextVoice;
    state.voiceRestartRequired = false;
  }
  if (state.voiceRestartRequired) {
    updatePreviewButtonLabel({ restartVoice: nextVoice });
    setPreviewStatus(
      `Tuning updated for the next response. Restart the preview to switch the Conversation Partner voice to ${nextVoice}.`
    );
  } else {
    updatePreviewButtonLabel();
    setPreviewStatus(
      "Tuning updated. The next Conversation Partner response will use these settings."
    );
  }
  return true;
}

function customerStartsForPreview() {
  if (state.simulatorPreviewBinding?.channel === "chat") return false;
  return selectedPreviewChannel() === "voice"
    ? state.draft.voice.customerStarts !== false
    : state.draft.chat.customerStarts !== false;
}

function requestCustomerOpening() {
  if (state.openingQueued) return;
  state.openingQueued = true;
  state.responsePending = true;
  const opening =
    state.activeScenario?.customer?.opening?.[
      state.activeScenario?.channels?.[0] || "chat"
    ] ||
    state.activeScenario?.conversationBetween?.aiStart ||
    state.draft.scenario.openingLine;
  const sent = sendRealtimeEvent({
    type: "response.create",
    response: {
      instructions:
        `Begin the role play now. Say only this approved Conversation Partner opening in character, then stop and wait for the Learner: ${opening}`
    }
  });
  if (!sent) {
    reconnectPreview("The preview connection expired before the Conversation Partner could begin.");
    return;
  }
  startResponseWatchdog();
}

function handleRealtimeEvent(message, generation) {
  if (generation !== state.previewGeneration) return;
  const type = String(message?.type || "");
  if (type === "error") {
    const error = message.error?.message || message.message || "Realtime preview error.";
    clearResponseWatchdog();
    setPreviewStatus(error);
    state.responsePending = false;
    return;
  }
  if (type === "session.created") {
    setPreviewStatus("Applying the in-memory Studio draft…");
    return;
  }
  if (type === "session.updated") {
    state.sessionReady = true;
    state.reconnecting = false;
    updatePreviewButtonLabel(
      state.voiceRestartRequired
        ? {
            restartVoice: state.draft.tuning.voice?.id || state.draft.voice.selectedVoice
          }
        : {}
    );
    if (state.resumeSession) {
      const resumeResponse = state.resumeResponseRequired;
      const resumeInput = state.resumeInput;
      state.resumeSession = false;
      state.resumeResponseRequired = false;
      state.resumeInput = "";
      state.openingQueued = true;
      elements.learnerMessage.value = resumeInput;
      if (resumeResponse) {
        state.responsePending = true;
        setPreviewStatus("Preview reconnected. Conversation Partner responding…");
        const sent = sendRealtimeEvent({
          type: "response.create",
          response: {
            instructions:
              "Continue the role play by responding only to the learner's latest message in the restored transcript. Do not repeat the opening."
          }
        });
        if (!sent) {
          reconnectPreview("The restored preview could not request a response.", {
            resumeResponse: true
          });
          return;
        }
        startResponseWatchdog();
      } else {
        state.responsePending = false;
        setPreviewStatus(
          "Preview reconnected with the conversation preserved. Continue when ready."
        );
      }
      return;
    }
    if (customerStartsForPreview()) {
      requestCustomerOpening();
    } else {
      state.openingQueued = true;
      state.responsePending = false;
      setPreviewStatus("Conversation ready. Send the learner's opening message.");
    }
    return;
  }
  if (type === "response.created") {
    state.responsePending = true;
    state.completedResponseText = "";
    startResponseWatchdog();
    setPreviewStatus("Conversation Partner responding…");
    return;
  }
  if (type === "response.output_text.delta") {
    startResponseWatchdog();
    appendCustomerDelta(message.delta, "text");
    return;
  }
  if (type === "response.output_text.done") {
    finishCustomerTurn(message.text, "text");
    return;
  }
  if (
    type === "response.output_audio_transcript.delta" ||
    type === "response.audio_transcript.delta"
  ) {
    state.audioOutputStarted = true;
    startResponseWatchdog();
    appendCustomerDelta(
      message.delta,
      type === "response.output_audio_transcript.delta"
        ? "output_audio"
        : "audio"
    );
    return;
  }
  if (
    type === "response.output_audio_transcript.done" ||
    type === "response.audio_transcript.done"
  ) {
    state.audioOutputStarted = true;
    finishCustomerTurn(
      message.transcript || message.text,
      type === "response.output_audio_transcript.done"
        ? "output_audio"
        : "audio"
    );
    return;
  }
  if (type === "response.done" || type === "response.completed") {
    clearResponseWatchdog();
    state.automaticReconnectUsed = false;
    if (selectedPreviewChannel() === "voice") {
      state.audioOutputStarted = true;
    }
    finishCustomerTurn();
    const partnerText = String(state.completedResponseText || "").trim();
    if (partnerText && state.simulatorPreviewBinding?.channel === "chat") {
      elements.simulatorPreviewFrame?.contentWindow?.postMessage({
        type: "ccs:builder-partner-turn",
        version: 1,
        channel: "chat",
        scenarioId: state.simulatorPreviewBinding.scenarioId,
        previewCapability: state.simulatorPreviewBinding.previewCapability,
        role: "partner",
        text: partnerText
      }, window.location.origin);
    }
    state.responsePending = false;
    setPreviewStatus("Conversation ready for the next learner response.");
    if (state.liveTuningUpdateQueued) {
      applyLiveTuningUpdate();
    }
  }
}

async function getRealtimeSecret() {
  if (!state.apiBase) {
    throw new Error("A simulator API is not configured for live preview.");
  }
  const scenarios = Array.isArray(state.composed?.scenarios)
    ? state.composed.scenarios
    : [];
  if (!scenarios.length) {
    throw new Error("The current conversation could not be prepared for live practice.");
  }
  state.publishOperationId ||= crypto.randomUUID();
  const draftFingerprint = materialDraftFingerprint(state.draft);
  const session = await requestJson("/api/builder/preview-session", {
    method: "POST",
    body: JSON.stringify({
      deidentificationConfirmed: state.draft?.source?.anonymized === true,
      expectedPublicationId: state.loadMode === "editable"
        ? state.expectedBasePublicationId
        : null,
      operationId: state.publishOperationId,
      draft: normalizePhaseAuthoringDraft(state.draft),
      channel: selectedPreviewChannel(),
      scenarios
    })
  });
  const secret = session?.client_secret?.value || session?.value || "";
  if (!secret) throw new Error("The simulator did not return a live preview token.");
  const preview = session?.preview || {};
  if (
    preview.scenarioId !== state.activeScenario?.id ||
    preview.channel !== selectedPreviewChannel() ||
    !preview.sessionReference
  ) {
    throw new Error("The simulator preview was not bound to the current conversation draft.");
  }
  state.previewSessionReference = preview.sessionReference;
  state.previewDraftFingerprint = draftFingerprint;
  return secret;
}

export function clearActivePreviewBinding(previewState = state) {
  previewState.previewSessionReference = "";
  previewState.previewDraftFingerprint = "";
  previewState.simulatorPreviewBinding = null;
  previewState.simulatorPreviewBootstrap = null;
  return previewState;
}

function closePreview(message = "Preview ended.") {
  state.previewGeneration += 1;
  clearResponseWatchdog();
  if (state.reconnectTimer) {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
  }
  state.sessionReady = false;
  state.responsePending = false;
  state.openingQueued = false;
  state.audioOutputStarted = false;
  state.appliedVoice = "";
  state.liveTuningUpdateQueued = false;
  state.voiceRestartRequired = false;
  state.streamingTurn = null;
  state.transcriptFamily = "";
  state.completedResponseText = "";
  clearActivePreviewBinding(state);
  if (state.dataChannel) {
    try {
      state.dataChannel.close();
    } catch {
      // The channel may already be closed.
    }
  }
  if (state.peerConnection) {
    try {
      state.peerConnection.close();
    } catch {
      // The connection may already be closed.
    }
  }
  state.dataChannel = null;
  state.peerConnection = null;
  if (elements.customerAudio) elements.customerAudio.srcObject = null;
  if (elements.learnerMessage) elements.learnerMessage.disabled = true;
  if (elements.sendLearnerButton) elements.sendLearnerButton.disabled = true;
  if (elements.simulatorPreviewFrame) {
    elements.simulatorPreviewFrame.removeAttribute("src");
    elements.simulatorPreviewFrame.style.height = "";
  }
  updatePreviewButtonLabel();
  if (message) setPreviewStatus(message);
}

function reconnectPreview(reason, options = {}) {
  if (state.reconnecting) return;
  let resumeResponse =
    options.resumeResponse === undefined
      ? state.responsePending
      : Boolean(options.resumeResponse);
  const resumeInput = elements.learnerMessage.value;
  if (resumeResponse && state.completedResponseText) {
    resumeResponse = false;
  } else if (resumeResponse && state.streamingTurn) {
    const { transcriptIndex, turn } = state.streamingTurn;
    turn.remove();
    state.previewTurns.splice(transcriptIndex, 1);
    state.streamingTurn = null;
    state.transcriptFamily = "";
  }
  if (state.automaticReconnectUsed) {
    closePreview(
      `${reason} Automatic reconnect was unsuccessful. Select Start conversation to try again.`
    );
    elements.learnerMessage.value = resumeInput;
    return;
  }
  state.automaticReconnectUsed = true;
  state.reconnecting = true;
  closePreview("");
  elements.learnerMessage.value = resumeInput;
  setPreviewStatus(`${reason} Reconnecting automatically…`);
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = 0;
    void startPreview({
      automatic: true,
      preserveTranscript: true,
      resumeResponseRequired: resumeResponse,
      resumeInput
    });
  }, 250);
}

function appendPreviewEvidenceTurn(role, text) {
  const normalizedRole = role === "learner" ? "learner" : "customer";
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return;
  const previous = state.previewTurns.at(-1);
  if (previous?.role === normalizedRole && previous.text === normalizedText) return;
  state.previewTurns.push({ role: normalizedRole, text: normalizedText });
}

export function orderedPreviewTurns(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => ({
      role: turn?.role === "learner"
        ? "learner"
        : (["customer", "partner"].includes(turn?.role) ? "partner" : ""),
      text: String(turn?.text || "").trim()
    }))
    .filter((turn) => turn.role && turn.text);
}

export function buildPreviewEvaluationMessage(result = {}, binding = {}) {
  const base = {
    type: "ccs:builder-evaluation",
    version: 1,
    channel: binding.channel,
    scenarioId: binding.scenarioId,
    previewCapability: binding.previewCapability
  };
  if (result.unavailable === true) {
    return {
      ...base,
      unavailable: true,
      message: String(result.message || "Feedback is unavailable.").trim()
    };
  }
  if (
    result.channel !== binding.channel ||
    result.scenarioId !== binding.scenarioId ||
    !result.evaluation ||
    typeof result.evaluation !== "object" ||
    Array.isArray(result.evaluation)
  ) {
    throw new Error("The evaluation was not bound to the active preview.");
  }
  return { ...base, evaluation: result.evaluation };
}

function postPreviewEvaluation(result, binding = state.simulatorPreviewBinding) {
  const activeBinding = state.simulatorPreviewBinding;
  const frameWindow = elements.simulatorPreviewFrame?.contentWindow;
  if (
    !frameWindow ||
    !isCurrentSimulatorPreviewAttempt(binding, activeBinding)
  ) return false;
  frameWindow.postMessage(
    buildPreviewEvaluationMessage(result, binding),
    window.location.origin
  );
  return true;
}

export async function requestPreviewEvaluation(dependencies = {}) {
  const previewState = dependencies.state || state;
  const binding = dependencies.binding || previewState.simulatorPreviewBinding;
  const previewCapability = dependencies.previewCapability || previewState.previewSessionReference;
  const request = dependencies.request || requestJson;
  const postEvaluation = dependencies.postEvaluation || postPreviewEvaluation;
  const setStatus = dependencies.setStatus || setPreviewStatus;
  if (!binding || !previewCapability) return false;
  const transcript = orderedPreviewTurns(dependencies.previewTurns || previewState.previewTurns);
  if (!transcript.some((turn) => turn.role === "learner")) {
    setStatus("No Learner response to evaluate.");
    postEvaluation({
      unavailable: true,
      message: "No Learner response to evaluate."
    }, binding);
    return false;
  }
  setStatus("Coach Chewy is reviewing the conversation…");
  try {
    const result = await request("/api/builder/preview-evaluate", {
      method: "POST",
      body: JSON.stringify({
        operationId: dependencies.operationId || previewState.publishOperationId,
        previewCapability,
        draft: normalizePhaseAuthoringDraft(dependencies.draft || previewState.draft),
        channel: binding.channel,
        scenarios: dependencies.scenarios || previewState.composed?.scenarios || [],
        transcript
      })
    });
    const posted = postEvaluation(result, binding);
    if (posted) setStatus("Test complete.");
    return posted;
  } catch {
    postEvaluation({
      unavailable: true,
      message: "Feedback is unavailable. Restart the test and try again."
    }, binding);
    setStatus("We couldn't complete the evaluation. Try again.");
    return false;
  }
}

function recordSuccessfulPreviewTest(previewState, dependencies = {}) {
  const binding = dependencies.binding || previewState.simulatorPreviewBinding;
  const activeBinding = previewState.simulatorPreviewBinding;
  const previewCapability = dependencies.previewCapability || previewState.previewSessionReference;
  const transcript = orderedPreviewTurns(previewState.previewTurns);
  if (
    !isCurrentSimulatorPreviewAttempt(binding, activeBinding) ||
    previewCapability !== previewState.previewSessionReference ||
    !hasCompletedPreviewExchange(transcript) ||
    !isCurrentMaterialDraftFingerprint(previewState.draft, previewState.previewDraftFingerprint)
  ) return false;
  previewState.successfulTestDraftFingerprint = previewState.previewDraftFingerprint;
  previewState.testVisited = true;
  return true;
}

export async function finishSimulatorPreview(dependencies = {}) {
  const evaluated = await requestPreviewEvaluation(dependencies);
  if (evaluated) {
    recordSuccessfulPreviewTest(dependencies.state || state, dependencies);
  }
  return evaluated;
}

export function isCurrentSimulatorPreviewAttempt(
  binding,
  activeBinding = state.simulatorPreviewBinding
) {
  return Boolean(
    binding &&
    activeBinding &&
    binding.channel === activeBinding.channel &&
    binding.scenarioId === activeBinding.scenarioId &&
    binding.previewCapability === activeBinding.previewCapability
  );
}

export async function restartSimulatorPreviewAttempt(binding, dependencies = {}) {
  const currentBinding = dependencies.currentBinding || (() => state.simulatorPreviewBinding);
  const invalidate = dependencies.invalidate || (() => closePreview(""));
  const clearTurns = dependencies.clearTurns || clearTranscript;
  const start = dependencies.start || ((options) => startSimulatorPreview(options));
  if (!isCurrentSimulatorPreviewAttempt(binding, currentBinding())) return null;

  invalidate();
  clearTurns();
  const nextBinding = await start({ channel: binding.channel, resetAttempt: false });
  if (
    !nextBinding ||
    nextBinding.channel !== binding.channel ||
    nextBinding.scenarioId !== binding.scenarioId ||
    !nextBinding.previewCapability ||
    nextBinding.previewCapability === binding.previewCapability
  ) return null;
  return nextBinding;
}

function postSimulatorPreviewBootstrap() {
  const frameWindow = elements.simulatorPreviewFrame?.contentWindow;
  if (!frameWindow || !state.simulatorPreviewBootstrap) return;
  frameWindow.postMessage(state.simulatorPreviewBootstrap, window.location.origin);
}

export function handleSimulatorPreviewMessage(event, dependencies = {}) {
  const binding = dependencies.binding || state.simulatorPreviewBinding;
  const frameWindow = dependencies.frameWindow || elements.simulatorPreviewFrame?.contentWindow;
  const origin = dependencies.origin || window.location.origin;
  if (!binding || !frameWindow) return;
  const message = readBuilderPreviewEvent(event, {
    origin,
    source: frameWindow,
    channel: binding.channel,
    scenarioId: binding.scenarioId,
    previewCapability: binding.previewCapability
  });
  if (!message) return;
  if (message.type === "ccs:builder-ready") {
    postSimulatorPreviewBootstrap();
    return;
  }
  if (message.type === "ccs:builder-resize") {
    elements.simulatorPreviewFrame.style.height = `${Math.max(420, Math.min(2400, Math.round(message.height)))}px`;
    return;
  }
  if (message.type === "ccs:builder-learner-turn" && binding.channel === "chat") {
    if (!state.sessionReady || state.responsePending) return;
    state.responsePending = true;
    setPreviewStatus("Conversation Partner responding…");
    const itemSent = sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message.text }]
      }
    });
    if (!itemSent || !sendRealtimeEvent({ type: "response.create" })) {
      state.responsePending = false;
      setPreviewStatus("The Conversation Partner could not respond. Restart the test and try again.");
    }
    return;
  }
  if (message.type === "ccs:builder-transcript-turn") {
    appendPreviewEvidenceTurn(message.role, message.text);
    return;
  }
  if (message.type === "ccs:builder-ended") {
    return finishSimulatorPreview(dependencies.finishDependencies);
  }
  if (message.type === "ccs:builder-restart") {
    void restartSimulatorPreviewAttempt(binding);
  }
}

async function connectChatPreview(secret, generation) {
  const peerConnection = new RTCPeerConnection();
  state.peerConnection = peerConnection;
  peerConnection.addTransceiver("audio", { direction: "recvonly" });
  const dataChannel = peerConnection.createDataChannel("oai-events");
  state.dataChannel = dataChannel;
  dataChannel.onmessage = (event) => {
    if (generation !== state.previewGeneration) return;
    try {
      handleRealtimeEvent(JSON.parse(event.data), generation);
    } catch {
      // Ignore non-JSON Realtime events.
    }
  };
  dataChannel.onopen = () => {
    if (generation !== state.previewGeneration) return;
    const session = buildRealtimeSessionUpdate({
      scenario: state.activeScenario,
      tuningOverride: normalizeScenarioTuning(state.activeScenario, state.draft.tuning),
      channel: "chat",
      includeVoice: false,
      includeInputConfiguration: false
    });
    sendRealtimeEvent({ type: "session.update", session });
  };
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/sdp",
      Accept: "application/sdp"
    },
    body: offer.sdp
  });
  if (!response.ok) throw new Error(`Realtime connection failed (${response.status}).`);
  const answer = await response.text();
  if (generation !== state.previewGeneration) return;
  await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
}

async function startSimulatorPreview(options = {}) {
  const resetAttempt = options.resetAttempt !== false;
  if (resetAttempt) {
    closePreview("");
    clearTranscript();
  }
  await composeDraft();
  const channel = options.channel || elements.previewChannelSelect.value;
  state.activeScenario = scenarioForChannel(channel);
  if (!state.activeScenario) {
    setPreviewStatus(`No ${channel} conversation could be composed.`);
    return;
  }
  const generation = state.previewGeneration;
  elements.playPreviewButton.disabled = true;
  setPreviewStatus("Loading the learner simulator…");
  try {
    const secret = await getRealtimeSecret();
    const previewCapability = state.previewSessionReference;
    state.simulatorPreviewBinding = {
      channel,
      scenarioId: state.activeScenario.id,
      previewCapability
    };
    state.simulatorPreviewBootstrap = createPreviewBootstrap({
      channel,
      scenario: state.activeScenario,
      clientSecret: secret,
      previewCapability,
      operationId: state.publishOperationId
    });
    if (channel === "chat") await connectChatPreview(secret, generation);
    if (generation !== state.previewGeneration) return;
    const path = channel === "voice" ? "/voice-engine.html" : "/chat-engine.html";
    const query = new URLSearchParams({
      scenarioId: state.activeScenario.id,
      embedded: "1",
      builderPreview: "1",
      previewCapability
    });
    elements.simulatorPreviewFrame.src = `${path}?${query}`;
    state.sessionReady = channel === "voice";
    updatePreviewButtonLabel();
    setPreviewStatus("Use the learner simulator below to test this conversation.");
    return state.simulatorPreviewBinding;
  } catch (error) {
    closePreview(String(error?.message || error));
    return null;
  } finally {
    elements.playPreviewButton.disabled = !state.apiBase;
  }
}

async function startPreview(options = {}) {
  if (elements.simulatorPreviewFrame) return startSimulatorPreview(options);
  const automatic = Boolean(options?.automatic);
  const preserveTranscript = Boolean(options?.preserveTranscript);
  const resumeResponseRequired = Boolean(options?.resumeResponseRequired);
  const resumeInput = String(
    options?.resumeInput ?? elements.learnerMessage.value ?? ""
  );
  if (!automatic) {
    state.automaticReconnectUsed = false;
    state.reconnecting = false;
  }
  closePreview("");
  if (!preserveTranscript) clearTranscript();
  state.resumeSession = preserveTranscript && state.previewTurns.length > 0;
  state.resumeResponseRequired =
    state.resumeSession && resumeResponseRequired;
  state.resumeInput = preserveTranscript ? resumeInput : "";
  await composeDraft();
  const channel = elements.previewChannelSelect.value;
  state.activeScenario = scenarioForChannel(channel);
  if (!state.activeScenario) {
    setPreviewStatus(`No ${channel} conversation could be composed.`);
    return;
  }
  const generation = state.previewGeneration;
  elements.playPreviewButton.disabled = true;
  setPreviewStatus(
    automatic ? "Reconnecting the conversation…" : "Starting the conversation…"
  );
  try {
    const secret = await getRealtimeSecret();
    const peerConnection = new RTCPeerConnection();
    state.peerConnection = peerConnection;
    peerConnection.addTransceiver("audio", { direction: "recvonly" });
    if (channel === "voice") {
      peerConnection.ontrack = (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        elements.customerAudio.srcObject = stream;
        elements.customerAudio.play().catch(() => {
          setPreviewStatus("Your browser blocked audio. Select Start conversation again.");
        });
      };
    }
    peerConnection.onconnectionstatechange = () => {
      if (generation !== state.previewGeneration) return;
      if (peerConnection.connectionState === "failed") {
        if (state.reconnecting) {
          state.reconnecting = false;
          closePreview(
            `The conversation connection ${peerConnection.connectionState}. Automatic reconnect was unsuccessful. Select Start conversation to try again.`
          );
        } else {
          reconnectPreview(`Preview connection ${peerConnection.connectionState}.`);
        }
        return;
      }
      if (peerConnection.connectionState === "disconnected") {
        setPreviewStatus(
          state.responsePending
            ? "Preview connection interrupted. Waiting for the Conversation Partner response…"
            : "Preview connection interrupted. You can try sending; Studio will reconnect if needed."
        );
        return;
      }
      if (peerConnection.connectionState === "connected") {
        if (state.sessionReady) {
          setPreviewStatus(
            state.responsePending
              ? "Conversation Partner responding…"
              : "Conversation ready for the next learner response."
          );
        }
      }
    };
    const dataChannel = peerConnection.createDataChannel("oai-events");
    state.dataChannel = dataChannel;
    dataChannel.onmessage = (event) => {
      try {
        handleRealtimeEvent(JSON.parse(event.data), generation);
      } catch {
        // Ignore non-JSON Realtime events.
      }
    };
    dataChannel.onopen = () => {
      if (generation !== state.previewGeneration) return;
      const tuning = normalizeScenarioTuning(state.activeScenario, state.draft.tuning);
      const session = buildRealtimeSessionUpdate({
        scenario: state.activeScenario,
        tuningOverride: tuning,
        channel,
        includeVoice: true,
        includeInputConfiguration: true
      });
      if (state.resumeSession) {
        const reconnectInstructions = buildReconnectTranscriptInstructions(
          state.previewTurns
        );
        if (reconnectInstructions) {
          session.instructions = `${session.instructions}\n\n${reconnectInstructions}`;
        }
      }
      state.appliedVoice = channel === "voice" ? tuning.voice?.id || "" : "";
      if (!sendRealtimeEvent({ type: "session.update", session })) {
        if (state.reconnecting) {
          state.reconnecting = false;
          closePreview(
            "The conversation connection expired during setup. Automatic reconnect was unsuccessful. Select Start conversation to try again."
          );
        } else {
          reconnectPreview("The preview connection expired during setup.");
        }
      }
    };
    dataChannel.onerror = () => {
      if (generation !== state.previewGeneration) return;
      if (state.reconnecting) {
        state.reconnecting = false;
        closePreview(
          "The conversation connection encountered an error. Automatic reconnect was unsuccessful. Select Start conversation to try again."
        );
      } else {
        reconnectPreview("The preview connection encountered an error.");
      }
    };
    dataChannel.onclose = () => {
      if (generation !== state.previewGeneration) return;
      if (state.reconnecting) {
        state.reconnecting = false;
        closePreview(
          "The conversation connection expired. Automatic reconnect was unsuccessful. Select Start conversation to try again."
        );
      } else {
        reconnectPreview("The preview connection expired.");
      }
    };
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/sdp",
        Accept: "application/sdp"
      },
      body: offer.sdp
    });
    if (!response.ok) {
      throw new Error(`Realtime connection failed (${response.status}).`);
    }
    const answer = await response.text();
    if (generation !== state.previewGeneration) return;
    await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (error) {
    state.reconnecting = false;
    const message = String(error?.message || error);
    closePreview(
      automatic
        ? `${message} Automatic reconnect was unsuccessful. Select Start conversation to try again.`
        : message
    );
  } finally {
    elements.playPreviewButton.disabled = !state.apiBase;
  }
}

function containsHighConfidencePersonalInformation(text) {
  const candidate = String(text || "")
    .replace(/(^|[^A-Z0-9._%+-])rx@chewy\.com(?![A-Z0-9._%+-])/gi, "$1");
  return [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
    /\b\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){1,6}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i,
    /\b(?:order|account|case|ticket|rx|prescription)(?:\s+(?:id|number|no\.?|#))?\s*[:#-]?\s*(?=[A-Z0-9-]{6,}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,}\b/i,
    /\b(?:\d[ -]*?){13,19}\b/
  ].some((pattern) => pattern.test(candidate));
}

function sendLearnerMessage(event) {
  event.preventDefault();
  const text = elements.learnerMessage.value.trim();
  if (!text || !state.sessionReady || state.responsePending) return;
  if (containsHighConfidencePersonalInformation(text)) {
    setPreviewStatus("Remove personal or sensitive information before sending this preview message.");
    return;
  }
  state.responsePending = true;
  setPreviewStatus("Conversation Partner preparing a response…");
  const itemSent = sendRealtimeEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  });
  const responseSent =
    itemSent && sendRealtimeEvent({ type: "response.create" });
  if (!responseSent) {
    state.responsePending = false;
    reconnectPreview(
      "The preview connection expired before your message was sent. Your response is still in the box.",
      { resumeResponse: false }
    );
    return;
  }
  addTranscriptTurn("learner", text);
  elements.learnerMessage.value = "";
  startResponseWatchdog();
}

function reviewSectionForIssue(issue) {
  const normalized = [
    issue?.reviewSection,
    issue?.section,
    issue?.fieldPath,
    issue?.path,
    issue?.code,
    issue?.message
  ].filter(Boolean).join(" ").toLowerCase();
  if (
    normalized.includes("handling") ||
    normalized.includes("correct") ||
    normalized.includes("guide") ||
    normalized.includes("guidance") ||
    normalized.includes("coach") ||
    normalized.includes("flow") ||
    normalized.includes("phase")
  ) return "flow";
  if (normalized.includes("evaluation") || normalized.includes("coaching")) return "flow";
  if (normalized.includes("voice") || normalized.includes("chat") || normalized.includes("hotkey")) {
    return "practice";
  }
  return "setup";
}

function openReviewSection(section) {
  const ids = {
    setup: "reviewConversationSetup",
    partner: "reviewPartner",
    flow: "reviewConversationFlow",
    evaluation: "reviewConversationFlow",
    advanced: "reviewPractice",
    practice: "reviewPractice"
  };
  const targetId = ids[section] || ids.setup;
  const target = document.getElementById(targetId);
  if (target instanceof HTMLDetailsElement) target.open = true;
  return focusReviewSection(targetId) || target;
}

const SOURCE_SELECTION_VALIDATION_MESSAGE =
  "Review mapped source passages and reconfirm every edited grounded field before validating.";

function canonicalPhaseCreatorPathMatches(value, fieldPattern) {
  const match = String(value || "").match(/^flow\.phases\.([^.]+)\.(.+)$/);
  return canonicalCreatorPhaseIndex(match?.[1]) !== null && fieldPattern.test(match?.[2] || "");
}

function coherentEvaluationCreatorPath(value) {
  const path = String(value || "");
  return /^evaluation(?:\.|$)/.test(path) ||
    canonicalPhaseCreatorPathMatches(path, /^evaluationlinks(?:\.|$)/);
}

const FINAL_CHECK_MESSAGE_RULES = [
  {
    code: "source_grounding_review",
    message: SOURCE_SELECTION_VALIDATION_MESSAGE,
    matches: ({ code, creatorPath }) =>
      code === "source_grounding_review" && creatorPath === "sourcegrounding"
  },
  {
    code: "structured_guidance",
    message: "Review this Coach Chewy guidance image.",
    matches: ({ sourcePath, creatorPath }) =>
      /(?:^|\.)systemreference(?:\.|$)/.test(sourcePath) &&
      canonicalPhaseCreatorPathMatches(creatorPath, /^coachguidance(?:\.|$)/)
  },
  {
    code: "structured_guidance",
    message: "Review this Coach Chewy guidance point.",
    matches: ({ code, creatorPath }) =>
      ["structured_coach_chewy_bullet", "structured_guidance", "structured_guidance_child"]
        .includes(code) &&
      canonicalPhaseCreatorPathMatches(creatorPath, /^coachguidance(?:\.|$)/)
  },
  {
    code: "objective_not_phase",
    message: "Connect this learning objective to at least one conversation phase.",
    matches: ({ code, creatorPath }) =>
      (code === "objective_not_phase" ||
        canonicalPhaseCreatorPathMatches(creatorPath, /^evaluationlinks(?:\.|$)/)) &&
      coherentEvaluationCreatorPath(creatorPath)
  },
  {
    code: "grading_mismatch",
    message: "Chat and Voice must use the same learning objectives and criteria.",
    matches: ({ code, creatorPath }) =>
      code === "grading_mismatch" && coherentEvaluationCreatorPath(creatorPath)
  }
];

function finalCheckMessageRule(issue, { reviewFieldPath, reviewSection } = {}) {
  const context = {
    code: String(issue?.code || "").trim().toLowerCase(),
    sourcePath: normalizedIssuePath(issue).toLowerCase(),
    creatorPath: String(reviewFieldPath || "").trim().toLowerCase(),
    reviewSection
  };
  return FINAL_CHECK_MESSAGE_RULES.find(({ matches }) => matches(context));
}

function finalCheckSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedIssuePath(issue) {
  return String(issue?.path || issue?.fieldPath || "")
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^scenarios?\.\d+\./i, "");
}

function creatorFieldPathForIssue(issue, reviewSection, draft = null) {
  const path = normalizedIssuePath(issue);
  let standaloneMatch = path.match(/^draft\.objectives\.(\d+)\.criteria\.(\d+)(?:\.|$)/i);
  if (standaloneMatch) {
    return `evaluation.objectives.${standaloneMatch[1]}.criteria.${standaloneMatch[2]}.text`;
  }
  standaloneMatch = path.match(/^draft\.objectives\.(\d+)\.(label|description)$/i);
  if (standaloneMatch) return `evaluation.objectives.${standaloneMatch[1]}.${standaloneMatch[2]}`;
  if (/^draft\.objectives(?:\.|$)/i.test(path)) return "evaluation.objectives";
  standaloneMatch = path.match(/^draft\.phases\.(\d+)\.chatAdvanceRequirements(?:\.(.*))?$/i);
  if (standaloneMatch) {
    return `flow.phases.${standaloneMatch[1]}.chatAdvanceRequirements${standaloneMatch[2] ? `.${standaloneMatch[2]}` : ""}`;
  }
  standaloneMatch = path.match(/^draft\.phases\.(\d+)\.(title|id)$/i);
  if (standaloneMatch) return `flow.phases.${standaloneMatch[1]}.${standaloneMatch[2]}`;
  standaloneMatch = path.match(/^draft\.phases\.(\d+)\.learnerActions(?:\.|$)/i);
  if (standaloneMatch) return `flow.phases.${standaloneMatch[1]}.strongLearnerResponse`;
  standaloneMatch = path.match(/^draft\.phases\.(\d+)\.coachGuidance(?:\.(\d+))?/i);
  if (standaloneMatch) {
    return `flow.phases.${standaloneMatch[1]}.coachGuidance.bullets.${standaloneMatch[2] || 0}.text`;
  }
  standaloneMatch = path.match(/^draft\.phases\.(\d+)\.partnerResponse$/i);
  if (standaloneMatch) {
    const responseIndex = Number(standaloneMatch[1]);
    const phaseCount = Array.isArray(draft?.flow?.phases) ? draft.flow.phases.length : null;
    return phaseCount !== null && responseIndex + 1 >= phaseCount
      ? "flow.closingPartnerTurn"
      : `flow.phases.${responseIndex + 1}.partnerTurn`;
  }
  if (/^draft\.title$/i.test(path)) return "scenario.title";
  if (/^draft\.learnerGoal$/i.test(path)) return "scenario.learnerGoal";
  if (/^draft\.channels(?:\.|$)/i.test(path)) return "scenario.channels";
  if (/^draft\.customer\.openingLine$/i.test(path)) return "flow.phases.0.partnerTurn";
  if (/^draft\.customer\.name$/i.test(path)) return "partner.name";
  if (/^draft\.customer\.tone$/i.test(path)) return "partner.mood";
  if (/^draft\.customer\.goal$/i.test(path)) return "partner.personality";
  standaloneMatch = path.match(/^draft\.correctProcess\.(\d+)/i);
  if (standaloneMatch) return `flow.phases.${standaloneMatch[1]}.strongLearnerResponse`;
  if (/^draft\.chat(?:\.|$)/i.test(path)) return path.replace(/^draft\.chat/i, "chatconfig");
  if (/^draft\.voice(?:\.|$)/i.test(path)) return path.replace(/^draft\.voice/i, "voiceconfig");
  if (/^catalog\.title$/i.test(path)) return "scenario.title";
  if (/^(?:scenario\.)?channels(?:\.\d+)?$/i.test(path)) return "scenario.channels";
  if (/^frontend\.chat\.initialTranscript(?:\.|$)/i.test(path)) {
    return "flow.phases.0.partnerTurn";
  }
  let match = path.match(
    /^frontend\.(?:chat|voice|shared)\.guideSections\.(\d+)\.bullets\.(\d+)\.children\.(\d+)(?:\.(kind))?/i
  );
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null
      ? path
      : `flow.phases.${phaseIndex}.coachGuidance.bullets.${match[2]}.children.${match[3]}.${match[4] || "text"}`;
  }
  match = path.match(
    /^frontend\.(?:chat|voice|shared)\.guideSections\.(\d+)\.bullets\.(\d+)/i
  );
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null
      ? path
      : `flow.phases.${phaseIndex}.coachGuidance.bullets.${match[2]}.text`;
  }
  match = path.match(/^frontend\.(?:chat|voice|shared)\.guideSections(?:\.(\d+))?(?:\.|$)/i);
  if (match) {
    const phaseIndex = match[1] === undefined ? 0 : canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null ? path : `flow.phases.${phaseIndex}.coachGuidance`;
  }
  match = path.match(/^guidance\.sections\.(\d+)\.bullets\.(\d+)\.children\.(\d+)(?:\.(kind))?/i);
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null
      ? path
      : `flow.phases.${phaseIndex}.coachGuidance.bullets.${match[2]}.children.${match[3]}.${match[4] || "text"}`;
  }
  match = path.match(/^guidance\.sections\.(\d+)\.bullets\.(\d+)/i);
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null
      ? path
      : `flow.phases.${phaseIndex}.coachGuidance.bullets.${match[2]}.text`;
  }
  match = path.match(/^guidance\.sections\.(\d+)/i);
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null ? path : `flow.phases.${phaseIndex}.coachGuidance`;
  }
  match = path.match(/^handling\.correct\.(\d+)/i);
  if (match) {
    const phaseIndex = canonicalCreatorPhaseIndex(match[1]);
    return phaseIndex === null ? path : `flow.phases.${phaseIndex}.strongLearnerResponse`;
  }
  match = path.match(/^handling\.customerResponses\.(\d+)/i);
  if (match) {
    const responseIndex = canonicalCreatorPhaseIndex(match[1]);
    const phaseIndex = responseIndex === null ? null : responseIndex + 1;
    return phaseIndex === null || phaseIndex > 11
      ? path
      : `flow.phases.${phaseIndex}.partnerTurn`;
  }
  if (/^scenario\.openingLine$/i.test(path)) return "flow.phases.0.partnerTurn";
  if (/^frontend\.shared\.learnerBriefing/i.test(path)) return "scenario.learnerGoal";
  if (/^coaching\.gradingModel\.passingScore$/i.test(path)) {
    return "evaluation.passingScore";
  }
  match = path.match(/^coaching\.gradingModel\.objectives(?:\.(\d+))?(?:\.(.*))?$/i);
  if (match) {
    if (match[1] === undefined) return "evaluation.objectives";
    const suffix = String(match[2] || "");
    const criterionMatch = suffix.match(/^criteria\.(\d+)(?:\.(.*))?$/i);
    if (criterionMatch) {
      return `evaluation.objectives.${match[1]}.criteria.${criterionMatch[1]}.${criterionMatch[2] || "text"}`;
    }
    return `evaluation.objectives.${match[1]}${suffix ? `.${suffix}` : ""}`;
  }
  if (/^evaluationCriteria/i.test(path)) return "evaluation";
  if (path) return path;
  return String(issue?.reviewSection || issue?.section || reviewSection || "setup").toLowerCase();
}

function normalizedFinalCheckMessageIdentity(issue) {
  return [issue?.message, issue?.detail, issue?.text]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase().replace(/\s+/g, " "))
    .join("\u001f");
}

function reviewSectionForCreatorFieldPath(value) {
  const path = String(value || "").trim().toLowerCase();
  if (path === "evaluation.objectives") return "setup";
  if (path === "evaluation.passingscore" || path === "scenario.channels") return "practice";
  if (/^(?:flow|evaluation)(?:\.|$)/.test(path)) return "flow";
  if (/^sourcegrounding(?:\.|$)/.test(path)) return "practice";
  if (/^(?:practice|advanced|frontend\.(?:chat|voice)|chatconfig|voiceconfig)(?:\.|$)/.test(path)) {
    return "practice";
  }
  return "setup";
}

function finalCheckCreatorAction(reviewFieldPath, reviewSection) {
  const path = String(reviewFieldPath || "").trim().toLowerCase();
  if (path === "flow.closingpartnerturn") {
    return {
      message: "Add the Conversation Partner's final response.",
      actionLabel: "Edit final response",
    };
  }
  const phaseMatch = path.match(/^flow\.phases\.([^.]+)\.(.+)$/);
  const phaseIndex = canonicalCreatorPhaseIndex(phaseMatch?.[1]);
  const phaseNumber = phaseIndex === null ? null : phaseIndex + 1;
  if (phaseNumber) {
    const field = phaseMatch[2];
    const actionLabel = `Edit phase ${phaseNumber}`;
    if (/^(?:id|title)$/.test(field)) {
      return { message: `Add a title for Phase ${phaseNumber}.`, actionLabel };
    }
    if (field === "partnerturn") {
      return {
        message: `Add what the Conversation Partner says in Phase ${phaseNumber}.`,
        actionLabel,
      };
    }
    if (field === "coachguidance") {
      return {
        message: `Add at least one Coach Chewy guidance point in Phase ${phaseNumber}.`,
        actionLabel,
      };
    }
    if (field.startsWith("coachguidance.")) {
      return { message: `Review Coach Chewy guidance in Phase ${phaseNumber}.`, actionLabel };
    }
    if (field === "stronglearnerresponse") {
      return {
        message: `Add an example of a strong Learner response in Phase ${phaseNumber}.`,
        actionLabel,
      };
    }
    if (/^chatadvancerequirements(?:\.|$)/.test(field)) {
      return {
        message: `Add the required Chat phrases for Phase ${phaseNumber}.`,
        actionLabel,
      };
    }
    if (/^evaluationlinks(?:\.|$)/.test(field)) {
      return {
        message: `Connect learning objectives and criteria to Phase ${phaseNumber}.`,
        actionLabel,
      };
    }
    return { message: `Review Phase ${phaseNumber}.`, actionLabel };
  }

  if (path === "scenario.title") {
    return { message: "Add a conversation title.", actionLabel: "Review setup" };
  }
  if (path === "scenario.learnergoal") {
    return {
      message: "Add what the Learner should accomplish.",
      actionLabel: "Review setup",
    };
  }
  if (path === "scenario.channels") {
    return { message: "Choose Chat, Voice, or both.", actionLabel: "Review settings" };
  }
  if (path === "evaluation.passingscore") {
    return { message: "Review the score needed to pass.", actionLabel: "Review settings" };
  }
  if (path === "evaluation.objectives") {
    return { message: "Add at least one learning objective.", actionLabel: "Review setup" };
  }
  if (/^evaluation\.objectives\.\d+$/.test(path)) {
    return {
      message: "Review this learning objective and its criteria.",
      actionLabel: "Review objectives",
    };
  }
  if (/^evaluation\.objectives\.\d+\.label$/.test(path)) {
    return { message: "Add a learning objective.", actionLabel: "Review objectives" };
  }
  if (/^evaluation\.objectives\.\d+\.criteria(?:\.\d+(?:\.text)?)?$/.test(path)) {
    return {
      message: "Add at least one evaluation criterion.",
      actionLabel: "Review objectives",
    };
  }
  if (/^evaluation(?:\.|$)/.test(path)) {
    return {
      message: "Review learning objectives and criteria.",
      actionLabel: "Review objectives",
    };
  }
  if (reviewSection === "practice") {
    return {
      message: "Review Chat and Voice practice settings.",
      actionLabel: "Review settings",
    };
  }
  if (reviewSection === "flow") {
    return { message: "Review Conversation Flow.", actionLabel: "Review flow" };
  }
  return { message: "Review Conversation Setup.", actionLabel: "Review setup" };
}

function safeFinalCheckIdentity(value) {
  const normalized = String(value || "");
  let primary = 2166136261;
  let secondary = 2246822507;
  for (const character of normalized) {
    const codePoint = character.codePointAt(0);
    primary = Math.imul(primary ^ codePoint, 16777619);
    secondary = Math.imul(secondary ^ codePoint, 3266489909);
  }
  return `${normalized.length.toString(36)}-${(primary >>> 0).toString(36)}-${(secondary >>> 0).toString(36)}`;
}

export function actionableBlockingIssues(validation = {}, { draft = null } = {}) {
  const issues = Array.isArray(validation?.issues) ? validation.issues : [];
  const actions = [];
  const seen = new Set();
  issues.forEach((rawIssue, index) => {
    const issue = typeof rawIssue === "string"
      ? { severity: "FAIL", message: rawIssue }
      : rawIssue || {};
    const severity = String(issue.severity || issue.level || issue.type || "FAIL").toUpperCase();
    if (severity !== "FAIL") return;
    const initialReviewSection = reviewSectionForIssue(issue);
    const reviewFieldPath = creatorFieldPathForIssue(issue, initialReviewSection, draft);
    const reviewSection = reviewSectionForCreatorFieldPath(reviewFieldPath);
    const messageRule = finalCheckMessageRule(issue, { reviewFieldPath, reviewSection });
    const code = String(issue.code || messageRule?.code || "").trim().toLowerCase()
      || finalCheckSlug(issue.message || issue.detail || issue.text)
      || `blocking-issue-${index + 1}`;
    const creatorAction = finalCheckCreatorAction(reviewFieldPath, reviewSection);
    const blockerFix = [
      "repeated_customer_opening",
      "customer_role_conflict",
      "nondeterministic_resolution",
      "invalid_chat_step_match",
      "chat_step_progression_required"
    ].includes(code)
      ? String(issue.fix || issue.message || "").trim()
      : "";
    const message = messageRule?.message || blockerFix || creatorAction.message;
    const issueFieldIdentity = normalizedIssuePath(issue) || reviewFieldPath;
    const normalizedFieldIdentity = issueFieldIdentity.trim().toLowerCase();
    const messageIdentity = normalizedFinalCheckMessageIdentity(issue);
    const identity = JSON.stringify([code, normalizedFieldIdentity, messageIdentity]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const key = `${reviewSection}:${code}:${issueFieldIdentity}:${safeFinalCheckIdentity(messageIdentity)}`;
    const resolvedTarget = draft && /^(?:flow|evaluation)(?:\.|$)/.test(reviewFieldPath)
      ? reviewFindingTargets(draft, [{ id: key, fieldPath: reviewFieldPath }])[0]
      : null;
    const reviewTarget = resolvedTarget
      ? { phaseId: resolvedTarget.phaseId, focusKey: resolvedTarget.focusKey }
      : null;
    actions.push({
      key,
      message,
      actionLabel: creatorAction.actionLabel,
      actionAriaLabel: `${creatorAction.actionLabel}: ${message}`,
      reviewSection,
      reviewFieldPath,
      ...(reviewTarget ? { reviewTarget } : {})
    });
  });
  return actions;
}

export function focusFinalCheckReviewTarget(action, {
  draft = {},
  section = null,
  phaseList = null,
  phaseCoordinator = null,
  directControl = null
} = {}) {
  const reviewFieldPath = String(action?.reviewFieldPath || "");
  if (phaseList && /^(?:flow|evaluation)\./.test(reviewFieldPath)) {
    const persistedTarget = action?.reviewTarget;
    const target = persistedTarget?.phaseId && persistedTarget?.focusKey
      ? persistedTarget
      : reviewFindingTargets(draft, [{
        id: action?.key || "final-check",
        fieldPath: reviewFieldPath
      }])[0];
    if (target) {
      phaseCoordinator?.openPhase?.(target.phaseId);
      const card = phaseList.querySelector(`[data-phase-id="${target.phaseId}"]`);
      card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      if (focusPhaseEditorControl(phaseList, target.focusKey)) return true;
    }
  }
  if (directControl && revealAndFocusControl(section, directControl)) return true;
  const heading = section?.querySelector("h3") || section?.querySelector("h4");
  if (!heading) return false;
  heading.setAttribute("tabindex", "-1");
  heading.focus();
  return true;
}

function directReviewControl(action, section) {
  if (!section) return null;
  const fieldPath = String(action?.reviewFieldPath || "");
  if (fieldPath === "evaluation.objectives") return section.querySelector("#addSetupObjectiveButton");
  if (fieldPath === "scenario.channels") return section.querySelector("#reviewChatChannel");
  if (/^(?:partner|scenario)\.[A-Za-z]+$/.test(fieldPath)) {
    return section.querySelector(`[data-draft-field="${fieldPath}"]`);
  }
  if (fieldPath === "evaluation.passingScore") return section.querySelector("#passingScoreInput");
  if (fieldPath === "sourceGrounding") {
    return section.querySelector("#sourceGroundingDetails > summary");
  }
  return null;
}

export function renderFinalCheckIssues(container, validation, {
  document: documentRef = browserDocument,
  draft = null,
  onReview = () => {}
} = {}) {
  if (!container || !documentRef) return [];
  container.innerHTML = "";
  const blockers = actionableBlockingIssues(validation, { draft });
  if (!blockers.length) return blockers;
  const list = documentRef.createElement("ul");
  list.className = "validation-blocker-list";
  blockers.forEach((blocker) => {
    const item = documentRef.createElement("li");
    item.className = "validation-blocker";
    const message = documentRef.createElement("p");
    message.textContent = blocker.message;
    const action = documentRef.createElement("button");
    action.type = "button";
    action.className = "button secondary compact";
    action.textContent = blocker.actionLabel;
    action.setAttribute("aria-label", blocker.actionAriaLabel);
    action.addEventListener("click", () => onReview(blocker));
    item.append(message, action);
    list.append(item);
  });
  container.append(list);
  return blockers;
}

function renderValidationIssues() {
  renderFinalCheckIssues(elements.validationIssues, state.validation, {
    draft: state.draft,
    onReview: (blocker) => {
      setStage("review");
      const section = openReviewSection(blocker.reviewSection);
      focusFinalCheckReviewTarget(blocker, {
        draft: state.draft,
        section,
        phaseList: elements.phaseList,
        phaseCoordinator: conversationPhaseEditorCoordinator,
        directControl: directReviewControl(blocker, section)
      });
    }
  });
}

function isRevision() {
  return state.loadMode === "editable" && Boolean(state.expectedBasePublicationId);
}

function revisionChangeGroups() {
  if (!isRevision() || !state.loadedBaselineDraft || !state.draft) return [];
  return buildRevisionDiff(state.loadedBaselineDraft, state.draft);
}

export function revisionPublicationState({
  revision = false,
  changeCount = null,
  releaseNote = ""
} = {}) {
  if (!revision) {
    return {
      kind: "first_publish",
      showReleaseNote: false,
      showPublishAction: true,
      releaseNoteReady: true
    };
  }
  if (changeCount === 0) {
    return {
      kind: "nothing_to_publish",
      showReleaseNote: false,
      showPublishAction: false,
      releaseNoteReady: false
    };
  }
  return {
    kind: "revision_ready",
    showReleaseNote: true,
    showPublishAction: true,
    releaseNoteReady: Boolean(String(releaseNote).trim())
  };
}

function renderPublicationContext() {
  if (!elements.publicationContext || !state.draft) return revisionPublicationState();
  const revision = isRevision();
  const groups = revisionChangeGroups();
  const comparisonReady = revision && Boolean(state.loadedBaselineDraft && state.draft);
  const changeCount = comparisonReady
    ? groups.reduce((total, group) => total + group.changes.length, 0)
    : null;
  const publicationState = revisionPublicationState({
    revision,
    changeCount,
    releaseNote: state.releaseNote
  });
  elements.publicationContext.hidden = !revision;
  elements.revisionExperience.hidden = !revision;
  elements.releaseNoteExperience.hidden = !publicationState.showReleaseNote;
  elements.revisionStatusBadge.hidden = !revision;
  elements.nothingToPublish.hidden = publicationState.kind !== "nothing_to_publish";
  elements.publishButton.hidden = !publicationState.showPublishAction;
  elements.publishButton.textContent = revision ? "Publish revision" : "Publish conversation";
  if (!revision) return publicationState;
  const status = state.revisionStatus || "current";
  const statusCopy = {
    checking: ["Checking live version", "Confirming that your revision still starts from the live version."],
    stale: ["Stale revision", "A newer version is live. This draft cannot publish. Return to Build and reopen the current conversation before making a new revision."],
    current: ["Published version confirmed", "This comparison uses the current published version."]
  }[status];
  elements.revisionStatusBadge.textContent = statusCopy[0];
  elements.revisionStatusBadge.dataset.state = status;
  elements.revisionComparisonStatus.textContent = statusCopy[1];
  elements.revisionChangeCount.textContent = changeCount === null
    ? "Comparing changes"
    : `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;
  renderRevisionDiff(groups);
  if (elements.releaseNoteInput.value !== state.releaseNote) {
    elements.releaseNoteInput.value = state.releaseNote;
  }
  elements.releaseNoteCount.textContent = `${state.releaseNote.length} of 240 characters`;
  elements.releaseNoteInput.setAttribute(
    "aria-invalid",
    String(!state.releaseNote.trim())
  );
  return publicationState;
}

function renderRevisionDiff(groups) {
  elements.revisionDiff.innerHTML = "";
  groups.forEach((group) => {
    const section = document.createElement("details");
    section.className = "revision-diff-group";
    section.open = group.changes.length > 0;
    const summary = document.createElement("summary");
    const label = document.createElement("strong");
    label.textContent = group.label;
    const count = document.createElement("span");
    count.textContent = group.changes.length
      ? `${group.changes.length} ${group.changes.length === 1 ? "change" : "changes"}`
      : "No changes";
    summary.append(label, count);
    section.append(summary);
    if (!group.changes.length) {
      const unchanged = document.createElement("p");
      unchanged.className = "revision-no-changes";
      unchanged.textContent = "This area matches the live version.";
      section.append(unchanged);
    } else {
      const list = document.createElement("div");
      list.className = "revision-change-list";
      group.changes.forEach((change) => {
        const item = document.createElement("article");
        item.className = "revision-change";
        item.dataset.kind = change.kind;
        const heading = document.createElement("div");
        const kind = document.createElement("span");
        kind.className = "revision-change-kind";
        kind.textContent = change.kind === "added"
          ? "Added"
          : change.kind === "removed"
            ? "Removed"
            : "Changed";
        const field = document.createElement("strong");
        field.textContent = change.label;
        heading.append(kind, field);
        item.append(heading);
        if (change.before) item.append(revisionValue("Live", change.before, "before"));
        if (change.after) item.append(revisionValue("Draft", change.after, "after"));
        list.append(item);
      });
      section.append(list);
    }
    elements.revisionDiff.append(section);
  });
}

function revisionValue(label, value, position) {
  const wrapper = document.createElement("p");
  wrapper.className = "revision-value";
  wrapper.dataset.position = position;
  const prefix = document.createElement("b");
  prefix.textContent = `${label}: `;
  wrapper.append(prefix, document.createTextNode(value));
  return wrapper;
}

export function buildValidationCheckRows({
  publishChecks = {},
  evaluationApproved = false
} = {}) {
  const authoritative = publishChecks.authoritative || "not_run";
  const privacy = publishChecks.privacy || "not_run";
  const running = [authoritative, privacy].includes("running");
  const attempted = [authoritative, privacy].some((status) =>
    !["not_run", "not_tested"].includes(status)
  );
  return [
    {
      label: "Conversation readiness",
      help: "Checks that the required conversation details, flow, guidance, and practice settings are complete and work together.",
      status: authoritative
    },
    {
      label: "Personal information",
      help: "Checks for personal or sensitive information that should not be included.",
      status: privacy
    },
    {
      label: "Objectives and criteria",
      help: "Checks that every learning objective has clear criteria and is connected to the conversation flow.",
      status: running
        ? "running"
        : !attempted
          ? "not_validated"
          : evaluationApproved
            ? "passed"
            : "attention"
    }
  ];
}

export function validationUnavailableState(error) {
  const routeMessage = String(error?.routeMessage || "").replace(/\s+/g, " ").trim();
  const message = routeMessage && routeMessage.length <= 500 && !/^(?:true|false)$/i.test(routeMessage)
    ? routeMessage
    : "Validation could not run. Try again.";
  return {
    ok: false,
    status: "unavailable",
    message,
    canRetry: true,
    issues: [],
    summary: { fail: 0, warn: 0 }
  };
}

export function sourceSelectionValidationState(selection = {}) {
  if (selection?.ok === true) return null;
  return {
    ok: false,
    status: "needs_changes",
    issues: [{
      severity: "FAIL",
      code: "source_grounding_review",
      section: "practice",
      fieldPath: "sourceGrounding",
      message: SOURCE_SELECTION_VALIDATION_MESSAGE
    }],
    summary: { fail: 1, warn: 0 }
  };
}

export function renderValidationCheckRows(container, rows, {
  documentRef = document,
  unavailable = null,
  onRetry = () => {}
} = {}) {
  if (!container || !documentRef) return;
  const labels = {
    passed: "Passed",
    running: "Running",
    attention: "Needs attention",
    needs_revision: "Needs revision",
    unavailable: "Could not run",
    not_tested: "Not validated",
    not_run: "Not validated",
    not_validated: "Not validated"
  };
  container.innerHTML = "";
  rows.forEach(({ label, help, status }) => {
    const item = documentRef.createElement("li");
    item.dataset.status = status;
    const nameGroup = documentRef.createElement("span");
    nameGroup.className = "validation-check-name";
    const name = documentRef.createElement("span");
    name.textContent = label;
    const coach = documentRef.createElement("span");
    coach.className = "validation-check-coach coach-helper";
    const avatar = documentRef.createElement("img");
    avatar.src = "/builder-studio/assets/coach-chewy.png";
    avatar.alt = "";
    avatar.setAttribute("aria-hidden", "true");
    avatar.setAttribute("width", "1024");
    avatar.setAttribute("height", "1023");
    const coachPrefix = documentRef.createElement("span");
    coachPrefix.className = "visually-hidden";
    coachPrefix.textContent = "Coach Chewy says: ";
    const helpText = documentRef.createElement("span");
    helpText.className = "validation-check-help";
    helpText.textContent = help;
    coach.append(avatar, coachPrefix, helpText);
    nameGroup.append(name, coach);
    const result = documentRef.createElement("strong");
    result.textContent = labels[status] || "Not validated";
    item.append(nameGroup, result);
    container.append(item);
  });
  if (unavailable?.status === "unavailable") {
    const item = documentRef.createElement("li");
    item.className = "validation-check-unavailable";
    item.dataset.status = "unavailable";
    const message = documentRef.createElement("p");
    message.textContent = unavailable.message;
    item.append(message);
    if (unavailable.canRetry === true) {
      const retry = documentRef.createElement("button");
      retry.type = "button";
      retry.className = "button secondary compact-button";
      retry.textContent = "Try validation again";
      retry.addEventListener("click", () => onRetry());
      item.append(retry);
    }
    container.append(item);
  }
}

function renderPublishChecks() {
  if (!elements.publishChecksList || !state.draft) return;
  renderValidationCheckRows(
    elements.publishChecksList,
    buildValidationCheckRows({
      publishChecks: state.publishChecks,
      evaluationApproved: isEvaluationApproved(state.draft)
    }),
    {
      unavailable: state.validation?.status === "unavailable" ? state.validation : null,
      onRetry: runValidation
    }
  );
}

async function refreshRevisionBaseline() {
  if (!isRevision()) return;
  state.revisionStatus = "checking";
  renderPublicationContext();
  try {
    const result = await requestJson("/api/builder/load", {
      method: "POST",
      body: JSON.stringify({
        familyId: state.loadedFamilyId,
        expectedPublicationId: state.expectedBasePublicationId
      })
    });
    if (result.mode !== "editable") throw new Error("This conversation is no longer available for revision.");
    const imported = result.authoringSnapshot
      ? { draft: result.authoringSnapshot }
      : importStudioScenarios(result.scenarios);
    state.loadedCanonicalScenarios = clone(result.scenarios);
    state.loadedBaselineDraft = normalizeStudioDraft(imported.draft);
    state.assetPublicationId = result.expectedBasePublicationId || "";
    state.revisionStatus = "current";
    renderPublicationContext();
  } catch (error) {
    if (applyPublicationConflictState(state, error)) {
      renderPublicationContext();
      throw new Error("A newer version is live. This draft is stale and cannot publish. Return to Build and reopen the current conversation.");
    }
    state.revisionStatus = "current";
    renderPublicationContext();
    throw error;
  }
}

function showPendingPublishLockMessage() {
  const message = "The publish result is still being confirmed. Retry publish before editing or leaving.";
  elements.publishStatus.textContent = message;
  showToast(message);
  elements.publishButton.focus({ preventScroll: true });
}

function renderPendingPublishInteractionLock() {
  return configurePendingPublishInteractionLock({
    publishState: state,
    stagePanels: elements.stagePanels,
    publishPanel: elements.stagePanels.find((panel) => panel.dataset.stagePanel === "validate"),
    navigation: elements.stageNavigation,
    backNavigation: [elements.backToConversationLibraryButton],
    lockedControls: [
      elements.validateButton,
      elements.validationIssues,
      elements.savePersistentDraftButton,
      elements.downloadJsonMenu,
      elements.draftConflictNotice,
      elements.nothingToPublish,
      elements.releaseNoteExperience,
      elements.publicationContext
    ],
    publishButton: elements.publishButton
  });
}

function renderPublishGate() {
  const publicationState = renderPublicationContext();
  const currentRevision = !isRevision() || state.revisionStatus === "current";
  const ready = isThinPublishReady({
    validation: state.validation,
    confirmed: true,
    publishComplete: state.publishComplete
  }) && isPublishReadyForCurrentDraft(state.draft) &&
    publicationState.showPublishAction &&
    publicationState.releaseNoteReady &&
    currentRevision;
  elements.publishButton.disabled = !ready;
  renderPublishChecks();
  renderPendingPublishInteractionLock();
}

const PORTABLE_SERVER_FIELDS = new Set([
  "owner", "owneruserid", "owneremail",
  "creatorid", "creatoremail",
  "siteuserid", "siteuseremail", "siterole",
  "publicationid", "parentpublicationid", "operationid", "versionid", "contenthash",
  "releasenote",
  "objectkey", "s3key", "bucket", "bucketname",
  "index", "indexbody", "signature", "actor", "actorid", "actoremail", "userid"
]);

function portableRuntimeValue(value) {
  if (Array.isArray(value)) return value.map(portableRuntimeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      PORTABLE_SERVER_FIELDS.has(normalizedKey) ||
      ["__proto__", "prototype", "constructor"].includes(key)
    ) return [];
    return [[key, portableRuntimeValue(child)]];
  }));
}

export function portableValidatedScenarioFiles({ validation, scenarios = [] } = {}) {
  if (validation?.ok !== true || !Array.isArray(validation?.files)) return [];
  if (validation.files.every((file) => file?.scenario && file?.filename)) {
    return validation.files.flatMap((file) => {
      const scenario = file.scenario;
      const channel = String(scenario?.channels?.[0] || "").toLowerCase();
      if (!["chat", "voice"].includes(channel)) return [];
      return [{
        channel,
        filename: String(file.filename),
        json: `${JSON.stringify(portableRuntimeValue(scenario), null, 2)}\n`
      }];
    });
  }
  return validation.files.flatMap((file) => {
    const scenarioId = String(file?.scenarioId || "").trim();
    const channel = String(file?.channel || "").trim().toLowerCase();
    if (!scenarioId || !["chat", "voice"].includes(channel)) return [];
    const scenario = scenarios.find((entry) =>
      entry?.id === scenarioId &&
      Array.isArray(entry?.channels) &&
      entry.channels.length === 1 &&
      entry.channels[0] === channel
    );
    if (!scenario) return [];
    return [{
      channel,
      filename: `${scenarioId.replace(/[^a-z0-9_-]/gi, "_")}.json`,
      json: `${JSON.stringify(portableRuntimeValue(scenario), null, 2)}\n`
    }];
  });
}

function currentPortableScenarioFiles() {
  return portableValidatedScenarioFiles({
    validation: state.validation,
    scenarios: state.composed?.scenarios || []
  });
}

function renderPortableDownloadResult() {
  if (!elements.downloadResult) return;
  const status = state.downloadResult?.status || "";
  elements.downloadResult.hidden = !status;
  elements.downloadResult.dataset.state = status;
  elements.downloadResultMessage.textContent = status
    ? "Download requested. Check your browser's downloads."
    : "";
  elements.copyJsonButton.disabled = !state.downloadResult?.json;
  elements.copyJsonStatus.textContent = status === "copied"
    ? "JSON copied to your clipboard."
    : status === "copy_failed"
      ? "JSON could not be copied. Try again."
      : "";
}

function clearPortableDownloadObjectUrl(url) {
  const timer = portableDownloadObjectUrls.get(url);
  if (timer !== undefined) browserWindow?.clearTimeout(timer);
  portableDownloadObjectUrls.delete(url);
  URL.revokeObjectURL(url);
}

function schedulePortableDownloadCleanup(url) {
  const timer = browserWindow.setTimeout(() => {
    portableDownloadObjectUrls.delete(url);
    URL.revokeObjectURL(url);
  }, 30_000);
  portableDownloadObjectUrls.set(url, timer);
}

function clearPortableDownloadObjectUrls() {
  [...portableDownloadObjectUrls.keys()].forEach(clearPortableDownloadObjectUrl);
}

function renderPortableDownloads() {
  const available = new Set(currentPortableScenarioFiles().map((file) => file.channel));
  elements.downloadChatJsonButton.disabled = !available.has("chat");
  elements.downloadVoiceJsonButton.disabled = !available.has("voice");
  if (!available.size) {
    elements.downloadJsonMenu.open = false;
    state.downloadResult = { status: "", json: "" };
  }
  renderPortableDownloadResult();
}

function downloadPortableScenario(channel) {
  const file = currentPortableScenarioFiles().find((entry) => entry.channel === channel);
  if (!file) {
    showToast(`Validate ${channel === "voice" ? "Voice" : "Chat"} before downloading.`);
    return false;
  }
  const url = URL.createObjectURL(new Blob([file.json], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  schedulePortableDownloadCleanup(url);
  state.downloadResult = {
    status: "requested",
    json: file.json
  };
  elements.downloadJsonMenu.open = false;
  renderPortableDownloadResult();
  return true;
}

async function copyPortableScenarioJson() {
  const json = state.downloadResult?.json;
  if (!json) return false;
  try {
    if (typeof navigator?.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(json);
    state.downloadResult.status = "copied";
  } catch {
    state.downloadResult.status = "copy_failed";
  }
  renderPortableDownloadResult();
  return state.downloadResult.status === "copied";
}

export function buildFinalCheckReadyCopy(channels = []) {
  const selected = new Set(
    (Array.isArray(channels) ? channels : [])
      .map((channel) => String(channel || "").trim().toLowerCase())
  );
  const channelLabel = selected.has("chat") && selected.has("voice")
    ? "Chat and Voice are"
    : selected.has("voice")
      ? "Voice is"
      : selected.has("chat")
        ? "Chat is"
        : "The conversation is";
  return {
    headline: "Validated",
    description: `${channelLabel} ready to test.`,
    toast: `Validation passed. ${channelLabel} ready to test.`
  };
}

export function finalCheckDisplayState(validation, channels = []) {
  if (validation?.status === "unavailable") {
    return {
      headline: "Validation could not run",
      description: "Try again. If validation still doesn’t run, contact support."
    };
  }
  if (!validation) {
    return {
      headline: "Ready to validate",
      description: "Validate this conversation before downloading."
    };
  }
  if (actionableBlockingIssues(validation).length) {
    return {
      headline: "Changes needed",
      description: "Fix the items below, then validate again."
    };
  }
  const readyChannels = Array.isArray(channels)
    ? channels
    : Array.isArray(validation?.files)
      ? validation.files.map((file) => file.channel)
      : [];
  const readyCopy = buildFinalCheckReadyCopy(readyChannels);
  return { headline: readyCopy.headline, description: readyCopy.description };
}

export function setCoachMessage(
  target,
  message,
  { documentRef = target?.ownerDocument || browserDocument } = {}
) {
  if (!target || !documentRef) return false;
  target.innerHTML = "";
  const prefix = documentRef.createElement("span");
  prefix.className = "visually-hidden";
  prefix.textContent = "Coach Chewy says: ";
  const copy = documentRef.createElement("span");
  copy.textContent = String(message || "");
  target.append(prefix, copy);
  return true;
}

function renderValidation() {
  const display = finalCheckDisplayState(
    state.validation,
    state.draft?.scenario?.channels || []
  );
  elements.validationHeadline.textContent = display.headline;
  setCoachMessage(elements.validationDescription, display.description);
  renderValidationIssues();
  renderPublishGate();
  renderReviewReadiness();
  renderPortableDownloads();
}

export function standalonePublishChecks({ issues = [], fail = 0 } = {}) {
  const privacyHasBlockingIssue = issues.some((issue) =>
    /^privacy_/i.test(String(issue?.code || ""))
  );
  return {
    authoritative: fail === 0 ? "passed" : "attention",
    privacy: privacyHasBlockingIssue ? "attention" : "passed"
  };
}

async function runValidation() {
  elements.validateButton.disabled = true;
  elements.validateButton.textContent = "Validating…";
  elements.validationHeadline.textContent = "Validating the conversation";
  try {
    const sourceSelection = validateSourceSelections(currentSourceGrounding());
    if (!sourceSelection.ok) {
      state.validation = sourceSelectionValidationState(sourceSelection);
      state.publishChecks = { authoritative: "attention", privacy: "not_run" };
      setGlobalStatus(state.validation.issues[0].message, "error");
      renderValidation();
      return;
    }
    await refreshRevisionBaseline();
    state.draft = prepareDraftForValidation(state.draft);
    state.publishChecks = {
      authoritative: "running",
      privacy: "running"
    };
    renderPublishChecks();
    await saveDraft({ quiet: true });
    const health = healthCheckForCurrentDraft();
    renderHealthCheck();
    const standaloneDraft = authoringToStandaloneDraft(state.draft);
    const validationResponse = await fetch("/api/builder/validate", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        draft: standaloneDraft,
        deidentificationConfirmed: state.draft?.source?.anonymized === true,
        objectiveApproval: {
          required: true,
          approved: true,
          fingerprint: standaloneObjectiveFingerprint(standaloneDraft.objectives)
        }
      })
    });
    const authoritative = await validationResponse.json();
    if (!validationResponse.ok && validationResponse.status !== 422) {
      throw new Error(authoritative?.error?.message || authoritative?.message || "The files could not be checked.");
    }
    state.standaloneFiles = Array.isArray(authoritative.files) ? authoritative.files : [];
    const authoritativeIssues = (Array.isArray(authoritative.issues) ? authoritative.issues : []).map((issue) => ({
      code: String(issue.code || ""),
      severity: "FAIL",
      section: String(issue.path || "Conversation"),
      fieldPath: String(issue.path || ""),
      message: `${String(issue.message || "The draft needs attention.")} ${String(issue.fix || "")}`.trim()
    }));
    const healthIssues = health.findings.map((item) => ({
      severity: item.severity === "critical" ? "FAIL" : "WARN",
      section: item.section,
      message: `${item.category}: ${item.rationale}`,
      fieldPath: item.fieldPath
    }));
    const issues = [...authoritativeIssues, ...healthIssues];
    const authoritativeHasBlockingIssue = authoritativeIssues.some((issue) =>
      String(issue?.severity || "FAIL").toUpperCase() === "FAIL"
    );
    if (authoritative.ok !== true && !authoritativeHasBlockingIssue) {
      issues.push({
        severity: "FAIL",
        section: "Conversation",
        message: "The authoritative conversation validator rejected this draft without a detailed finding."
      });
    }
    const fail = issues.filter((issue) =>
      String(issue?.severity || "FAIL").toUpperCase() === "FAIL"
    ).length;
    const warn = issues.filter((issue) =>
      String(issue?.severity || "").toUpperCase() === "WARN"
    ).length;
    state.validation = {
      ...authoritative,
      files: state.standaloneFiles,
      issues,
      issuesBySection: undefined,
      ok: fail === 0,
      summary: { fail, warn }
    };
    state.publishChecks = standalonePublishChecks({
      issues: authoritative.issues,
      fail
    });
    renderValidation();
    if (state.validation.ok) {
      showToast(buildFinalCheckReadyCopy(state.draft.scenario.channels).toast);
    } else {
      showToast("Changes are needed before downloading.");
    }
  } catch (error) {
    state.validation = validationUnavailableState(error);
    state.publishChecks = error?.code === "privacy_blocked"
      ? { authoritative: "not_run", privacy: "attention" }
      : state.publishChecks.authoritative === "running"
        ? { authoritative: "unavailable", privacy: "unavailable" }
        : state.publishChecks;
    setGlobalStatus(state.validation.message, "error");
    renderValidation();
  } finally {
    elements.validateButton.disabled = false;
    elements.validateButton.textContent = "Validate";
  }
}

async function publishScenario() {
  if (state.validation?.ok !== true) {
    showToast("Validate the conversation and fix any items in Review/Edit before publishing.");
    return;
  }
  if (isRevision() && !state.releaseNote.trim()) {
    showToast("Add a short release note for this revision.");
    elements.releaseNoteInput.focus();
    return;
  }
  state.publishInFlight = true;
  elements.publishButton.disabled = true;
  clearDraftConflict();
  elements.publishStatus.textContent = isRevision()
    ? "Publishing the new version…"
    : "Publishing the conversation…";
  renderPublishGate();
  try {
    const completion = await runPublishScenarioSubmission({
      publishState: state,
      persistDraft: persistCurrentDraft,
      refreshBaseline: refreshRevisionBaseline,
      buildAttempt: async () => {
        const publishingRevision = isRevision();
        const composed = await composeDraft();
        const familyId = state.loadMode === "editable"
          ? state.loadedFamilyId
          : state.draft.scenario.baseId;
        state.publishOperationId ||= crypto.randomUUID();
        return {
          body: JSON.stringify({
            operationId: state.publishOperationId,
            familyId,
            expectedBasePublicationId: state.loadMode === "editable"
              ? state.expectedBasePublicationId
              : null,
            ...(publishingRevision ? { releaseNote: state.releaseNote.trim() } : {}),
            deidentificationConfirmed: state.draft?.source?.anonymized === true,
            draft: normalizePhaseAuthoringDraft(state.draft),
            scenarios: composed.scenarios
          }),
          familyId,
          operationId: state.publishOperationId,
          publishingRevision
        };
      },
      currentDraft: state.draft,
      applyPublishedState: ({ result, attempt, newerDraftRetained }) => {
        const attemptedPayload = publishAttemptPayload(attempt);
        state.draft = normalizePhaseAuthoringDraft(attemptedPayload.draft);
        state.sourceGrounding = clone(state.draft.sourceGrounding);
        state.loadedFamilyId = result.familyId;
        state.expectedBasePublicationId = result.publicationId;
        state.loadMode = "editable";
        state.revisionStatus = "current";
        state.publishComplete = true;
        state.savedDraft = clone(state.draft);
        state.loadedBaselineDraft = clone(attemptedPayload.draft);
        state.loadedCanonicalScenarios = clone(attemptedPayload.scenarios);
        state.assetPublicationId = result.publicationId;
        state.releaseNote = "";
        state.currentDraftActive = false;
        if (newerDraftRetained) state.draftEtag = "";
      },
      loadCatalog: loadPublishedCatalog,
      setStatus: (message) => {
        elements.publishStatus.textContent = message;
        showToast(message);
      },
      celebrate: () => launchPublishConfetti(),
      returnToLibrary: showPublishedConversationInLibrary
    });
    if (!completion.completed) {
      if (completion.reason === "draft_changed") {
        elements.publishStatus.textContent = "A newer draft change was protected from this earlier publish attempt. Reload before continuing.";
      }
      return;
    }
  } catch (error) {
    applyPublicationConflictState(state, error);
    elements.publishStatus.textContent = validPendingPublishRequest(state.pendingPublishRequest)
      ? "The publish result could not be confirmed. Retry publish before editing or leaving."
      : String(error?.message || error);
  } finally {
    state.publishInFlight = false;
    renderPublishGate();
  }
}

function addListItem(path) {
  const list = clone(getPath(state.draft, path) || []);
  const defaults = {
    "handling.correct": "Describe the next approved learner action.",
    "handling.avoid": "Describe a mistake or unsupported action to avoid.",
    "handling.customerResponses": "Write an approved Conversation Partner response for this phase.",
    "evaluation.criteria": "Describe one observable success criterion."
  };
  list.push(defaults[path] || "Add detail.");
  setPath(state.draft, path, list);
  setDirty();
  const container = $(`[data-list-editor="${path}"]`);
  if (container) renderStringList(path, container);
}

function addManualHotkey() {
  const item = normalizeHotkey({
    hotkey: elements.manualHotkeyInput.value,
    category: elements.manualHotkeyCategoryInput.value,
    template: elements.manualHotkeyTemplateInput.value
  });
  if (!item) {
    showToast("Add both a shortcut and an approved response.");
    return;
  }
  setHotkeySelected(item, true);
  elements.manualHotkeyInput.value = "";
  elements.manualHotkeyCategoryInput.value = "";
  elements.manualHotkeyTemplateInput.value = "";
}

function wireControls() {
  window.addEventListener("message", handleSimulatorPreviewMessage);
  ensureSourceGroundingControls();
  wireSelectTitleSynchronization();
  wireTaxonomyControls();
  elements.addSetupObjectiveButton.addEventListener("click", () => {
    const added = addObjective(state.draft, {
      objectiveId: guidanceItemId("learning_objective"),
    });
    if (!added.objectiveId) return;
    state.draft = added.draft;
    setDirty();
    renderSetupObjectiveEditor();
    refreshSetupObjectiveErrors();
    renderConversationPhases();
    renderReviewReadiness();
    renderReviewBlockingSummary();
    elements.setupObjectiveList.querySelector(
      `[data-objective-id="${added.objectiveId}"] input`
    )?.focus();
  });
  elements.backToConversationLibraryButton?.addEventListener("click", returnToConversationLibrary);
  elements.createNewConversationButton?.addEventListener("click", startNewConversation);
  elements.nothingToPublishLibraryButton?.addEventListener("click", returnToConversationLibrary);
  [
    elements.conversationSearchInput,
    elements.conversationStatusFilter,
    elements.conversationTopicFilter,
    elements.conversationSubtopicFilter
  ].filter(Boolean).forEach((control) => {
    control.addEventListener(control === elements.conversationSearchInput ? "input" : "change", renderConversationLibrary);
  });
  const applyConversationSort = (requestedKey) => {
    const next = nextConversationSort({
      key: state.conversationSortKey,
      direction: state.conversationSortDirection
    }, requestedKey);
    state.conversationSortKey = next.key;
    state.conversationSortDirection = next.direction;
    renderConversationLibrary();
  };
  elements.conversationSortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyConversationSort(button.dataset.conversationSortKey);
    });
  });
  elements.conversationMobileSortButton?.addEventListener("click", () => {
    applyConversationSort(state.conversationSortKey);
  });
  elements.conversationMobileSortKey?.addEventListener("change", () => {
    if (elements.conversationMobileSortKey.value === state.conversationSortKey) return;
    applyConversationSort(elements.conversationMobileSortKey.value);
  });
  wirePassingScoreStepper({
    input: elements.passingScoreInput,
    incrementButton: elements.passingScoreIncrementButton,
    decrementButton: elements.passingScoreDecrementButton
  });
  elements.conversationLibraryBody?.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-library-action]");
    if (!button || button.disabled) return;
    const row = allConversationRows().find((entry) => entry.key === button.dataset.rowKey);
    if (!row) {
      showToast("Refresh the conversation list and choose it again.");
      return;
    }
    if (button.dataset.libraryAction === "archive") {
      button.disabled = true;
      await updateConversationArchive(row, row.archived !== true);
      if (button.isConnected) button.disabled = false;
      return;
    }
    try {
      await routeConversationLibraryAction({
        row,
        action: button.dataset.libraryAction,
        openSession: openCurrentDraft,
        duplicateSession: duplicateCurrentDraft,
        openPersistent: openPersistentDraftConversation,
        openPublished: (selectedRow, options) => {
          const family = state.publishedFamilies.find(
            (entry) => entry.familyId === selectedRow.familyId
          );
          const editAction = conversationEditAction(selectedRow);
          return openPublishedFamily(family, {
            duplicate: options.duplicate || editAction.loadAsCopy,
            editRequested: options.editRequested
          });
        }
      });
    } catch (error) {
      state.catalogError = String(error?.message || error);
      renderConversationLibrary();
    }
  });
  [
    elements.customerSituationInput,
    elements.learnerApproachInput
  ].forEach((control) => {
    control.addEventListener(control.type === "checkbox" ? "change" : "input", () => {
      state.currentDraftActive = true;
      state.currentDraftUpdatedAt = new Date().toISOString();
    });
  });
  elements.stageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.stage === "tune" && button.dataset.stage !== "tune") closePreview("");
      setStage(button.dataset.stage);
    });
  });
  $$("[data-go-stage]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.stage === "tune" && button.dataset.goStage !== "tune") closePreview("");
      setStage(button.dataset.goStage);
    });
  });
  if (elements.addPastedSourceButton) {
    elements.addPastedSourceButton.addEventListener("click", () => {
    try {
      if (state.sourceReimportTarget) {
        prepareSourceComparison(state.sourceReimportTarget, {
          content: elements.sourceTextInput.value,
          kind: "pasted_text",
          label: elements.sourceNameInput.value
        });
        return;
      }
      addNewSource(createSourceDocument({
        label: elements.sourceNameInput.value,
        kind: "pasted_text",
        content: elements.sourceTextInput.value
      }));
    } catch (error) {
      setSourceStatus(String(error?.message || error), "error");
    }
  });
  elements.sourceDropZone.addEventListener("click", () => {
    elements.sourceFileInput.click();
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    elements.sourceDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.sourceDropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.sourceDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.sourceDropZone.classList.remove("is-dragging");
    });
  });
  elements.sourceDropZone.addEventListener("drop", async (event) => {
    await importLocalSourceFile(event.dataTransfer?.files?.[0]);
  });
  elements.sourceFileInput.addEventListener("change", async () => {
    const file = elements.sourceFileInput.files?.[0];
    elements.sourceFileInput.value = "";
    await importLocalSourceFile(file);
  });
  elements.acceptSourceUpdateButton.addEventListener("click", () => {
    const proposal = state.pendingSourceUpdate;
    if (!proposal) return;
    if (proposal.nextDraft) {
      proposal.nextDraft.sourceGrounding = proposal.nextGrounding;
      state.draft = normalizeStudioDraft(proposal.nextDraft);
      state.sourceGrounding = clone(state.draft.sourceGrounding);
      setDirty();
      renderCreateSummary();
      renderReview();
    } else {
      setSourceGrounding(proposal.nextGrounding);
    }
    state.pendingSourceUpdate = null;
    renderSourceUpdateProposal();
    renderSourceGrounding();
    setSourceStatus("The localized source updates were accepted. Review any citation marked needs review.", "success");
  });
  elements.keepCurrentSourceButton.addEventListener("click", () => {
    state.pendingSourceUpdate = null;
    renderSourceUpdateProposal();
    setSourceStatus("The current draft and source were kept unchanged.");
  });
    elements.applySourcesButton.addEventListener("click", () => {
    try {
      const selection = validateSourceSelections(currentSourceGrounding());
      if (!selection.ok) {
        throw new Error("Review every mapped passage before applying source material.");
      }
      state.draft = normalizeStudioDraft(
        applySourceGroundingToDraft(state.draft, currentSourceGrounding())
      );
      state.sourceGrounding = clone(state.draft.sourceGrounding);
      setDirty();
      renderCreateSummary();
      renderReview();
      renderSourceGrounding();
      setSourceStatus("Reviewed passages were applied only to their mapped content areas.", "success");
    } catch (error) {
      setSourceStatus(String(error?.message || error), "error");
    }
    });
  }
  elements.buildConversationContinueButton.addEventListener("click", async () => {
    if (!elements.customerSituationInput.value.trim()) {
      setBuildIntakeStatus("Describe what this conversation is about.", "error");
      setBuildIntakeStep("conversation", { focus: true });
      return;
    }
    setBuildIntakeStatus("");
    setBuildIntakeStep("handling", { focus: true });
    await playBuildCoachAcknowledgement({
      coach: elements.buildHandlingCoach,
      message: elements.buildHandlingCoachMessage,
      acknowledgement: "Now describe what the Learner should accomplish, how they should approach it, and anything they should avoid."
    });
  });
  elements.editBuildConversationButton.addEventListener("click", () => {
    setBuildIntakeStatus("");
    setBuildIntakeStep("conversation", { focus: true });
  });
  elements.createDraftButton.addEventListener("click", async () => {
    const requiredInputs = [
      [elements.customerSituationInput, "conversation", "Describe what this conversation is about."],
      [elements.learnerApproachInput, "handling", "Describe how the Learner should handle the conversation."]
    ];
    const missing = requiredInputs.find(([input]) => !input.value.trim());
    if (missing) {
      setBuildIntakeStatus(missing[2], "error");
      setBuildIntakeStep(missing[1], { focus: true });
      return;
    }
    if (elements.deidentificationConfirmedInput.checked !== true) {
      setBuildIntakeStatus("Confirm that the conversation details are fictional or de-identified.", "error");
      elements.deidentificationConfirmedInput.focus();
      return;
    }
    setBuildIntakeStatus("");
    let result;
    let acknowledgementPromise;
    setBuildIntakeControlsDisabled(true);
    try {
      acknowledgementPromise = playBuildCoachAcknowledgement({
        coach: elements.buildCreatingCoach,
        message: elements.buildCreatingCoachMessage,
        acknowledgement: "Perfect—I’m building your draft now.",
        settledState: "thinking"
      });
      setBuildIntakeStep("creating");
      elements.createDraftButton.disabled = false;
      result = await runCreateDraftBuild({
        conversationAboutInput: elements.customerSituationInput,
        learnerApproachInput: elements.learnerApproachInput,
        deidentificationConfirmedInput: elements.deidentificationConfirmedInput,
        createDraftButton: elements.createDraftButton,
        reportStatus: setBuildIntakeStatus,
        completeDraftCreation: async (draft) => {
          await acknowledgementPromise;
          const preparedStandardText = prepareStandardTextMode({
            draft,
            hotkeys: state.hotkeys,
            isNew: true
          });
          state.draft = preparedStandardText.draft;
          state.standardTextMode = preparedStandardText.mode;
          state.sourceGrounding = clone(state.draft.sourceGrounding);
          state.pendingSourceUpdate = null;
          state.currentDraftActive = true;
          state.currentDraftUpdatedAt = new Date().toISOString();
          resetReviewProgress();
          resetPublicationContext();
          setDirty();
          setGlobalStatus("");
          renderSourceGrounding();
          renderSourceUpdateProposal();
          renderReview();
          setStandardTextMode(state.standardTextMode);
          await saveDraft({ quiet: true });
          setStage("review");
        }
      });
      await acknowledgementPromise;
    } finally {
      setBuildIntakeControlsDisabled(false);
    }
    setBuildIntakeStep("handling", { focus: result?.status !== "created" });
  });
  $$("[data-draft-field]").forEach((control) => {
    const update = () => {
      let value = control.value;
      if (control.type === "checkbox") value = control.checked;
      if (control.type === "number" || control.type === "range") value = Number(value);
      if (control.dataset.draftField === "chat.hotkeyProfile") {
        const nextDraft = updateStandardTextProfile({
          draft: state.draft,
          profile: value,
          hotkeys: state.hotkeys,
          mode: state.standardTextMode
        });
        commitApprovedResponseSet(nextDraft);
      } else {
        setPath(state.draft, control.dataset.draftField, value);
      }
      if (control.dataset.draftField === "voice.selectedVoice") {
        state.draft.tuning.voice.id = value;
      }
      if (control.dataset.draftField === "voice.speed") {
        state.draft.tuning.voice.speed = value;
        elements.reviewSpeedOutput.textContent = `${Number(value).toFixed(2)}×`;
      }
      setDirty();
      if (control.dataset.draftField === "chat.hotkeyProfile") renderHotkeys();
    };
    control.addEventListener(control.type === "range" ? "input" : "change", update);
    if (["text", "textarea"].includes(control.type) || control.tagName === "TEXTAREA") {
      control.addEventListener("input", update);
    }
  });
  $$("[data-review-channel]").forEach((input) => {
    input.addEventListener("change", () => {
      if (state.loadMode === "editable") {
        input.checked = state.draft.scenario.channels.includes(input.dataset.reviewChannel);
        showToast("Practice formats stay fixed when revising a published conversation. Start a copy to change formats.");
        return;
      }
      const channels = $$("[data-review-channel]")
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.dataset.reviewChannel);
      if (!channels.length) {
        input.checked = true;
        showToast("Keep at least one practice channel selected.");
        return;
      }
      state.draft.scenario.channels = channels;
      setDirty();
      renderChannelVisibility();
    });
  });
  $$("[data-add-list]").forEach((button) => {
    button.addEventListener("click", () => addListItem(button.dataset.addList));
  });
  elements.addPhaseButton.addEventListener("click", addConversationPhase);
  $$('input[name="standardTextMode"]').forEach((input) => {
    input.addEventListener("change", () =>
      setStandardTextMode(input.value, { applyDefault: true })
    );
  });
  elements.hotkeySearchInput.addEventListener("input", renderHotkeys);
  elements.addManualHotkeyButton.addEventListener("click", addManualHotkey);
  elements.reviewBackButton.addEventListener("click", () => {
    setStage("create");
  });
  elements.reviewContinueButton.addEventListener("click", async () => {
    const canEnter = handleReviewTestEntry({
      canEnter: reviewIsComplete() && state.validation?.ok === true,
      onBlocked: () => {
        revealReviewBlockingIssues();
        showToast(reviewIsComplete()
          ? "Validate the conversation before downloading."
          : "Complete the highlighted phase details before downloading.");
      }
    });
    if (!canEnter) return;
    state.draft = normalizePhaseAuthoringDraft(state.draft);
    await saveDraft({ quiet: true });
    setStage("validate");
  });
  elements.previewChannelSelect?.addEventListener("change", () => {
    closePreview("Channel changed. Start a new tuned preview.");
    updatePreviewButtonLabel();
  });
  elements.playPreviewButton?.addEventListener("click", startPreview);
  elements.learnerForm?.addEventListener("submit", sendLearnerMessage);
  elements.learnerMessage?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.learnerForm?.requestSubmit();
    }
  });
  elements.testEditButton?.addEventListener("click", () => {
    closePreview("");
    setStage("review");
  });
  elements.testPublishButton?.addEventListener("click", async () => {
    closePreview("");
    await saveDraft({ quiet: true });
    handlePublishContinueEntry({
      canEnter: canEnterPublish(state.draft) && state.validation?.ok === true,
      onBlocked: () => {
        setStage("review");
        elements.reviewFinalCheck?.scrollIntoView({ behavior: "smooth", block: "center" });
        elements.validateButton.focus({ preventScroll: true });
        showToast(state.validation
          ? "Fix the validation items before publishing."
          : "Validate the conversation before publishing.");
      },
      onEnter: () => setStage("validate")
    });
  });
  elements.validateButton.addEventListener("click", runValidation);
  elements.savePersistentDraftButton.addEventListener("click", async () => {
    elements.savePersistentDraftButton.disabled = true;
    elements.publishStatus.textContent = "Saving draft…";
    const result = await persistCurrentDraft({ status: "draft" });
    if (!result.saved && !result.conflict && result.error) {
      showToast("Draft could not be saved. Try again.");
    }
    elements.savePersistentDraftButton.disabled = false;
  });
  elements.downloadChatJsonButton.addEventListener("click", () => downloadPortableScenario("chat"));
  elements.downloadVoiceJsonButton.addEventListener("click", () => downloadPortableScenario("voice"));
  elements.copyJsonButton.addEventListener("click", copyPortableScenarioJson);
  elements.reloadPersistentDraftButton.addEventListener("click", async () => {
    const draftId = state.draftId || state.draft?.draftId;
    if (!draftId) return;
    try {
      await openPersistentDraftConversation({ source: "draft", draftId });
      clearDraftConflict();
    } catch (error) {
      elements.draftConflictMessage.textContent = String(error?.message || error);
    }
  });
  elements.releaseNoteInput.addEventListener("input", () => {
    state.releaseNote = elements.releaseNoteInput.value.slice(0, 240);
    state.publishComplete = false;
    elements.publishStatus.textContent = "";
    renderPublishGate();
  });
  elements.publishButton.addEventListener("click", publishScenario);
  window.addEventListener("beforeunload", (event) => {
    const hasUnsavedBuildInput = !state.reviewStarted && hasBuildInputWork();
    const publishRecoveryPending = publishInteractionIsLocked(state);
    if (
      !publishRecoveryPending &&
      (!state.draft || equal(state.draft, state.savedDraft)) &&
      !hasUnsavedBuildInput
    ) return;
    event.preventDefault();
  });
  window.addEventListener("pagehide", () => {
    clearGuidanceImageObjectUrls();
    clearPortableDownloadObjectUrls();
    scenarioAssetLoader.clear();
  });
}

function normalizeBootstrapHotkeys(data) {
  const source = data?.hotkeys || data?.standardText || data?.standardTextLibrary || [];
  const items = Array.isArray(source)
    ? source
    : [
        ...(Array.isArray(source.recommended)
          ? source.recommended.map((item) => ({ ...item, recommended: true }))
          : []),
        ...(Array.isArray(source.library) ? source.library : []),
        ...(Array.isArray(source.items) ? source.items : []),
        ...(Array.isArray(source.records) ? source.records : [])
      ];
  const uniqueEntries = new Map();
  items.map(normalizeHotkey).filter(Boolean).forEach((item) => {
    const key = `${item.hotkey}\u0000${item.category}\u0000${item.template}`;
    if (!uniqueEntries.has(key)) uniqueEntries.set(key, item);
  });
  return [...uniqueEntries.values()];
}

async function bootstrap() {
  wireControls();
  $$('[data-tooltip]').forEach((control) => {
    if (!control.title) control.title = control.dataset.tooltip || "";
  });
  fillVoiceSelect(elements.reviewVoiceSelect, "marin");
  initializeFreshConversation();
  state.apiBase = "/api";
  state.apiSource = "Conversation Simulator Site";
  state.hotkeys = [];
  state.standardTextMode = "none";
  try {
    const hotkeys = await requestJson("/builder-studio/assets/hotkey-library.json");
    state.hotkeys = normalizeBootstrapHotkeys({ hotkeys });
  } catch {
    state.hotkeys = [];
  }
  const saved = loadSavedDraftSafely();
  if (saved?.draft) {
    state.draft = normalizeStudioDraft(saved.draft);
    state.sourceGrounding = clone(state.draft.sourceGrounding);
    state.currentDraftActive = true;
    state.currentDraftUpdatedAt = saved.savedAt || state.draft.updatedAt;
    state.draftId = state.draft.draftId;
    resetReviewProgress();
    resetPublicationContext();
    renderCreateSummary();
    renderReview();
    const prepared = prepareStandardTextMode({ draft: state.draft });
    state.standardTextMode = prepared.mode;
    setStandardTextMode(prepared.mode);
    updateSavedState({ draftId: state.draftId });
    setBuilderView("workflow", { focus: false });
    setStage("review", { preserveScroll: true });
    showToast("Saved draft restored in Review/Edit.");
  } else {
    setStandardTextMode("none");
    updateSavedState({ draftId: state.draftId });
    setBuilderView("workflow", { focus: false });
    setStage("create", { preserveScroll: true });
  }
  if (elements.noApiNotice) elements.noApiNotice.hidden = true;
  setGlobalStatus("");
}

if (browserDocument) {
  bootstrap();
}
