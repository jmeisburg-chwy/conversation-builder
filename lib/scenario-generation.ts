import { BodyTooLargeError, readBodyBounded } from "./bounded-body";
import { findPrivacyIssues, redactPrivacyText, redactPrivacyValues } from "./privacy";
import type {
  Channel,
  ChatAdvanceRequirementDraft,
  CustomerDraft,
  ObjectiveDraft,
  PhaseDraft,
  StudioDraft,
} from "./scenario-contract";
import { createDefaultVoiceExperience } from "./scenario-contract";
import {
  chatAdvanceCompilationFailureCode,
  compileSafeChatAdvanceRequirements,
  customerBehaviorRuleConflictsWithLearner,
  customerBehaviorRuleHasNegativeLearnerPolarity,
  customerBehaviorRuleToNegativeGuardrail,
  customerFollowUpContradictsRejectedOption,
  findChatAdvanceRequirementQualityFindings,
  findOperationalCriterionCoverageFindings,
  findOverlappingResolutionProhibitionGroups,
  findPrematureCustomerRevealFindings,
  findPreferenceResponseOrderConflicts,
  hasDeterministicConversationHandlingText,
  learnerActionsDescribeNoCostReplacement,
  removePreansweredPreferenceFromOpening,
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
  repairCodes?: string[];
  repairDetails?: {
    chatPhases: Array<{
      phaseIndex: number;
      findingCodes: string[];
      compilerFailureCode?: string;
    }>;
    operationalCriteria: Array<{
      objectiveIndex: number;
      criterionIndex: number;
      matchingPhaseCount: number;
    }>;
    resolutionBlueprintFailureCode?: string;
  };
}

class RepairableGeneratedContentError extends Error {
  readonly correction: string;
  readonly repairCodes: string[];

  constructor(correction: string, repairCodes: string[]) {
    super("repairable_generated_content");
    this.name = "RepairableGeneratedContentError";
    this.correction = correction;
    this.repairCodes = repairCodes;
  }
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

    const hasServerApprovedNewHandling = Boolean(
      input.mode === "new"
      && input.correctProcess
      && hasDeterministicConversationHandlingText(input.correctProcess),
    );
    if (input.mode === "new" && !hasServerApprovedNewHandling) {
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
    let repairDetails: GenerationDiagnostic["repairDetails"] | undefined;
    try {
      const providerInput = input.sourceDraft
        ? redactPrivacyValues({ ...input, sourceDraft: stripSourceEnvelope(input.sourceDraft) })
        : input;
      let content: GeneratedContent | undefined;
      let correction = "";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        failureStage = "provider_request";
        const developerInstructions = correction
          ? `${AUTHORING_INSTRUCTIONS}\n\nThe previous draft was rejected. ${correction}`
          : AUTHORING_INSTRUCTIONS;
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
                content: [{ type: "input_text", text: developerInstructions }],
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
        try {
          const candidate = sanitizeProviderOutput(parseProviderOutput(providerRaw));
          assertGeneratedContent(candidate);
          const groundedCandidate = groundGeneratedResolutionFacts(candidate, input.correctProcess);
          assertGeneratedContent(groundedCandidate);
          content = groundedCandidate;
          break;
        } catch (caught) {
          if (caught instanceof RepairableGeneratedContentError && attempt === 0) {
            correction = caught.correction;
            continue;
          }
          if (caught instanceof RepairableGeneratedContentError
            && caught.repairCodes.every((code) =>
              code === "chat_advance_requirements"
              || code === "generic_phase_learner_actions"
              || code === "operational_criterion_coverage"
              || code === "overlapping_resolution_prohibitions"
            )) {
            const candidate = sanitizeProviderOutput(parseProviderOutput(providerRaw));
            const resolutionRepaired = caught.repairCodes.includes("overlapping_resolution_prohibitions")
              ? repairGeneratedResolutionProhibitions(candidate)
              : candidate;
            const operationallyRepaired = caught.repairCodes.includes("operational_criterion_coverage")
              ? repairGeneratedMissingOperationalCriteria(resolutionRepaired)
              : resolutionRepaired;
            const repaired = caught.repairCodes.some((code) =>
              code === "chat_advance_requirements" || code === "operational_criterion_coverage"
            )
              ? repairGeneratedChatAdvanceRequirements(
                  operationallyRepaired,
                  caught.repairCodes.includes("operational_criterion_coverage")
                    ? new Set([operationallyRepaired.phases.length - 1])
                    : new Set(),
                )
              : operationallyRepaired;
            repairDetails = safeGeneratedRepairDetails(repaired);
            try {
              assertGeneratedContent(repaired);
              const groundedRepaired = groundGeneratedResolutionFacts(repaired, input.correctProcess);
              assertGeneratedContent(groundedRepaired);
              content = groundedRepaired;
            } catch (repairFailure) {
              const rebuildResult = repairFailure instanceof RepairableGeneratedContentError
                && repairFailure.repairCodes.every((code) =>
                  code === "chat_advance_requirements"
                  || code === "generic_phase_learner_actions"
                  || code === "operational_criterion_coverage"
                )
                ? rebuildGeneratedPhases(resolutionRepaired, input.correctProcess)
                : undefined;
              if (!rebuildResult?.content) {
                if (rebuildResult?.failureCode) {
                  repairDetails = {
                    ...repairDetails,
                    resolutionBlueprintFailureCode: rebuildResult.failureCode,
                  };
                }
                throw repairFailure;
              }
              const rebuilt = rebuildResult.content;
              repairDetails = safeGeneratedRepairDetails(rebuilt);
              assertGeneratedContent(rebuilt);
              const groundedRebuilt = groundGeneratedResolutionFacts(rebuilt, input.correctProcess);
              assertGeneratedContent(groundedRebuilt);
              content = groundedRebuilt;
            }
            break;
          }
          throw caught;
        }
      }
      if (!content) throw new Error("invalid_generated_content");
      const missingPolicyPattern = new RegExp(`^${MISSING_POLICY_MARKER}(?:\\s*:|\\s*$)`, "i");
      const providerMarkedPolicyMissing = content.assumptions.some((assumption) =>
        missingPolicyPattern.test(assumption.trim())
      );
      if (providerMarkedPolicyMissing && !hasServerApprovedNewHandling) {
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
        ...(caught instanceof RepairableGeneratedContentError
          ? { repairCodes: caught.repairCodes }
          : {}),
        ...(repairDetails ? { repairDetails } : {}),
      });
      if (caught instanceof Error && caught.name === "TimeoutError") {
        return errorResponse(504, "generation_timeout", "Coach Chewy took too long to create the draft. Try again.");
      }
      return errorResponse(502, "generation_unavailable", "Coach Chewy could not create a draft. Check the details and try again.");
    }
  };
}

function sanitizeProviderOutput(content: GeneratedContent): GeneratedContent {
  return repairGenericPhaseLearnerActions(sanitizeProviderValue(content) as GeneratedContent);
}

const GENERIC_PHASE_ACTION_WORDS = new Set([
  "acknowledge", "apologize", "ask", "clarify", "confirm", "explain", "offer", "recap", "state", "summarize",
  "and", "then",
]);

function isGenericPhaseActionLabel(value: string): boolean {
  const words = value.toLowerCase().match(/[a-z]+/gu) ?? [];
  if (words.length > 0 && words.every((word) => GENERIC_PHASE_ACTION_WORDS.has(word))) return true;
  const normalized = words.join(" ");
  return /^(?:set (?:clear )?expectations?|explain (?:the )?next steps?|close(?: the conversation)?|wrap up(?: the conversation)?)$/u.test(normalized);
}

