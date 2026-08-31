import { BodyTooLargeError, readBodyBounded } from "./bounded-body";
import { findPrivacyIssues, redactPrivacyText, redactPrivacyValues } from "./privacy";
import type {
  Channel,
  CustomerDraft,
  ObjectiveDraft,
  PhaseDraft,
  StudioDraft,
} from "./scenario-contract";
import { createDefaultVoiceExperience } from "./scenario-contract";
import {
  customerBehaviorRuleConflictsWithLearner,
  customerBehaviorRuleHasNegativeLearnerPolarity,
  customerBehaviorRuleToNegativeGuardrail,
  findChatAdvanceRequirementQualityFindings,
  hasDeterministicResolutionText,
  isNondeterministicResolutionText,
} from "./scenario-quality-guards";
import { parseStudioDraft } from "./scenario-validation";
import { recommendImportedStandardText, recommendStandardText } from "./standard-text-recommendations";

type GenerateMode = "new" | "improve" | "similar";

interface GenerateRequest {
  mode: GenerateMode;
  deidentificationConfirmed: boolean;
  channels: Channel[];
  situation: string;
  learnerGoal?: string;
  correctProcess?: string;
  agentType?: "Core" | "Rx";
  sourceDraft?: StudioDraft;
}

interface GeneratedContent {
  title: string;
  description: string;
  learnerGoal: string;
  agentType: "Core" | "Rx";
  topic: string;
  subtopic: string;
  teamAudience: string;
  customer: CustomerDraft;
  correctProcess: string[];
  prohibitedActions: string[];
  phases: PhaseDraft[];
  objectives: ObjectiveDraft[];
  compatibilityFacts: StudioDraft["compatibilityFacts"];
  assumptions: string[];
}

interface GenerateHandlerOptions {
  apiKey?: string;
  model?: string;
  runtimeEnv?: {
    OPENAI_API_KEY?: string;
    OPENAI_AUTHORING_MODEL?: string;
  };
  fetchImpl?: typeof fetch;
  logError?: (diagnostic: GenerationDiagnostic) => void;
}

interface GenerationDiagnostic {
  stage: "provider_request" | "provider_response_body" | "provider_response" | "provider_output" | "draft_normalization";
  providerStatus?: number;
  providerErrorCode?: string;
  providerRequestId?: string;
  errorName?: string;
  errorMessage?: string;
}

const MAX_REQUEST_BYTES = 1_500_000;
const MAX_PROVIDER_BYTES = 200_000;
const DEFAULT_MODEL = "gpt-5-mini";
const MISSING_POLICY_MARKER = "MISSING_POLICY";
const APPROVED_RESOLUTION_ERROR = {
  code: "approved_resolution_required",
  message: "Describe the exact approved action and expected outcome before Coach Chewy builds the draft.",
} as const;

