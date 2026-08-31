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
      if (findPrivacyIssues(content).length > 0) {
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
      const draft = normalizeDraft(content, input);
      return Response.json(
        { draft, assumptions: [...content.assumptions, ...((sourcePrivacyIssues.length > 0 || directPrivacyIssues.length > 0) ? ["Sensitive-looking details in the uploaded JSON were withheld from AI. Review and replace every flagged value before downloading."] : [])] },
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
    agentType: value.agentType === "Rx" ? "Rx" : "Core",
    sourceDraft,
  };
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
  if (!Array.isArray(value.objectives) || value.objectives.length === 0) throw new Error("invalid_generated_content");
  if (!value.compatibilityFacts || !["address", "medication", "urgency", "medicationOrProduct", "clinic", "keyQuestion", "rootCauseBelief", "conditionalFollowUp"].every((key) => typeof value.compatibilityFacts[key as keyof StudioDraft["compatibilityFacts"]] === "string")) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.assumptions)) throw new Error("invalid_generated_content");
}

function normalizeDraft(content: GeneratedContent, input: GenerateRequest): StudioDraft {
  const preserveImportedSettings = input.mode === "improve" && input.sourceDraft;
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
  return {
    baseId,
    title: content.title.trim(),
    description: content.description.trim(),
    learnerGoal: content.learnerGoal.trim(),
    channels: orderedChannels(input.channels),
    agentType: content.agentType,
    topic: content.topic.trim(),
    subtopic: content.subtopic.trim(),
    teamAudience: content.teamAudience.trim(),
    customer: content.customer,
    correctProcess: input.sourceDraft?.objectiveApprovalRequired
      ? uniqueStrings([...sanitizeSimilarSourceLines(input.sourceDraft.correctProcess), ...content.correctProcess])
      : content.correctProcess,
    prohibitedActions: input.sourceDraft
      ? uniqueStrings([
          ...(input.mode === "similar" ? sanitizeSimilarSourceLines(input.sourceDraft.prohibitedActions) : input.sourceDraft.prohibitedActions),
          ...content.prohibitedActions,
        ])
      : content.prohibitedActions,
    phases: content.phases.map((phase, index) => {
      const sourcePhase = preserveImportedSettings
        ? input.sourceDraft!.phases?.find((candidate) => candidate.id === phase.id) || input.sourceDraft!.phases?.[index]
        : undefined;
      return {
        ...phase,
        ...(sourcePhase?.guideSourceLabel !== undefined ? { guideSourceLabel: sourcePhase.guideSourceLabel } : {}),
        ...(sourcePhase?.guideSource !== undefined ? { guideSource: sourcePhase.guideSource } : {}),
        ...(sourcePhase?.guideTitle !== undefined ? { guideTitle: sourcePhase.guideTitle } : {}),
        ...(sourcePhase?.guideBody !== undefined ? { guideBody: sourcePhase.guideBody } : {}),
        ...(sourcePhase?.managerGuidance !== undefined ? { managerGuidance: sourcePhase.managerGuidance } : {}),
      };
    }),
    objectives: content.objectives,
    objectiveApprovalRequired: Boolean(input.sourceDraft?.objectiveApprovalRequired),
    compatibilityFacts: preserveImportedSettings
      ? input.sourceDraft!.compatibilityFacts ?? content.compatibilityFacts
      : content.compatibilityFacts,
    chat: preserveImportedSettings
      ? input.sourceDraft!.chat
      : { hotkeyProfile: content.agentType === "Rx" ? "rx" : "core", standardText: [], standardTextDecision: "unreviewed", standardTextRecommendations },
    voice: preserveImportedSettings
      ? input.sourceDraft!.voice
      : { selectedVoice: "marin", speed: 1, experience: createDefaultVoiceExperience(content.customer.tone) },
    ...(preserveImportedSettings && input.sourceDraft!.sourceScenarios
      ? { sourceScenarios: input.sourceDraft!.sourceScenarios, sourceOverlay: true }
      : {}),
  };
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "cache-control": "no-store" } },
  );
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
Make each objective observable and each phase response-ordered. Keep customer responses natural and concise.
Set customerRemainsSilent to true only for a final learner-only action after which the customer must not reply; otherwise set it to false.
Create distinct keyQuestion, rootCauseBelief, urgency, medication/product, clinic, address, and conditionalFollowUp facts. Use empty strings only when a fact truly does not apply.
Repeat every prohibited action in neutral imperative wording in both an objective criterion and the relevant Coach Chewy guidance.
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
        required: ["id", "title", "learnerActions", "partnerResponse", "coachGuidance", "customerRemainsSilent"],
        properties: { id: { type: "string", pattern: "^[a-z0-9]+(?:_[a-z0-9]+)*$" }, title: { type: "string" }, learnerActions: stringArray, partnerResponse: { type: "string" }, coachGuidance: stringArray, customerRemainsSilent: { type: "boolean" } },
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