const STYLE_ONLY_PHASE_GUIDANCE_WORDS = new Set([
  "a", "an", "the", "acknowledge", "apologize", "care", "compassion", "empathetically", "empathically",
  "empathize", "empathy", "genuinely", "kindly", "manner", "professionally", "recognize", "respectfully",
  "sincerely", "sincerity", "tone", "warmly", "warmth", "with",
]);

function isStyleOnlyPhaseGuidance(value: string): boolean {
  const words = value.toLowerCase().match(/[a-z]+/gu) ?? [];
  return words.some((word) => /^(?:acknowledge|apologize|empathize|recognize)$/u.test(word))
    && words.some((word) => /^(?:empathetically|empathically|genuinely|kindly|professionally|respectfully|sincerely|warmly)$/u.test(word))
    && words.every((word) => STYLE_ONLY_PHASE_GUIDANCE_WORDS.has(word));
}

type GenericPhaseActionConcept = "empathy" | "explain" | "offer" | "question";

function genericPhaseActionConcepts(
  value: string,
  requirements: ChatAdvanceRequirementDraft[] = [],
): Set<GenericPhaseActionConcept> {
  const normalized = value.toLowerCase();
  const concepts = new Set<GenericPhaseActionConcept>();
  if (/\b(?:acknowledge|apologize|empathize|recognize)\b/u.test(normalized)) concepts.add("empathy");
  if (/\b(?:ask|clarify|confirm)\b/u.test(normalized)) concepts.add("question");
  if (/\b(?:close|closing|communicate|expectation|expectations|explain|inform|next steps|recap|state|summarize|tell|wrap up)\b/u.test(normalized)) concepts.add("explain");
  if (/\b(?:offer|provide)\b/u.test(normalized)) concepts.add("offer");
  requirements.forEach((requirement) => {
    const id = requirement.id.toLowerCase();
    if (/empathy|acknowledge/u.test(id)) concepts.add("empathy");
    if (/question|preference/u.test(id)) concepts.add("question");
    if (/timeline|no_return|next_steps|closing|completion/u.test(id)) concepts.add("explain");
    if (/replacement_offer|refund_offer/u.test(id)) concepts.add("offer");
  });
  return concepts;
}

function repairGenericPhaseLearnerActions(content: GeneratedContent): GeneratedContent {
  return {
    ...content,
    phases: content.phases.map((phase) => {
      const genericActions = phase.learnerActions.filter(isGenericPhaseActionLabel);
      if (!genericActions.length) return phase;
      const detailedActions = phase.learnerActions.filter((action) => !isGenericPhaseActionLabel(action));
      const detailedActionCompilations = new Map(detailedActions.map((action) => [
        action,
        compileSafeChatAdvanceRequirements(
          { ...phase, learnerActions: [action], chatAdvanceRequirements: [] },
          content.prohibitedActions,
          content.customer.name,
        ) ?? [],
      ]));
      const coveredRequirementIds = new Set(
        [...detailedActionCompilations.values()].flatMap((compiled) => compiled.map((requirement) => requirement.id)),
      );
      const coveredConcepts = new Set<GenericPhaseActionConcept>(
        detailedActions.flatMap((action) => [...genericPhaseActionConcepts(
          action,
          detailedActionCompilations.get(action),
        )]),
      );
      const guidanceCandidates: Array<{
        guidance: string;
        compiled: ChatAdvanceRequirementDraft[];
        concepts: Set<GenericPhaseActionConcept>;
      }> = [];
      for (const guidance of uniqueStrings(phase.coachGuidance)) {
        if (generatedNegativeAction(guidance)
          || isGenericPhaseActionLabel(guidance)
          || isStyleOnlyPhaseGuidance(guidance)
          || !APPROVED_PROCESS_ACTION_START.test(guidance)) continue;
        const compiled = compileSafeChatAdvanceRequirements(
          { ...phase, learnerActions: [guidance], chatAdvanceRequirements: [] },
          content.prohibitedActions,
          content.customer.name,
        );
        if (!compiled?.length) continue;
        guidanceCandidates.push({
          guidance,
          compiled,
          concepts: genericPhaseActionConcepts(guidance, compiled),
        });
      }
      const phaseTitleConcepts = genericActions.length === 1
        ? genericPhaseActionConcepts(phase.title)
        : new Set<GenericPhaseActionConcept>();
      const usedGuidance = new Set<string>();
      const learnerActions: string[] = [];
      let unrepairable = false;
      phase.learnerActions.forEach((action) => {
        if (!isGenericPhaseActionLabel(action)) {
          learnerActions.push(action);
          return;
        }
        const desiredConcepts = genericPhaseActionConcepts(action);
        const allowedConcepts = new Set([...desiredConcepts, ...phaseTitleConcepts]);
        const alreadyCovered = [...desiredConcepts].some((concept) => coveredConcepts.has(concept));
        const replacements = guidanceCandidates.filter((candidate) => {
          if (usedGuidance.has(candidate.guidance)
            || ![...candidate.concepts].some((concept) => allowedConcepts.has(concept))
            || candidate.compiled.every((requirement) => coveredRequirementIds.has(requirement.id))) return false;
          usedGuidance.add(candidate.guidance);
          candidate.compiled.forEach((requirement) => coveredRequirementIds.add(requirement.id));
          candidate.concepts.forEach((concept) => coveredConcepts.add(concept));
          return true;
        });
        if (!alreadyCovered
          && !replacements.some((candidate) =>
            [...candidate.concepts].some((concept) => desiredConcepts.has(concept)))) {
          unrepairable = true;
          return;
        }
        learnerActions.push(...replacements.map((candidate) => candidate.guidance));
      });
      if (unrepairable) return phase;
      const uniqueLearnerActions = uniqueStrings(learnerActions);
      const chatAdvanceRequirements = compileSafeChatAdvanceRequirements(
        { ...phase, learnerActions: uniqueLearnerActions, chatAdvanceRequirements: [] },
        content.prohibitedActions,
        content.customer.name,
      );
      return chatAdvanceRequirements
        ? { ...phase, learnerActions: uniqueLearnerActions, chatAdvanceRequirements }
        : phase;
    }),
  };
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
  return JSON.parse(texts[0]) as GeneratedContent;
}

function repairGeneratedChatAdvanceRequirements(
  content: GeneratedContent,
  forcePhaseIndexes: Set<number> = new Set(),
): GeneratedContent {
  return {
    ...content,
    phases: content.phases.map((phase, phaseIndex) => {
      const findings = findChatAdvanceRequirementQualityFindings(
        phase.chatAdvanceRequirements,
        content.prohibitedActions,
        content.customer.name,
      );
      if (findings.length === 0 && !forcePhaseIndexes.has(phaseIndex)) return phase;
      return {
        ...phase,
        chatAdvanceRequirements: compileSafeChatAdvanceRequirements(
          phase,
          content.prohibitedActions,
          content.customer.name,
        ) ?? phase.chatAdvanceRequirements,
      };
    }),
  };
}

function repairGeneratedMissingOperationalCriteria(content: GeneratedContent): GeneratedContent {
  const findings = findOperationalCriterionCoverageFindings(content.objectives, content.phases);
  if (!findings.length || findings.some((finding) => finding.matchingPhaseIndexes.length !== 0)) {
    return content;
  }

  const missingCriteria = findings.map((finding) =>
    content.objectives[finding.objectiveIndex].criteria[finding.criterionIndex]
  );
  const finalPhaseIndex = content.phases.length - 1;
  return {
    ...content,
    phases: content.phases.map((phase, phaseIndex) => phaseIndex === finalPhaseIndex
      ? { ...phase, learnerActions: uniqueStrings([...phase.learnerActions, ...missingCriteria]) }
      : phase),
  };
}