export function createGenerateHandler(options: GenerateHandlerOptions = {}) {
  const apiKey = (options.apiKey ?? options.runtimeEnv?.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "").replace(/\s+/g, "");
  const model = options.model ?? options.runtimeEnv?.OPENAI_AUTHORING_MODEL ?? process.env.OPENAI_AUTHORING_MODEL ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logError = options.logError ?? (() => {});

  return async function generate(request: Request): Promise<Response> {
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return errorResponse(415, "unsupported_media_type", "Send builder details as application/json.");
    }
    let raw: string;
    try {
      raw = await readBodyBounded(request, MAX_REQUEST_BYTES);
    } catch (caught) {
      if (caught instanceof BodyTooLargeError) {
        return errorResponse(413, "request_too_large", "The builder input is too large. Shorten it and try again.");
      }
      return errorResponse(400, "invalid_request", "Send valid builder details.");
    }

    let input: GenerateRequest;
    try {
      input = parseRequest(raw);
    } catch {
      return errorResponse(400, "invalid_request", "Send valid builder details.");
    }

    if (!input.deidentificationConfirmed) {
      return errorResponse(400, "confirmation_required", "Confirm that the content is fictional or de-identified before generating.");
    }

    const hasServerApprovedNewResolution = Boolean(
      input.mode === "new"
      && input.correctProcess
      && hasDeterministicResolutionText(input.correctProcess)
      && !isNondeterministicResolutionText(input.correctProcess),
    );
    if (input.mode === "new" && !hasServerApprovedNewResolution) {
      return approvedResolutionRequiredResponse();
    }

    const sourcePrivacyIssues = input.sourceDraft ? findPrivacyIssues(input.sourceDraft) : [];
    const directPrivacyIssues = findPrivacyIssues({ ...input, sourceDraft: undefined });
    if (!input.sourceDraft && directPrivacyIssues.length > 0) {
      return errorResponse(400, "privacy_blocked", "Remove personal contact, address, payment, or service details before generating.", directPrivacyIssues);
    }

    if (!apiKey) {
      return errorResponse(503, "generation_not_configured", "AI generation is not configured for this Site yet.");
    }

    let failureStage: GenerationDiagnostic["stage"] = "provider_request";
    try {
      const providerInput = input.sourceDraft
        ? redactPrivacyValues({ ...input, sourceDraft: stripSourceEnvelope(input.sourceDraft) })
        : input;
      const provider = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            {
              role: "developer",
              content: [{ type: "input_text", text: AUTHORING_INSTRUCTIONS }],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: JSON.stringify(providerInput) }],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "conversation_builder_draft",
              strict: true,
              schema: GENERATED_CONTENT_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });

      failureStage = "provider_response_body";
      const providerRaw = await readBodyBounded(provider, MAX_PROVIDER_BYTES);
      if (!provider.ok) {
        const providerRequestId = provider.headers.get("x-request-id") || undefined;
        logError({
          stage: "provider_response",
          providerStatus: provider.status,
          providerErrorCode: providerErrorCode(providerRaw),
          ...(providerRequestId ? { providerRequestId } : {}),
        });
        return errorResponse(502, "generation_unavailable", "Coach Chewy could not create a draft. Check the details and try again.");
      }
      failureStage = "provider_output";
      const content = sanitizeProviderOutput(parseProviderOutput(providerRaw));
      const missingPolicyPattern = new RegExp(`^${MISSING_POLICY_MARKER}(?:\\s*:|\\s*$)`, "i");
      const providerMarkedPolicyMissing = content.assumptions.some((assumption) =>
        missingPolicyPattern.test(assumption.trim())
      );
      if (providerMarkedPolicyMissing && !hasServerApprovedNewResolution) {
        return approvedResolutionRequiredResponse();
      }
      const groundedContent = providerMarkedPolicyMissing
        ? {
            ...content,
            assumptions: content.assumptions.filter((assumption) =>
              !missingPolicyPattern.test(assumption.trim())
            ),
          }
        : content;
      if (findPrivacyIssues(groundedContent).length > 0) {
        logError({
          stage: "provider_output",
          errorName: "Error",
          errorMessage: "unsafe_provider_output",
        });
        return errorResponse(
          502,
          "unsafe_provider_output",
          "Coach Chewy created a draft with sensitive-looking details that could not be safely replaced. Try again.",
        );
      }

      failureStage = "draft_normalization";
      const draft = normalizeDraft(groundedContent, input);
      return Response.json(
        { draft, assumptions: [...groundedContent.assumptions, ...((sourcePrivacyIssues.length > 0 || directPrivacyIssues.length > 0) ? ["Sensitive-looking details in the uploaded JSON were withheld from AI. Review and replace every flagged value before downloading."] : [])] },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (caught) {
      logError({
        stage: failureStage,
        errorName: caught instanceof Error ? caught.name : "UnknownError",
        errorMessage: safeErrorMessage(caught),
      });
      if (caught instanceof Error && caught.name === "TimeoutError") {
        return errorResponse(504, "generation_timeout", "Coach Chewy took too long to create the draft. Try again.");
      }
      return errorResponse(502, "generation_unavailable", "Coach Chewy could not create a draft. Check the details and try again.");
    }
  };
}

function sanitizeProviderOutput(content: GeneratedContent): GeneratedContent {
  return sanitizeProviderValue(content) as GeneratedContent;
}

function sanitizeProviderValue(value: unknown): unknown {
  if (typeof value === "string") return redactPrivacyText(value);
  if (Array.isArray(value)) return value.map(sanitizeProviderValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeProviderValue(entry)]),
  );
}

function providerErrorCode(raw: string): string {
  try {
    const payload = JSON.parse(raw) as { error?: { code?: unknown } };
    return typeof payload.error?.code === "string" ? payload.error.code.slice(0, 100) : "unknown";
  } catch {
    return "unknown";
  }
}

function safeErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]").slice(0, 300);
}

function parseRequest(raw: string): GenerateRequest {
  const value = JSON.parse(raw) as Partial<GenerateRequest>;
  const channels = Array.isArray(value.channels)
    ? [...new Set(value.channels.filter(isChannel))]
    : [];
  if (!isMode(value.mode) || channels.length === 0 || !nonempty(value.situation)) {
    throw new Error("invalid_request");
  }
  const sourceDraft = value.sourceDraft == null ? undefined : parseStudioDraft(value.sourceDraft);
  if (value.sourceDraft != null && !sourceDraft) throw new Error("invalid_request");
  return {
    mode: value.mode,
    deidentificationConfirmed: value.deidentificationConfirmed === true,
    channels,
    situation: value.situation.trim(),
    learnerGoal: cleanOptional(value.learnerGoal),
    correctProcess: cleanOptional(value.correctProcess),
    agentType: inferredAgentType(value),
    sourceDraft,
  };
}

const RX_SOURCE_PATTERN = /\b(rx|pharmacy|prescription|medication|clinic|veterinar(?:y|ian))\b/iu;

function inferredAgentType(value: Partial<GenerateRequest>): "Core" | "Rx" {
  const material = [value.situation, value.learnerGoal, value.correctProcess]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ");
  return value.agentType === "Rx" || RX_SOURCE_PATTERN.test(material) ? "Rx" : "Core";
}

function parseProviderOutput(raw: string): GeneratedContent {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const texts = output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    return content
      .filter((entry) => entry.type === "output_text" && typeof entry.text === "string")
      .map((entry) => String(entry.text));
  });
  if (texts.length !== 1) throw new Error("invalid_provider_output");
  const generated = JSON.parse(texts[0]) as GeneratedContent;
  assertGeneratedContent(generated);
  return generated;
}

function assertGeneratedContent(value: GeneratedContent): void {
  if (!value || typeof value !== "object") throw new Error("invalid_generated_content");
  const strings = [value.title, value.description, value.learnerGoal, value.topic, value.subtopic, value.teamAudience];
  if (strings.some((entry) => !nonempty(entry))) throw new Error("invalid_generated_content");
  if (value.agentType !== "Core" && value.agentType !== "Rx") throw new Error("invalid_generated_content");
  if (!value.customer || !nonempty(value.customer.name) || !nonempty(value.customer.openingLine)) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.correctProcess) || value.correctProcess.length === 0) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.phases) || value.phases.length === 0) throw new Error("invalid_generated_content");
  if (value.phases.some((phase) => {
    if (!Array.isArray(phase.chatAdvanceRequirements) || phase.chatAdvanceRequirements.length === 0) return true;
    if (phase.chatAdvanceRequirements.some((requirement) =>
      !requirement
      || typeof requirement.id !== "string"
      || !Array.isArray(requirement.phrases)
      || requirement.phrases.some((phrase) => typeof phrase !== "string")
    )) return true;
    return findChatAdvanceRequirementQualityFindings(
      phase.chatAdvanceRequirements,
      value.prohibitedActions,
    ).length > 0;
  })) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.objectives) || value.objectives.length === 0) throw new Error("invalid_generated_content");
  if (!value.compatibilityFacts || !["address", "medication", "urgency", "medicationOrProduct", "clinic", "keyQuestion", "rootCauseBelief", "conditionalFollowUp"].every((key) => typeof value.compatibilityFacts[key as keyof StudioDraft["compatibilityFacts"]] === "string")) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.assumptions)) throw new Error("invalid_generated_content");
}