interface ApprovedResolutionBlueprint {
  option: "refund" | "replacement";
  amount?: string;
  timeline?: string;
  useOriginalPaymentCard: boolean;
  needsAcknowledgement: boolean;
  needsPreference: boolean;
  fullRefund: boolean;
  noCostReplacement: boolean;
  needsReplacementOffer: boolean;
  noCostReplacementOffer: boolean;
  needsNoReturnGuidance: boolean;
}

const APPROVED_PROCESS_ACTION_START = /^\s*(?:acknowledge\w*|apolog\w*|ask\w*|check\w*|clarif\w*|collect\w*|confirm\w*|creat\w*|determin\w*|document\w*|empath\w*|explain\w*|find\w*|gather\w*|identify\w*|inform\w*|issu\w*|locat\w*|offer\w*|plac\w*|process\w*|provid\w*|recap\w*|recognize\w*|request\w*|review\w*|send\w*|sent|stat\w*|submi\w*|tell\w*|thank\w*|transfer\w*|updat\w*|verif\w*)\b/iu;
const APPROVED_PROCESS_SEQUENCE_PREFIX = /^\s*(?:after|once)\s+(?:(?:the\s+)?customer\s+confirms?(?:\s+they\s+want(?:\s+it|\s+the\s+replacement)?)?|confirmation)\s*[,;:]?\s*/iu;
const APPROVED_NO_COST_REPLACEMENT = /\b(?:no[- ]cost|at no charge|free of charge)\b/iu;
const APPROVED_EXPLICIT_NO_RETURN_GUIDANCE = /\b(?:(?:(?:do|does|will)\s+not|don['’]t|doesn['’]t|won['’]t)\s+(?:need\s+to|have\s+to)|(?:(?:is|are)\s+not|isn['’]t|aren['’]t|(?:will\s+not|won['’]t)\s+be)\s+required\s+to|need\s+not|no need to|not need to)\s+return\w*\b/iu;
const APPROVED_PERMISSION_TO_KEEP_GUIDANCE = /\b(?:can|may|feel free to)\s+keep\s+(?:(?:the|this|that|your|their|wrong|damaged|original|delivered|received)\s+){0,3}(?:bag|item|product)\b(?=\s*(?:[.!?]|$|rather than\b|instead of\b))/iu;
const APPROVED_PERMISSION_TO_DISPOSE_GUIDANCE = /\b(?:can|may|feel free to)\s+dispose(?:\s+of)?\s+(?:(?:the|this|that|your|their|wrong|damaged|original|delivered|received)\s+){0,3}(?:bag|item|product)\b(?=\s*(?:[.!?]|$|rather than\b|instead of\b))/iu;
const APPROVED_PERMISSION_TO_KEEP_OR_DISPOSE_GUIDANCE = /\b(?:can|may|feel free to)\s+(?:keep\s+or\s+dispose(?:\s+of)?\s+(?:(?:the|this|that|your|their|wrong|damaged|original|delivered|received)\s+){0,3}(?:bag|item|product)|keep\s+(?:(?:the|this|that|your|their|wrong|damaged|original|delivered|received)\s+){0,3}(?:bag|item|product)\s+or\s+dispose(?:\s+of)?\s+it)\b(?=\s*(?:[.!?]|$|rather than\b|instead of\b))/iu;
const APPROVED_DIRECT_KEEP_OR_DISPOSE_INSTRUCTION = /\b(?:tell|inform)\w*\s+(?:(?:the|a)\s+)?(?:customer|conversation partner|them)\s+to\s+(?:keep|dispose(?:\s+of)?)\s+(?:(?:the|this|that|your|their|wrong|damaged|original|delivered|received)\s+){0,3}(?:bag|item|product)\b(?=\s*(?:[.!?]|$|rather than\b|instead of\b))/iu;
const APPROVED_RETURN_COLLECTION_CONTEXT = /\b(?:carrier (?:pickup|collection)|(?:fedex|ups|carrier)\b.{0,30}\b(?:collect|pick[ -]?up)|send (?:it|the .{0,20}) back)\b/iu;
const APPROVED_RETURN_REQUIRED_CONTEXT = /\b(?:carrier (?:pickup|collection)|pick[ -]?up|(?:fedex|ups|carrier)\b.{0,30}\b(?:collect|pick[ -]?up)|(?:for|to|must|should|need|required to)\s+(?:a\s+)?return|send (?:it|the .{0,20}) back)\b/iu;

function approvedNoReturnGuidance(value: string): boolean {
  if (APPROVED_RETURN_COLLECTION_CONTEXT.test(value)) return false;
  if (APPROVED_EXPLICIT_NO_RETURN_GUIDANCE.test(value)) return true;
  if (APPROVED_RETURN_REQUIRED_CONTEXT.test(value)) return false;
  return APPROVED_PERMISSION_TO_KEEP_GUIDANCE.test(value)
    || APPROVED_PERMISSION_TO_DISPOSE_GUIDANCE.test(value)
    || APPROVED_PERMISSION_TO_KEEP_OR_DISPOSE_GUIDANCE.test(value)
    || APPROVED_DIRECT_KEEP_OR_DISPOSE_INSTRUCTION.test(value);
}

function stripApprovedProcessSequencePrefix(value: string): string {
  return value.replace(APPROVED_PROCESS_SEQUENCE_PREFIX, "").trim();
}

function supportedApprovedProcessClause(clause: string): boolean {
  const normalized = clause.trim();
  if (/^(?:acknowledge\w*|apolog\w*|empath\w*|recognize\w*)\b/iu.test(normalized)) return true;
  if (/^(?:ask\w*|clarif\w*|confirm\w*|determin\w*|verif\w*)\b.{0,100}\b(?:prefer\w*|want\w*|whether)\b/iu.test(normalized)) return true;
  if (/^offer\w*\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(normalized)) return true;
  if (/^(?:explain\w*|inform\w*|stat\w*|tell\w*)\b/iu.test(normalized)
    && (approvedNoReturnGuidance(normalized) || APPROVED_NO_COST_REPLACEMENT.test(normalized))) return true;
  if (/^(?:explain\w*|inform\w*|stat\w*|tell\w*)\b/iu.test(normalized)
    && APPROVED_RETURN_REQUIRED_CONTEXT.test(normalized)) return true;
  if (/^(?:explain\w*|inform\w*|stat\w*|tell\w*)\b.{0,120}\b(?:replac\w*|reship\w*)\b/iu.test(normalized)) return true;
  if (/^(?:complet\w*|issu\w*|process\w*|provid\w*)\b.{0,80}\brefund\w*\b/iu.test(normalized)) return true;
  if (/^(?:creat\w*|issu\w*|plac\w*|process\w*|provid\w*|send\w*|sent|submi\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(normalized)) return true;
  return /^(?:explain\w*|inform\w*|stat\w*|tell\w*)\b.{0,120}\b(?:arriv\w*|business days?|days?|end of day|hours?|post\w*|timeframe|timeline|timing|today|tomorrow|weeks?)\b/iu.test(normalized);
}

function approvedResolutionBlueprint(correctProcess: string | undefined): ApprovedResolutionBlueprint | undefined {
  if (!correctProcess) return undefined;
  const positiveSentences = correctProcess
    .split(/\r?\n+|(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => !generatedNegativeAction(sentence))
    .map(stripApprovedProcessSequencePrefix);
  const actionClauses = positiveSentences.flatMap((sentence) => {
    if (!APPROVED_PROCESS_ACTION_START.test(sentence)) return [];
    return sentence
      .split(/[,;]+|\b(?:and then|then|and)\b/iu)
      .map((clause) => clause.trim())
      .filter((clause) => APPROVED_PROCESS_ACTION_START.test(clause));
  });
  if (!actionClauses.length || actionClauses.some((clause) => !supportedApprovedProcessClause(clause))) {
    return undefined;
  }
  const positiveProcess = actionClauses.join(". ");
  const refundAction = /\b(?:complet\w*|issu\w*|process\w*|provid\w*)\b.{0,80}\brefund\w*\b/iu.test(positiveProcess);
  const replacementAction = /\b(?:creat\w*|issu\w*|plac\w*|process\w*|provid\w*|send\w*|sent|submi\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(positiveProcess);
  if (refundAction === replacementAction) return undefined;
  const replacementOfferClauses = actionClauses.filter((clause) =>
    /^offer\w*\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(clause)
  );
  const noCostReplacement = learnerActionsDescribeNoCostReplacement(actionClauses);
  if (refundAction && replacementOfferClauses.length > 0) return undefined;

  const amounts = [...new Set(
    [...positiveProcess.matchAll(/\$\s*\d+\.\d{2}\b/gu)].map((match) => match[0].replace(/\s+/gu, "")),
  )];
  const timelines = [...new Set(
    [...positiveProcess.matchAll(
      /\b(?:\d+\s*(?:-|–|to)\s*\d+\s+business days?|\d+\s+(?:business days?|days?|hours?|weeks?)|end of day|today|tomorrow)\b/giu,
    )].map((match) => match[0].replace(/\s+/gu, " ").toLowerCase()),
  )];
  if (amounts.length > 1 || timelines.length > 1) return undefined;
  return {
    option: refundAction ? "refund" : "replacement",
    ...(amounts[0] ? { amount: amounts[0] } : {}),
    ...(timelines[0] ? { timeline: timelines[0] } : {}),
    useOriginalPaymentCard: /\boriginal (?:payment(?: card| method)?|card)\b/iu.test(positiveProcess),
    needsAcknowledgement: /\b(?:acknowledge\w*|apolog\w*|empath\w*|recognize\w*)\b/iu.test(positiveProcess),
    needsPreference: /\b(?:ask\w*|clarif\w*|confirm\w*|determin\w*|verif\w*)\b.{0,100}\b(?:prefer\w*|want\w*|whether)\b/iu.test(positiveProcess),
    fullRefund: /\bfull refund\b/iu.test(positiveProcess),
    noCostReplacement,
    needsReplacementOffer: replacementOfferClauses.length > 0,
    noCostReplacementOffer: replacementOfferClauses.length > 0 && noCostReplacement,
    needsNoReturnGuidance: actionClauses.some(approvedNoReturnGuidance),
  };
}

function authoritativeProhibitedActions(correctProcess: string | undefined): string[] {
  if (!correctProcess) return [];
  return uniqueStrings(correctProcess
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim().replace(/^[-*]\s+/u, ""))
    .map((sentence) => !/^no\b/iu.test(sentence) && generatedNegativeAction(sentence)
      ? normalizeGeneratedProhibitedAction(sentence)
      : "")
    .filter(nonempty));
}

function canonicalResolutionTimeline(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[–—]/gu, "-")
    .replace(/\b(\d+)\s+to\s+(\d+)\b/gu, "$1-$2")
    .replace(/\s+/gu, " ")
    .trim();
}

function currencyValues(values: string[]): Set<string> {
  return new Set(values.flatMap((value) =>
    [...value.matchAll(/\$\s*\d+\.\d{2}\b/gu)].map((match) => match[0].replace(/\s+/gu, ""))
  ));
}

function timelineValuesForFidelity(values: string[]): Set<string> {
  return new Set(values.flatMap((value) =>
    [...value.matchAll(
      /\b(?:\d+\s*(?:-|–|—|to)\s*\d+\s+(?:business days?|days?|hours?|weeks?)|\d+\s+(?:business days?|days?|hours?|weeks?)|end of day|today|tomorrow)\b/giu,
    )].map((match) => canonicalResolutionTimeline(match[0]))
  ));
}

function positiveResolutionValues(values: string[]): string[] {
  return values.filter((value) => !generatedNegativeAction(value));
}

function hasApprovedAcknowledgement(value: string): boolean {
  return /\b(?:acknowledge\w*|apolog\w*|empath\w*|recognize\w*)\b/iu.test(value);
}

function hasApprovedPreferenceConfirmation(value: string): boolean {
  return /\b(?:ask\w*|clarif\w*|confirm\w*|determin\w*|verif\w*)\b.{0,100}\b(?:prefer\w*|want\w*|whether)\b/iu.test(value);
}

function hasApprovedReplacementOffer(value: string): boolean {
  return /\b(?:offer\w*|provid\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(value);
}

function hasApprovedReplacementCompletion(value: string): boolean {
  return /\b(?:creat\w*|issu\w*|plac\w*|process\w*|provid\w*|send\w*|sent|submi\w*)\b.{0,80}\b(?:replac\w*|reship\w*)\b/iu.test(value);
}

function hasApprovedRefundCompletion(value: string): boolean {
  return /(?:\b(?:complet\w*|issu\w*|process\w*|provid\w*)\b.{0,80}\brefund\w*\b|^\s*refund\w*\b)/iu.test(value);
}

function hasApprovedNoReturnGuidance(value: string): boolean {
  return approvedNoReturnGuidance(value);
}

function everyResolutionGroupIncludes(
  groups: string[][],
  predicate: (value: string) => boolean,
): boolean {
  return groups.every((values) => values.some(predicate));
}

function generatedResolutionFactsDrift(
  content: GeneratedContent,
  blueprint: ApprovedResolutionBlueprint,
): boolean {
  const groups = [
    positiveResolutionValues(content.phases.flatMap((phase) => phase.learnerActions)),
    positiveResolutionValues(content.phases.flatMap((phase) =>
      phase.chatAdvanceRequirements.flatMap((requirement) => requirement.phrases)
    )),
    positiveResolutionValues(content.objectives.flatMap((objective) => objective.criteria)),
  ];
  const authoredBehaviorGroups = [groups[0], groups[2]];

  if (blueprint.needsAcknowledgement
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedAcknowledgement)) return true;

  if (blueprint.needsPreference
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedPreferenceConfirmation)) return true;

  if (blueprint.needsReplacementOffer
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedReplacementOffer)) return true;

  if (blueprint.option === "replacement"
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedReplacementCompletion)) return true;

  if (blueprint.option === "refund"
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedRefundCompletion)) return true;

  if ((blueprint.noCostReplacementOffer || blueprint.noCostReplacement)
    && !authoredBehaviorGroups.every(learnerActionsDescribeNoCostReplacement)) return true;

  if (blueprint.needsNoReturnGuidance
    && !everyResolutionGroupIncludes(authoredBehaviorGroups, hasApprovedNoReturnGuidance)) return true;

  if (blueprint.amount && groups.some((values) => {
    const amounts = currencyValues(values);
    return amounts.size !== 1 || !amounts.has(blueprint.amount!);
  })) return true;

  if (blueprint.timeline) {
    const expectedTimeline = canonicalResolutionTimeline(blueprint.timeline);
    if (groups.some((values) => {
      const timelines = timelineValuesForFidelity(values);
      return timelines.size !== 1 || !timelines.has(expectedTimeline);
    })) return true;
  }

  if (blueprint.useOriginalPaymentCard && groups.some((values) =>
    !/\boriginal (?:payment(?: card| method)?|card)\b/iu.test(values.join(" "))
  )) return true;

  return false;
}