function normalizeDraft(content: GeneratedContent, input: GenerateRequest): StudioDraft {
  const preserveImportedSettings = input.mode === "improve" && input.sourceDraft;
  const authoringAgentType = preserveImportedSettings
    ? input.sourceDraft!.agentType
    : input.agentType;
  const generatedBaseId = slug(content.title);
  const baseId = preserveImportedSettings
    ? input.sourceDraft!.baseId
    : input.mode === "similar" && input.sourceDraft?.objectiveApprovalRequired
      ? input.sourceDraft.baseId
      : input.mode === "similar" && input.sourceDraft && generatedBaseId === input.sourceDraft.baseId
        ? `${generatedBaseId}_copy`
        : generatedBaseId;
  const standardTextRecommendations = input.channels.includes("chat")
    ? input.sourceDraft
      ? recommendImportedStandardText(input.sourceDraft.chat.standardText, input.sourceDraft.chat.hotkeyProfile)
      : recommendStandardText(content)
    : [];
  const conflictingCustomerRules = content.customer.behaviorRules.filter(customerBehaviorRuleConflictsWithLearner);
  const guardrailMigrations = conflictingCustomerRules.map((rule) => ({
    rule,
    guardrail: customerBehaviorRuleToNegativeGuardrail(rule),
  }));
  if (guardrailMigrations.some(({ rule, guardrail }) =>
    !guardrail && customerBehaviorRuleHasNegativeLearnerPolarity(rule)
  )) {
    throw new Error("invalid_generated_content");
  }
  const migratedCustomerGuardrails = guardrailMigrations.map(({ guardrail }) => guardrail).filter(nonempty);
  const generatedProhibitedActionMap = new Map(content.prohibitedActions.map((action) => [
    generatedProhibitedActionBodyKey(action),
    normalizeGeneratedProhibitedAction(action),
  ]));
  const generatedProhibitedActions = [...generatedProhibitedActionMap.values()];
  const normalizeProhibitedEcho = (value: string) =>
    generatedProhibitedActionMap.get(generatedProhibitedActionBodyKey(value)) || value;
  const customer = {
    ...content.customer,
    behaviorRules: content.customer.behaviorRules.filter((rule) => !customerBehaviorRuleConflictsWithLearner(rule)),
  };
  return {
    baseId,
    title: content.title.trim(),
    description: content.description.trim(),
    learnerGoal: content.learnerGoal.trim(),
    channels: orderedChannels(input.channels),
    agentType: authoringAgentType,
    topic: content.topic.trim(),
    subtopic: content.subtopic.trim(),
    teamAudience: content.teamAudience.trim(),
    customer,
    correctProcess: input.mode === "new" && input.correctProcess
      ? [input.correctProcess]
      : input.sourceDraft?.objectiveApprovalRequired
        ? uniqueStrings([
            ...sanitizeSimilarSourceLines(input.sourceDraft.correctProcess),
            ...content.correctProcess.map(normalizeProhibitedEcho),
          ])
        : content.correctProcess.map(normalizeProhibitedEcho),
    prohibitedActions: input.sourceDraft
      ? uniqueStrings([
          ...(input.mode === "similar" ? sanitizeSimilarSourceLines(input.sourceDraft.prohibitedActions) : input.sourceDraft.prohibitedActions),
          ...generatedProhibitedActions,
          ...migratedCustomerGuardrails,
        ])
      : uniqueStrings([
          ...generatedProhibitedActions,
          ...migratedCustomerGuardrails,
        ]),
    phases: content.phases.map((phase, index) => {
      const sourcePhase = preserveImportedSettings
        ? input.sourceDraft!.phases?.find((candidate) => candidate.id === phase.id) || input.sourceDraft!.phases?.[index]
        : undefined;
      return {
        ...phase,
        learnerActions: phase.learnerActions.map(normalizeProhibitedEcho),
        coachGuidance: phase.coachGuidance.map(normalizeProhibitedEcho),
        ...(sourcePhase?.guideSourceLabel !== undefined ? { guideSourceLabel: sourcePhase.guideSourceLabel } : {}),
        ...(sourcePhase?.guideSource !== undefined ? { guideSource: sourcePhase.guideSource } : {}),
        ...(sourcePhase?.guideTitle !== undefined ? { guideTitle: sourcePhase.guideTitle } : {}),
        ...(sourcePhase?.guideBody !== undefined ? { guideBody: sourcePhase.guideBody } : {}),
        ...(sourcePhase?.managerGuidance !== undefined ? { managerGuidance: sourcePhase.managerGuidance } : {}),
      };
    }),
    objectives: normalizeGeneratedObjectives(content.objectives.map((objective) => ({
      ...objective,
      criteria: objective.criteria.map(normalizeProhibitedEcho),
    }))),
    objectiveApprovalRequired: Boolean(input.sourceDraft?.objectiveApprovalRequired),
    evaluation: preserveImportedSettings && input.sourceDraft!.evaluation
      ? structuredClone(input.sourceDraft!.evaluation)
      : { passingScore: 100 },
    compatibilityFacts: preserveImportedSettings
      ? input.sourceDraft!.compatibilityFacts ?? content.compatibilityFacts
      : content.compatibilityFacts,
    chat: preserveImportedSettings
      ? input.sourceDraft!.chat
      : { hotkeyProfile: authoringAgentType === "Rx" ? "rx" : "core", standardText: [], standardTextDecision: "unreviewed", standardTextRecommendations },
    voice: preserveImportedSettings
      ? input.sourceDraft!.voice
      : { selectedVoice: "marin", speed: 1, experience: createDefaultVoiceExperience(content.customer.tone) },
    ...(preserveImportedSettings && input.sourceDraft!.sourceScenarios
      ? { sourceScenarios: input.sourceDraft!.sourceScenarios, sourceOverlay: true }
      : {}),
  };
}