function groundGeneratedResolutionGates(
  content: GeneratedContent,
  blueprint: ApprovedResolutionBlueprint,
): GeneratedContent | undefined {
  let failed = false;
  const phases = content.phases.map((phase) => {
    const actions = positiveResolutionValues(phase.learnerActions);
    const needsGrounding =
      (blueprint.needsAcknowledgement && actions.some(hasApprovedAcknowledgement))
      || (blueprint.needsPreference && actions.some(hasApprovedPreferenceConfirmation))
      || (blueprint.needsReplacementOffer && actions.some(hasApprovedReplacementOffer))
      || (blueprint.option === "replacement" && actions.some(hasApprovedReplacementCompletion))
      || (blueprint.option === "refund" && actions.some(hasApprovedRefundCompletion))
      || ((blueprint.noCostReplacementOffer || blueprint.noCostReplacement)
        && learnerActionsDescribeNoCostReplacement(actions))
      || (blueprint.needsNoReturnGuidance && actions.some(hasApprovedNoReturnGuidance));
    if (!needsGrounding) return phase;
    const chatAdvanceRequirements = compileSafeChatAdvanceRequirements(
      { ...phase, chatAdvanceRequirements: [] },
      content.prohibitedActions,
      content.customer.name,
    );
    if (!chatAdvanceRequirements) {
      failed = true;
      return phase;
    }
    return { ...phase, chatAdvanceRequirements };
  });
  return failed ? undefined : { ...content, phases };
}

function groundGeneratedResolutionFacts(
  content: GeneratedContent,
  correctProcess: string | undefined,
): GeneratedContent {
  const blueprint = approvedResolutionBlueprint(correctProcess);
  if (!blueprint) return content;
  const gateGroundedContent = groundGeneratedResolutionGates(content, blueprint);
  if (gateGroundedContent && !generatedResolutionFactsDrift(gateGroundedContent, blueprint)) {
    return gateGroundedContent;
  }
  const rebuilt = rebuildGeneratedResolutionPhases(content, correctProcess).content;
  if (!rebuilt) throw new Error("approved_resolution_grounding_failed");
  const primaryObjective = rebuilt.objectives[0];
  const grounded = {
    ...rebuilt,
    objectives: [{
      ...primaryObjective,
      criteria: uniqueStrings([
        ...rebuilt.phases.flatMap((phase) => phase.learnerActions),
        ...rebuilt.prohibitedActions,
      ]),
    }],
  };
  const gateGrounded = groundGeneratedResolutionGates(grounded, blueprint);
  if (!gateGrounded || generatedResolutionFactsDrift(gateGrounded, blueprint)) {
    throw new Error("approved_resolution_grounding_failed");
  }
  return gateGrounded;
}

function compileBlueprintPhase(
  phase: Omit<PhaseDraft, "chatAdvanceRequirements">,
  prohibitedActions: string[],
  customerName: string,
): PhaseDraft | undefined {
  const provisional = { ...phase, chatAdvanceRequirements: [] };
  const chatAdvanceRequirements = compileSafeChatAdvanceRequirements(
    provisional,
    prohibitedActions,
    customerName,
  );
  return chatAdvanceRequirements ? { ...provisional, chatAdvanceRequirements } : undefined;
}

function rebuildGeneratedResolutionPhases(
  content: GeneratedContent,
  correctProcess: string | undefined,
): {
  content?: GeneratedContent;
  failureCode?: "approved_process_unsupported" | "preference_gate_uncompilable" | "outcome_gate_uncompilable";
} {
  const blueprint = approvedResolutionBlueprint(correctProcess);
  if (!blueprint) return { failureCode: "approved_process_unsupported" };
  const creatorProhibitedActions = authoritativeProhibitedActions(correctProcess);
  const authoritativeContent = creatorProhibitedActions.length > 0
    ? repairGeneratedResolutionProhibitions({
        ...content,
        prohibitedActions: creatorProhibitedActions,
      })
    : content;
  const effectiveProhibitedActions = authoritativeContent.prohibitedActions;
  const phases: PhaseDraft[] = [];
  const partnerName = content.customer.name.trim() || "the Conversation Partner";
  const optionLabel = blueprint.option === "refund"
    ? `${blueprint.fullRefund ? "full " : ""}refund`
    : "replacement";

  if (blueprint.needsAcknowledgement || blueprint.needsReplacementOffer || blueprint.needsPreference) {
    const learnerActions = [
      ...(blueprint.needsAcknowledgement ? ["Acknowledge the Conversation Partner's concern."] : []),
      ...(blueprint.needsReplacementOffer
        ? [`Offer ${blueprint.noCostReplacementOffer ? "a no-cost" : "a"} replacement.`]
        : []),
      ...(blueprint.needsPreference ? [`Ask whether ${partnerName} wants a ${optionLabel}.`] : []),
    ];
    const preferencePhase = compileBlueprintPhase({
      id: `acknowledge_and_confirm_${blueprint.option}_preference`,
      title: `Acknowledge and confirm ${blueprint.option} preference`,
      learnerActions,
      partnerResponse: blueprint.needsPreference
        ? `Yes, I want a ${optionLabel}.`
        : blueprint.needsReplacementOffer
          ? "A replacement would work for me."
          : "Thank you for understanding.",
      coachGuidance: [
        ...(blueprint.needsAcknowledgement ? ["Acknowledge what happened before discussing the resolution."] : []),
        ...(blueprint.needsReplacementOffer
          ? [`Offer ${blueprint.noCostReplacementOffer ? "a no-cost" : "the approved"} replacement.`]
          : []),
        ...(blueprint.needsPreference ? ["Ask for the Conversation Partner's preferred resolution before taking action."] : []),
      ],
      customerRemainsSilent: false,
    }, effectiveProhibitedActions, partnerName);
    if (!preferencePhase) return { failureCode: "preference_gate_uncompilable" };
    phases.push(preferencePhase);
  }

  const outcomeAction = blueprint.option === "refund"
    ? `Issue ${blueprint.fullRefund ? "a full" : "the"} refund${blueprint.amount ? ` of ${blueprint.amount}` : ""}${blueprint.useOriginalPaymentCard ? " to the original payment card" : ""}.`
    : `Place ${blueprint.noCostReplacement ? "a no-cost" : "the"} replacement order.`;
  const learnerActions = [
    outcomeAction,
    ...(blueprint.timeline
      ? [`Explain that the ${blueprint.option} will ${blueprint.option === "refund" ? "post" : "arrive"} within ${blueprint.timeline}.`]
      : []),
    ...(blueprint.needsNoReturnGuidance
      ? ["Tell the Conversation Partner they do not need to return the item."]
      : []),
  ];
  const outcomePhase = compileBlueprintPhase({
    id: `complete_${blueprint.option}`,
    title: `Complete the ${blueprint.option}`,
    learnerActions,
    partnerResponse: "Thank you for resolving this.",
    coachGuidance: [
      `Complete the approved ${blueprint.option} accurately.`,
      ...(blueprint.timeline ? [`Explain the approved ${blueprint.timeline} timing.`] : []),
      ...(blueprint.needsNoReturnGuidance ? ["Explain that no return is needed."] : []),
    ],
    customerRemainsSilent: false,
  }, effectiveProhibitedActions, partnerName);
  if (!outcomePhase) return { failureCode: "outcome_gate_uncompilable" };
  phases.push(outcomePhase);

  return {
    content: {
      ...authoritativeContent,
      prohibitedActions: effectiveProhibitedActions,
      phases,
    },
  };
}

function authoredBehaviorPhaseTitle(action: string, phaseIndex: number): string {
  const normalized = action.trim();
  if (/^acknowledge\w*\b/iu.test(normalized)) return "Acknowledge the concern";
  if (/^ask\w*\b/iu.test(normalized)) return "Understand what happened";
  if (/^confirm\w*\b.{0,100}\b(?:need\w* outcome|outcome .{0,30}need\w*|prefer\w* outcome)\b/iu.test(normalized)) {
    return "Confirm the needed outcome";
  }
  if (/^explain\w*\b.{0,60}\bnext steps?\b/iu.test(normalized)) return "Explain next steps";
  if (/^confirm\w*\b.{0,60}\bagreed resolution\b/iu.test(normalized)) return "Confirm and close";
  return `Practice behavior ${phaseIndex + 1}`;
}

function rebuildGeneratedBehaviorPhases(
  content: GeneratedContent,
  correctProcess: string | undefined,
): GeneratedContent | undefined {
  if (!correctProcess || approvedResolutionBlueprint(correctProcess)) return undefined;
  const processClauses = correctProcess
    .split(/\n+|(?<=[.!?])\s+/u)
    .map((entry) => entry.trim().replace(/^[-*]\s+/u, ""))
    .filter(nonempty);
  const actions = processClauses.filter((entry) =>
    !generatedNegativeAction(entry) && !/^avoid\s*:/iu.test(entry)
  );
  if (!actions.length || actions.some((entry) => !APPROVED_PROCESS_ACTION_START.test(entry))) return undefined;
  if (/\$\s*\d+\.\d{2}\b|\b(?:refund\w*|replac\w*|reship\w*|store credit|transfer\w*)\b/iu.test(actions.join(" "))) {
    return undefined;
  }

  const creatorProhibitedActions = authoritativeProhibitedActions(correctProcess);
  const authoritativeContent = creatorProhibitedActions.length > 0
    ? repairGeneratedResolutionProhibitions({
        ...content,
        prohibitedActions: creatorProhibitedActions,
      })
    : content;
  const partnerResponses = authoritativeContent.phases
    .map((phase) => phase.partnerResponse.trim())
    .filter(nonempty);
  const partnerName = authoritativeContent.customer.name.trim() || "the Conversation Partner";
  const phases = actions.map((action, phaseIndex) => {
    const partnerResponse = /\b(?:anything else|anything more|else .{0,20}help)\b/iu.test(action)
      ? authoritativeContent.customer.closingLine
      : partnerResponses[phaseIndex] || authoritativeContent.customer.closingLine;
    return compileBlueprintPhase({
      id: `authored_behavior_${phaseIndex + 1}`,
      title: authoredBehaviorPhaseTitle(action, phaseIndex),
      learnerActions: [action],
      partnerResponse,
      coachGuidance: [action],
      customerRemainsSilent: false,
    }, authoritativeContent.prohibitedActions, partnerName);
  });
  if (phases.some((phase) => !phase)) return undefined;
  return {
    ...authoritativeContent,
    phases: phases as PhaseDraft[],
  };
}

function rebuildGeneratedPhases(
  content: GeneratedContent,
  correctProcess: string | undefined,
): ReturnType<typeof rebuildGeneratedResolutionPhases> {
  const resolutionResult = rebuildGeneratedResolutionPhases(content, correctProcess);
  if (resolutionResult.content || resolutionResult.failureCode !== "approved_process_unsupported") {
    return resolutionResult;
  }
  const behaviorContent = rebuildGeneratedBehaviorPhases(content, correctProcess);
  return behaviorContent ? { content: behaviorContent } : resolutionResult;
}

function safeGeneratedRepairDetails(content: GeneratedContent): NonNullable<GenerationDiagnostic["repairDetails"]> {
  return {
    chatPhases: content.phases.flatMap((phase, phaseIndex) => {
      const findings = findChatAdvanceRequirementQualityFindings(
        phase.chatAdvanceRequirements,
        content.prohibitedActions,
        content.customer.name,
      );
      if (!findings.length) return [];
      const compilerFailureCode = chatAdvanceCompilationFailureCode(
        phase,
        content.prohibitedActions,
        content.customer.name,
      );
      return [{
        phaseIndex,
        findingCodes: [...new Set(findings.map((finding) => finding.code))],
        ...(compilerFailureCode ? { compilerFailureCode } : {}),
      }];
    }),
    operationalCriteria: findOperationalCriterionCoverageFindings(
      content.objectives,
      content.phases,
    ).map((finding) => ({
      objectiveIndex: finding.objectiveIndex,
      criterionIndex: finding.criterionIndex,
      matchingPhaseCount: finding.matchingPhaseIndexes.length,
    })),
  };
}