const GENERATED_IMPERATIVE_FORMS = new Map([
  ["acknowledges", "Acknowledge"], ["asks", "Ask"], ["avoids", "Avoid"], ["checks", "Check"],
  ["clarifies", "Clarify"], ["communicates", "Communicate"], ["completes", "Complete"], ["confirms", "Confirm"],
  ["connects", "Connect"], ["continues", "Continue"], ["describes", "Describe"], ["determines", "Determine"],
  ["directs", "Direct"], ["distinguishes", "Distinguish"], ["does", "Do"], ["ends", "End"],
  ["explains", "Explain"], ["expresses", "Express"], ["focuses", "Focus"], ["gives", "Give"], ["highlights", "Highlight"],
  ["identifies", "Identify"], ["includes", "Include"], ["informs", "Inform"], ["introduces", "Introduce"], ["issues", "Issue"], ["keeps", "Keep"],
  ["maintains", "Maintain"], ["mentions", "Mention"], ["obtains", "Obtain"], ["offers", "Offer"],
  ["pauses", "Pause"], ["personalizes", "Personalize"], ["positions", "Position"], ["presents", "Present"],
  ["protects", "Protect"], ["provides", "Provide"], ["reads", "Read"], ["reassures", "Reassure"],
  ["recaps", "Recap"], ["recognizes", "Recognize"], ["remains", "Remain"], ["requests", "Request"],
  ["requires", "Require"], ["responds", "Respond"], ["restates", "Restate"], ["reviews", "Review"],
  ["selects", "Select"], ["shares", "Share"], ["shows", "Show"], ["states", "State"],
  ["stops", "Stop"], ["takes", "Take"], ["thanks", "Thank"], ["updates", "Update"],
  ["uses", "Use"], ["verifies", "Verify"], ["waits", "Wait"],
]);

const GENERATED_GERUND_FORMS = new Map([
  ["acknowledging", "Acknowledge"], ["asking", "Ask"], ["avoiding", "Avoid"], ["checking", "Check"],
  ["clarifying", "Clarify"], ["communicating", "Communicate"], ["confirming", "Confirm"], ["explaining", "Explain"], ["expressing", "Express"],
  ["identifying", "Identify"], ["informing", "Inform"], ["issuing", "Issue"], ["offering", "Offer"],
  ["processing", "Process"], ["providing", "Provide"], ["recapping", "Recap"], ["stating", "State"],
  ["thanking", "Thank"], ["verifying", "Verify"],
]);

const GENERATED_IMPERATIVE_BASES = new Set(
  [...GENERATED_IMPERATIVE_FORMS.values(), ...GENERATED_GERUND_FORMS.values()].map((value) => value.toLowerCase()),
);