function assertGeneratedContent(value: GeneratedContent): void {
  if (!value || typeof value !== "object") throw new Error("invalid_generated_content");
  const strings = [value.title, value.description, value.learnerGoal, value.topic, value.subtopic, value.teamAudience];
  if (strings.some((entry) => !nonempty(entry))) throw new Error("invalid_generated_content");
  if (value.agentType !== "Core" && value.agentType !== "Rx") throw new Error("invalid_generated_content");
  if (!value.customer || !nonempty(value.customer.name) || !nonempty(value.customer.openingLine)) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.correctProcess) || value.correctProcess.length === 0) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.prohibitedActions)) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.phases) || value.phases.length === 0) throw new Error("invalid_generated_content");
  if (!Array.isArray(value.objectives) || value.objectives.length === 0
    || value.objectives.some((objective) => !Array.isArray(objective.criteria))) throw new Error("invalid_generated_content");
  if (value.phases.some((phase) => {
    if (!Array.isArray(phase.chatAdvanceRequirements) || phase.chatAdvanceRequirements.length === 0) return true;
    return phase.chatAdvanceRequirements.some((requirement) =>
      !requirement
      || typeof requirement.id !== "string"
      || !Array.isArray(requirement.phrases)
      || requirement.phrases.some((phrase) => typeof phrase !== "string")
    );
  })) throw new Error("invalid_generated_content");
  const repairedOpeningLine = value.phases.reduce(
    (openingLine, phase) => removePreansweredPreferenceFromOpening(openingLine, phase.learnerActions),
    value.customer.openingLine,
  );
  const repairCorrections: string[] = [];
  const repairCodes: string[] = [];
  if (value.phases.some((phase) => phase.learnerActions.some(isGenericPhaseActionLabel))) {
    repairCodes.push("generic_phase_learner_actions");
    repairCorrections.push(
      "Replace generic phase learnerActions such as Acknowledge, Confirm, Explain, or Recap with complete observable behaviors that state what the Learner must say or do.",
    );
  }
  if (!nonempty(repairedOpeningLine)) {
    repairCodes.push("opening_preanswers_preference");
    repairCorrections.push(
      "Regenerate customer.openingLine as a factual problem statement that does not disclose the preference, choice, or resolution a Learner phase must ask or confirm. Reveal that answer in the corresponding phase.partnerResponse.",
    );
  }
  if (findPreferenceResponseOrderConflicts(repairedOpeningLine, value.phases).length > 0) {
    repairCodes.push("preference_response_order");
    repairCorrections.push(
      "Use a separate question phase for the unresolved customer preference, let its Conversation Partner response provide the earned Conversation Partner answer, and put outcome execution, completion, or recap evidence in a later phase.",
    );
  }
  if (findPrematureCustomerRevealFindings(value.phases).length > 0) {
    repairCodes.push("premature_customer_reveal");
    repairCorrections.push(
      "Do not reveal an answer in an earlier Conversation Partner response when a later Learner phase is supposed to ask for that information. Put each answer only after the phase that asks for it.",
    );
  }
  const finalPhase = value.phases.at(-1);
  if (/\?|\bwhat happens next\b/iu.test(value.customer.closingLine)
    || (finalPhase && !finalPhase.customerRemainsSilent && /\?|\bwhat happens next\b/iu.test(finalPhase.partnerResponse))) {
    repairCodes.push("unresolved_closing_question");
    repairCorrections.push(
      "End with a true Conversation Partner closing statement. Do not end customer.closingLine or the final phase.partnerResponse with a question unless another Learner-response phase follows.",
    );
  }
  if (findOperationalCriterionCoverageFindings(value.objectives, value.phases).length > 0) {
    repairCodes.push("operational_criterion_coverage");
    repairCorrections.push(
      "Give every positive operational outcome criterion exactly one phase whose learnerActions/strong response performs the same action. Put a missing Issue, Process, Complete, Refund, Replace, Reship, or Transfer action in a later outcome phase after the earned Conversation Partner answer; confirming an amount or destination does not perform the outcome.",
    );
  }
  const chatGateFindings = value.phases.flatMap((phase) =>
    findChatAdvanceRequirementQualityFindings(
      phase.chatAdvanceRequirements,
      value.prohibitedActions,
      value.customer.name,
    )
  );
  if (chatGateFindings.length > 0) {
    repairCodes.push("chat_advance_requirements");
    repairCorrections.push(
      "Regenerate every chatAdvanceRequirements phrase as a compact semantic anchor of no more than six words that expresses the semantic concept named by its requirement ID. Preserve separate independently required concepts and use short numeric anchors where appropriate. Do not write complete learner turns or instructions that begin with learner action verbs such as Issue or Process.",
    );
  }
  const normalizedProhibitedActions = value.prohibitedActions
    .map(normalizeGeneratedProhibitedAction)
    .filter(nonempty);
  if (findOverlappingResolutionProhibitionGroups(normalizedProhibitedActions).length > 0) {
    repairCodes.push("overlapping_resolution_prohibitions");
    repairCorrections.push(
      "Replace separate store-credit, replacement, exchange, or other-than-full-refund prohibitions with one composite prohibitedActions boundary that lists each alternative once. Keep partial-refund and incorrect-amount constraints separate.",
    );
  }
  if (repairCorrections.length > 0) {
    throw new RepairableGeneratedContentError(repairCorrections.join(" "), repairCodes);
  }
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
  const repairedOpeningLine = content.phases.reduce(
    (openingLine, phase) => removePreansweredPreferenceFromOpening(openingLine, phase.learnerActions),
    content.customer.openingLine,
  );
  if (!nonempty(repairedOpeningLine)) throw new Error("invalid_generated_content");
  const customerIntentSources = [
    repairedOpeningLine,
    content.customer.goal,
    ...content.customer.objections,
  ];
  const customer = {
    ...content.customer,
    openingLine: repairedOpeningLine,
    behaviorRules: content.customer.behaviorRules.filter((rule) => !customerBehaviorRuleConflictsWithLearner(rule)),
    conditionalFollowUps: content.customer.conditionalFollowUps.filter((followUp) =>
      !customerFollowUpContradictsRejectedOption(followUp, customerIntentSources)
    ),
  };
  const generatedCompatibilityFacts = {
    ...content.compatibilityFacts,
    conditionalFollowUp: customerFollowUpContradictsRejectedOption(
      content.compatibilityFacts.conditionalFollowUp || "",
      customerIntentSources,
    )
      ? ""
      : content.compatibilityFacts.conditionalFollowUp,
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
      : generatedCompatibilityFacts,
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
  ["acknowledges", "Acknowledge"], ["apologizes", "Apologize"], ["asks", "Ask"], ["avoids", "Avoid"], ["checks", "Check"],
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
  ["selects", "Select"], ["shares", "Share"], ["shows", "Show"], ["states", "State"], ["tells", "Tell"],
  ["stops", "Stop"], ["takes", "Take"], ["thanks", "Thank"], ["updates", "Update"],
  ["uses", "Use"], ["verifies", "Verify"], ["waits", "Wait"],
]);

const GENERATED_GERUND_FORMS = new Map([
  ["acknowledging", "Acknowledge"], ["apologizing", "Apologize"], ["asking", "Ask"], ["avoiding", "Avoid"], ["checking", "Check"],
  ["clarifying", "Clarify"], ["communicating", "Communicate"], ["confirming", "Confirm"], ["explaining", "Explain"], ["expressing", "Express"],
  ["identifying", "Identify"], ["informing", "Inform"], ["issuing", "Issue"], ["offering", "Offer"],
  ["processing", "Process"], ["providing", "Provide"], ["recapping", "Recap"], ["stating", "State"], ["telling", "Tell"],
  ["thanking", "Thank"], ["verifying", "Verify"],
]);

const GENERATED_IMPERATIVE_BASES = new Set(
  [...GENERATED_IMPERATIVE_FORMS.values(), ...GENERATED_GERUND_FORMS.values()].map((value) => value.toLowerCase()),
);