const GENERATED_DIRECT_NEGATIVE_ACTION_PATTERN = /^\s*(?:do\s+not|don['’]t|must\s+not|never|refrain(?:\s+from)?)\s+(.+?)\s*$/iu;
const GENERATED_DIRECT_AVOID_ACTION_PATTERN = /^\s*(?:avoid|no)\s+(.+?)\s*$/iu;
const GENERATED_SUBJECT_NEGATIVE_ACTION_PATTERN = new RegExp(
  String.raw`^\s*(?:(?:the|a)\s+)?(?:learner|agent|representative|chewy (?:agent|representative))\s+(?:(?:(?:must|should|will|can|could|would|may|shall|does?)\s+(?:not|never))|cannot|can['’]t|doesn['’]t|won['’]t|(?:could|would|should|must|shall)n['’]t|never)\s+(.+?)\s*$`,
  "iu",
);
const GENERATED_SUBJECT_AVOID_ACTION_PATTERN = new RegExp(
  String.raw`^\s*(?:(?:the|a)\s+)?(?:learner|agent|representative|chewy (?:agent|representative))\s+(?:(?:must|should|will|can|could|would|may|shall)\s+)?avoid(?:s|ing)?\s+(.+?)\s*$`,
  "iu",
);

function generatedNegativeAction(value: string): { action: string; style: "avoid" | "do_not" } | null {
  const subjectNegative = value.match(GENERATED_SUBJECT_NEGATIVE_ACTION_PATTERN);
  if (subjectNegative) return { action: subjectNegative[1], style: "do_not" };

  const subjectAvoid = value.match(GENERATED_SUBJECT_AVOID_ACTION_PATTERN);
  if (subjectAvoid) return { action: subjectAvoid[1], style: "avoid" };

  const directNegative = value.match(GENERATED_DIRECT_NEGATIVE_ACTION_PATTERN);
  if (directNegative) return { action: directNegative[1], style: "do_not" };

  const directAvoid = value.match(GENERATED_DIRECT_AVOID_ACTION_PATTERN);
  if (directAvoid) return { action: directAvoid[1], style: "avoid" };

  return null;
}

function normalizedGeneratedAction(value: string): { action: string; punctuation: string } {
  const trimmed = value.trim();
  const punctuation = trimmed.match(/[.!?]$/u)?.[0] || ".";
  const action = normalizeGeneratedCriterion(trimmed.replace(/[.!?]+$/u, "")).trim();
  return { action, punctuation };
}

function generatedProhibitedActionBodyKey(value: string): string {
  const parsed = generatedNegativeAction(value);
  const { action } = normalizedGeneratedAction(parsed?.action || value);
  return action
    .replace(/\brather\s+than\b/giu, "instead of")
    .toLowerCase()
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeGeneratedProhibitedAction(value: string): string {
  const parsed = generatedNegativeAction(value);
  if (parsed?.style === "avoid") {
    const trimmedAction = parsed.action.trim();
    const punctuation = trimmedAction.match(/[.!?]$/u)?.[0] || ".";
    const action = trimmedAction.replace(/[.!?]+$/u, "").trim();
    return action
      ? `Avoid ${action.replace(/^./u, (character) => character.toLowerCase())}${punctuation}`
      : "";
  }
  const { action, punctuation } = normalizedGeneratedAction(parsed?.action || value);
  if (!action) return "";
  const lowerAction = action.replace(/^./u, (character) => character.toLowerCase());
  return `Do not ${lowerAction}${punctuation}`;
}

function normalizeGeneratedCriterion(value: string): string {
  const criterion = value.trim().replace(
    /^\s*(?:(?:the\s+)?(?:learner|agent|representative)\s+)(?:(?:must|should|will|can)\s+)?/i,
    "",
  );
  const words = criterion.match(/^([A-Za-z-]+)(?:\s+([A-Za-z-]+))?(.*)$/);
  if (!words) return criterion;
  const first = words[1].toLowerCase();
  if (GENERATED_IMPERATIVE_BASES.has(first) || first === "never") return criterion;

  const direct = GENERATED_IMPERATIVE_FORMS.get(first);
  if (direct) return `${direct}${criterion.slice(words[1].length)}`;

  const gerund = GENERATED_GERUND_FORMS.get(first);
  if (gerund) return `${gerund}${criterion.slice(words[1].length)}`;

  const second = String(words[2] || "").toLowerCase();
  const adverbial = first.endsWith("ly") ? GENERATED_IMPERATIVE_FORMS.get(second) : undefined;
  if (adverbial) return `${adverbial} ${words[1].toLowerCase()}${words[3] || ""}`;

  return criterion;
}

function normalizeGeneratedObjectives(objectives: ObjectiveDraft[]): ObjectiveDraft[] {
  const usedIds = new Set<string>();
  return objectives.map((objective, index) => {
    const genericId = /^(?:obj(?:ective)?)[_-]?\d+$/i.test(objective.id.trim());
    const baseId = slug(genericId ? objective.label : objective.id) || `objective_${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      ...objective,
      id,
      criteria: objective.criteria.map(normalizeGeneratedCriterion),
    };
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function approvedResolutionRequiredResponse(): Response {
  return errorResponse(422, APPROVED_RESOLUTION_ERROR.code, APPROVED_RESOLUTION_ERROR.message);
}

function cleanOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripSourceEnvelope(draft: StudioDraft): Omit<StudioDraft, "sourceScenarios" | "sourceOverlay"> {
  return {
    baseId: draft.baseId,
    title: draft.title,
    description: draft.description,
    learnerGoal: draft.learnerGoal,
    channels: [...draft.channels],
    agentType: draft.agentType,
    topic: draft.topic,
    subtopic: draft.subtopic,
    teamAudience: draft.teamAudience,
    customer: {
      name: draft.customer.name,
      petName: draft.customer.petName,
      tone: draft.customer.tone,
      goal: draft.customer.goal,
      openingLine: draft.customer.openingLine,
      facts: [...draft.customer.facts],
      revealOnlyWhenAsked: [...draft.customer.revealOnlyWhenAsked],
      objections: [...draft.customer.objections],
      behaviorRules: [...draft.customer.behaviorRules],
      conditionalFollowUps: [...draft.customer.conditionalFollowUps],
      closingLine: draft.customer.closingLine,
    },
    correctProcess: [...draft.correctProcess],
    prohibitedActions: [...draft.prohibitedActions],
    phases: draft.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      learnerActions: [...phase.learnerActions],
      partnerResponse: phase.partnerResponse,
      coachGuidance: [...phase.coachGuidance],
      ...(phase.customerRemainsSilent !== undefined ? { customerRemainsSilent: phase.customerRemainsSilent } : {}),
      ...(phase.guideSourceLabel !== undefined ? { guideSourceLabel: phase.guideSourceLabel } : {}),
      ...(phase.guideSource !== undefined ? { guideSource: phase.guideSource } : {}),
      ...(phase.guideTitle !== undefined ? { guideTitle: phase.guideTitle } : {}),
      ...(phase.guideBody !== undefined ? { guideBody: phase.guideBody } : {}),
      ...(phase.managerGuidance !== undefined ? { managerGuidance: phase.managerGuidance } : {}),
    })),
    objectives: draft.objectives.map((objective) => ({ ...objective, criteria: [...objective.criteria] })),
    objectiveApprovalRequired: draft.objectiveApprovalRequired,
    compatibilityFacts: { ...draft.compatibilityFacts },
    chat: {
      hotkeyProfile: draft.chat.hotkeyProfile,
      standardTextDecision: draft.chat.standardTextDecision,
      standardText: draft.chat.standardText.map((item) => ({ ...item, notes: [...item.notes] })),
      ...(draft.chat.standardTextRecommendations
        ? { standardTextRecommendations: draft.chat.standardTextRecommendations.map((item) => ({ ...item, notes: [...item.notes] })) }
        : {}),
    },
    voice: {
      selectedVoice: draft.voice.selectedVoice,
      speed: draft.voice.speed,
      ...(draft.voice.experience ? { experience: structuredClone(draft.voice.experience) } : {}),
    },
  };
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMode(value: unknown): value is GenerateMode {
  return value === "new" || value === "improve" || value === "similar";
}

function isChannel(value: unknown): value is Channel {
  return value === "chat" || value === "voice";
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase() || "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function orderedChannels(channels: Channel[]): Channel[] {
  return (["chat", "voice"] as Channel[]).filter((channel) => channels.includes(channel));
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "conversation_practice";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizeSimilarSourceLines(values: string[]): string[] {
  return values.map(redactPrivacyText);
}

const AUTHORING_INSTRUCTIONS = `You create de-identified Chewy conversation-practice drafts for Articulate Rise.
Return only the requested strict JSON object. Create focused learning-objective evaluation only.
Use fictional names and details. Never invent policy, refunds, delivery guarantees, medical guidance, system access, or customer data.
When a street address is needed, use the visibly fictional placeholder 123 Example Street, Exampletown, PA 00000.
Treat supplied correct-process details as the authority. Surface uncertainty in assumptions.
If the supplied correct-process details do not state one exact authorized action and expected outcome, do not guess. Add exactly MISSING_POLICY as a standalone item in assumptions.
Make each objective observable and each phase response-ordered. Keep customer responses natural and concise.
Each phase.partnerResponse is the new Conversation Partner turn after the Learner completes that phase. It must never repeat customer.openingLine.
Write customer.conditionalFollowUps only as Conversation Partner reactions, objections, or questions. Never assign the Learner's discovery question or Chewy-agent action to the Conversation Partner.
Write customer.behaviorRules only as Conversation Partner reactions, emotional shifts, disclosure boundaries, or role constraints. Never tell the Conversation Partner to issue, process, offer, explain, inform, or perform any Chewy-agent action.
Write one deterministic approved resolution. Never substitute phrases such as available next steps, approved process, locating the package or replacement, or initiate resolution for the exact authorized action and expected outcome.
Never write placeholders such as as per correct process, per approved policy, or according to the approved process. Use the supplied exact amount, destination, timing, and authorized action wherever those details are relevant.
Begin every objective criterion with a neutral imperative action such as Acknowledge, Ask, Explain, Confirm, Avoid, or Recap.
For every phase, create chatAdvanceRequirements with one independently required positive concept per entry. Give each entry two or more short natural learner phrases that express only that concept. A Chat phase advances only when every entry matches. Never use a prohibited option, incidental courtesy, or generic word such as issue, customer, process, thank, or help as positive evidence.
Set customerRemainsSilent to true only for a final learner-only action after which the customer must not reply; otherwise set it to false.
Create distinct keyQuestion, rootCauseBelief, urgency, medication/product, clinic, address, and conditionalFollowUp facts. Use empty strings only when a fact truly does not apply.
Write every prohibited action with explicit negative polarity such as Do not, Avoid, or Never. Repeat that same negative wording in both an objective criterion and the relevant Coach Chewy guidance.
Never omit a prohibited action or guardrail carried by an uploaded source draft.
For improve mode, preserve the source draft's intent and identity. For similar mode, create a distinct scenario inspired by the source.`;

const stringArray = { type: "array", items: { type: "string" } } as const;
const GENERATED_CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "description", "learnerGoal", "agentType", "topic", "subtopic", "teamAudience",
    "customer", "correctProcess", "prohibitedActions", "phases", "objectives", "compatibilityFacts", "assumptions",
  ],
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    learnerGoal: { type: "string" },
    agentType: { type: "string", enum: ["Core", "Rx"] },
    topic: { type: "string" },
    subtopic: { type: "string" },
    teamAudience: { type: "string" },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "petName", "tone", "goal", "openingLine", "facts", "revealOnlyWhenAsked", "objections", "behaviorRules", "conditionalFollowUps", "closingLine"],
      properties: {
        name: { type: "string" }, petName: { type: "string" }, tone: { type: "string" }, goal: { type: "string" },
        openingLine: { type: "string" }, facts: stringArray, revealOnlyWhenAsked: stringArray, objections: stringArray,
        behaviorRules: stringArray, conditionalFollowUps: stringArray, closingLine: { type: "string" },
      },
    },
    correctProcess: stringArray,
    prohibitedActions: stringArray,
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "learnerActions", "chatAdvanceRequirements", "partnerResponse", "coachGuidance", "customerRemainsSilent"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$" },
          title: { type: "string" },
          learnerActions: stringArray,
          chatAdvanceRequirements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "phrases"],
              properties: {
                id: { type: "string", pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$" },
                phrases: { type: "array", minItems: 2, items: { type: "string" } },
              },
            },
          },
          partnerResponse: { type: "string" },
          coachGuidance: stringArray,
          customerRemainsSilent: { type: "boolean" },
        },
      },
    },
    objectives: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description", "criteria"],
        properties: { id: { type: "string", pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$" }, label: { type: "string" }, description: { type: "string" }, criteria: stringArray },
      },
    },
    compatibilityFacts: {
      type: "object",
      additionalProperties: false,
      required: ["address", "medication", "urgency", "medicationOrProduct", "clinic", "keyQuestion", "rootCauseBelief", "conditionalFollowUp"],
      properties: {
        address: { type: "string" },
        medication: { type: "string" },
        urgency: { type: "string" },
        medicationOrProduct: { type: "string" },
        clinic: { type: "string" },
        keyQuestion: { type: "string" },
        rootCauseBelief: { type: "string" },
        conditionalFollowUp: { type: "string" },
      },
    },
    assumptions: { ...stringArray, maxItems: 10 },
  },
} as const;