const GENERATED_DIRECT_NEGATIVE_ACTION_PATTERN = /^\s*(?:do\s+not|don['’]t|must\s+not|never|refrain(?:\s+from)?)\s+(.+?)\s*$/iu;
const GENERATED_DIRECT_AVOID_ACTION_PATTERN = /^\s*(?:avoid\b\s*:?\s*|no\s+)(.+?)\s*$/iu;
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
  if (directAvoid) {
    const nestedNegative = generatedNegativeAction(directAvoid[1]);
    return nestedNegative ?? { action: directAvoid[1], style: "avoid" };
  }

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

const GENERATED_RESOLUTION_BOUNDARY_VERBS: Array<[RegExp, string]> = [
  [/\bmention\w*\b/iu, "mention"],
  [/\boffer\w*\b/iu, "offer"],
  [/\bpresent\w*\b/iu, "present"],
  [/\bpropos\w*\b/iu, "propose"],
  [/\bprovid\w*\b/iu, "provide"],
  [/\brecommend\w*\b/iu, "recommend"],
  [/\bsuggest\w*\b/iu, "suggest"],
  [/\bissu\w*\b/iu, "issue"],
  [/\bgiv\w*\b/iu, "give"],
  [/\bsend\w*\b/iu, "send"],
  [/\bcreat\w*\b/iu, "create"],
  [/\bselect\w*\b/iu, "select"],
  [/\bus(?:e|es|ed|ing)\b/iu, "use"],
];

function readableList(values: string[]): string {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function generatedResolutionAlternativeConcepts(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const concepts = new Set<string>();
  if (/\bstore credit\b/u.test(normalized)) concepts.add("credit");
  if (/\b(?:replac\w*|reship\w*)\b/u.test(normalized)
    && !/\breplacement\s+(?:delivery\s+date|order\s+confirmation)\b/u.test(normalized)) {
    concepts.add("replacement");
  }
  if (/\bexchang\w*\b/u.test(normalized)) concepts.add("exchange");
  if (/\b(?:alternatives?|options?)\s+(?:other than|to)\s+(?:a )?full refund\b/u.test(normalized)) {
    concepts.add("wildcard");
  }
  return concepts;
}

function generatedResolutionBoundaryLike(value: string): boolean {
  if (generatedNegativeAction(value)) return true;
  const normalized = normalizeGeneratedCriterion(value).toLowerCase();
  const tokens = normalized.match(/[a-z]+/gu) || [];
  if (!tokens.length || !GENERATED_RESOLUTION_BOUNDARY_VERBS.some(([pattern]) => pattern.test(tokens[0]))) {
    return false;
  }
  const alternativeIndex = tokens.findIndex((token, index) =>
    (token === "store" && tokens[index + 1] === "credit")
    || /^(?:replac|reship|exchang)/u.test(token)
    || /^(?:alternative|option)/u.test(token)
  );
  const directObjectBridge = new Set(["a", "an", "approved", "customer", "full", "the", "with"]);
  return alternativeIndex > 0
    && tokens.slice(1, alternativeIndex).every((token) => directObjectBridge.has(token));
}

function compositeGeneratedResolutionBoundary(actions: string[]): string {
  const normalizedActions = actions.map(normalizeGeneratedProhibitedAction);
  const verbs = uniqueStrings(normalizedActions.flatMap((action) => {
    const match = GENERATED_RESOLUTION_BOUNDARY_VERBS.find(([pattern]) => pattern.test(action));
    return match ? [match[1]] : [];
  }));
  const concepts = new Set(normalizedActions.flatMap((action) =>
    [...generatedResolutionAlternativeConcepts(action)]
  ));
  const alternatives: string[] = [];
  if (concepts.has("credit")) alternatives.push("store credit");
  if (concepts.has("replacement")) alternatives.push("a replacement");
  if (concepts.has("exchange")) alternatives.push("an exchange");
  if (concepts.has("wildcard")) {
    alternatives.push(alternatives.length
      ? "any other option instead of the approved full refund"
      : "any option other than the approved full refund");
  }
  return `Do not ${readableList(verbs.length ? verbs : ["use"])} ${readableList(alternatives)}.`;
}

function repairGeneratedResolutionProhibitions(content: GeneratedContent): GeneratedContent {
  const normalizedActions = content.prohibitedActions.map(normalizeGeneratedProhibitedAction);
  const groups = findOverlappingResolutionProhibitionGroups(normalizedActions);
  if (!groups.length) return content;

  const replacementAtIndex = new Map<number, string>();
  const removedIndexes = new Set<number>();
  const echoReplacements = new Map<string, string>();
  const semanticEchoReplacements: Array<{ concepts: Set<string>; replacement: string }> = [];
  groups.forEach((group) => {
    const composite = compositeGeneratedResolutionBoundary(group.map((index) => normalizedActions[index]));
    const concepts = new Set(group.flatMap((index) =>
      [...generatedResolutionAlternativeConcepts(normalizedActions[index])]
    ));
    semanticEchoReplacements.push({ concepts, replacement: composite });
    replacementAtIndex.set(group[0], composite);
    group.slice(1).forEach((index) => removedIndexes.add(index));
    group.forEach((index) => {
      echoReplacements.set(generatedProhibitedActionBodyKey(content.prohibitedActions[index]), composite);
      echoReplacements.set(generatedProhibitedActionBodyKey(normalizedActions[index]), composite);
    });
  });
  const replaceEcho = (value: string) => {
    const exactReplacement = echoReplacements.get(generatedProhibitedActionBodyKey(value));
    if (exactReplacement) return exactReplacement;
    if (!generatedResolutionBoundaryLike(value)) return value;
    const concepts = generatedResolutionAlternativeConcepts(value);
    if (!concepts.size) return value;
    const semanticReplacement = semanticEchoReplacements.find(({ concepts: groupConcepts }) =>
      [...concepts].every((concept) => groupConcepts.has("wildcard") || groupConcepts.has(concept))
    );
    return semanticReplacement?.replacement || value;
  };

  return {
    ...content,
    correctProcess: uniqueStrings(content.correctProcess.map(replaceEcho)),
    prohibitedActions: uniqueStrings(content.prohibitedActions.flatMap((action, index) => {
      if (replacementAtIndex.has(index)) return [replacementAtIndex.get(index)!];
      return removedIndexes.has(index) ? [] : [action];
    })),
    phases: content.phases.map((phase) => ({
      ...phase,
      learnerActions: uniqueStrings(phase.learnerActions.map(replaceEcho)),
      coachGuidance: uniqueStrings(phase.coachGuidance.map(replaceEcho)),
    })),
    objectives: content.objectives.map((objective) => ({
      ...objective,
      criteria: uniqueStrings(objective.criteria.map(replaceEcho)),
    })),
  };
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
If a Learner phase asks, confirms, or discovers a customer fact or preference, do not reveal that answer in customer.openingLine. Reveal it once in that phase.partnerResponse.
Keep an unresolved preference question in its own phase. Let the Conversation Partner answer before a later phase issues, processes, completes, recaps, or closes the outcome.
Write customer.conditionalFollowUps only as Conversation Partner reactions, objections, or questions. Never assign the Learner's discovery question or Chewy-agent action to the Conversation Partner. Use an empty conditional follow-up when no natural follow-up is consistent with the customer's stated goal, choices, and rejected options; never invent a request for an option the customer rejected.
Write customer.behaviorRules only as Conversation Partner reactions, emotional shifts, disclosure boundaries, or role constraints. Never tell the Conversation Partner to issue, process, offer, explain, inform, or perform any Chewy-agent action.
Write one deterministic approved resolution. Never substitute phrases such as available next steps, approved process, locating the package or replacement, or initiate resolution for the exact authorized action and expected outcome.
Never write placeholders such as as per correct process, per approved policy, or according to the approved process. Use the supplied exact amount, destination, timing, and authorized action wherever those details are relevant.
Begin every objective criterion with a neutral imperative action such as Acknowledge, Ask, Explain, Confirm, Avoid, or Recap.
For every phase, create chatAdvanceRequirements with one independently required positive concept per entry. Every phrase alternative must express the semantic concept named by that requirement ID; do not mix amount, destination, timeline, preference, completion, closing, or empathy evidence in one group. Give each entry two or more compact semantic anchors, normally 2-6 words, that express only that concept. Numeric anchors such as $32.49 or 3-5 business days may be shorter. Do not write complete learner turns, scaffolding such as I will, Can I, Would you, or Please allow, or instructions beginning with learner action verbs such as Issue or Process. A Chat phase advances only when every entry matches. Never use a prohibited option, incidental courtesy, or generic word such as issue, customer, process, thank, or help as positive evidence.
Set customerRemainsSilent to true only for a final learner-only action after which the customer must not reply; otherwise set it to false.
Create distinct keyQuestion, rootCauseBelief, urgency, medication/product, clinic, address, and conditionalFollowUp facts. Use empty strings only when a fact truly does not apply.
Write every prohibited action with explicit negative polarity such as Do not, Avoid, or Never. Repeat that same negative wording in both an objective criterion and the relevant Coach Chewy guidance.
When a customer preference must be earned before the authorized outcome, write the sequence boundary as "Do not issue the full refund before the customer confirms they want it" or "Do not place the no-cost replacement before the customer confirms they want it." Do not add other modifiers to the refund or replacement.
Combine all store-credit, replacement, exchange, or other-than-full-refund prohibitions into one composite boundary. Keep partial-refund and incorrect-amount constraints separate.
Give every positive operational objective criterion exactly one phase whose learnerActions performs the same Issue, Process, Complete, Refund, Replace, Reship, or Transfer behavior.
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
