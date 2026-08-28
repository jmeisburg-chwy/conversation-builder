export type Channel = "chat" | "voice";
export type ImportMode = "improve" | "similar";
export const SUPPORTED_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] as const;

export interface ObjectiveDraft {
  id: string;
  label: string;
  description: string;
  criteria: string[];
}

export interface PhaseDraft {
  id: string;
  title: string;
  learnerActions: string[];
  partnerResponse: string;
  coachGuidance: string[];
  guideSourceLabel?: string;
  guideSource?: string;
  guideTitle?: string;
  guideBody?: string;
  managerGuidance?: string;
  customerRemainsSilent?: boolean;
}

export interface CustomerDraft {
  name: string;
  petName: string;
  tone: string;
  goal: string;
  openingLine: string;
  facts: string[];
  revealOnlyWhenAsked: string[];
  objections: string[];
  behaviorRules: string[];
  conditionalFollowUps: string[];
  closingLine: string;
}

export interface StandardTextDraft {
  hotkey: string;
  category: string;
  template: string;
  insertionMoment: string;
  customization: string;
  notes: string[];
  approvedGuidance: string;
  recommendationReason?: string;
}

export type StandardTextDecision = "unreviewed" | "approved" | "none";

export interface VoiceCompletionDraft {
  enabled: boolean;
  autoEnd: boolean;
  terminalCustomerPhrases?: string[];
  terminalAgentPhrases?: string[];
  endDelayMs: number;
  endStatus: string;
}

export interface VoiceExperienceDraft {
  customerStarts: boolean;
  guideTitle: string;
  guideTopNote: string;
  pacing: string;
  verbalGuidance: string;
  endNote: string;
  spokenTone: string;
  completion?: VoiceCompletionDraft;
}

export interface StudioDraft {
  baseId: string;
  title: string;
  description: string;
  learnerGoal: string;
  channels: Channel[];
  agentType: "Core" | "Rx";
  topic: string;
  subtopic: string;
  teamAudience: string;
  customer: CustomerDraft;
  correctProcess: string[];
  prohibitedActions: string[];
  phases: PhaseDraft[];
  objectives: ObjectiveDraft[];
  objectiveApprovalRequired: boolean;
  compatibilityFacts: {
    address: string;
    medication: string;
    urgency: string;
    medicationOrProduct: string;
    clinic: string;
    keyQuestion?: string;
    rootCauseBelief?: string;
    conditionalFollowUp?: string;
  };
  chat: { hotkeyProfile: "core" | "rx"; standardText: StandardTextDraft[]; standardTextDecision: StandardTextDecision; standardTextRecommendations?: StandardTextDraft[] };
  voice: { selectedVoice: string; speed: number; experience?: VoiceExperienceDraft };
  sourceScenarios?: Partial<Record<Channel, ScenarioObject>>;
  sourceOverlay?: boolean;
}

export function createDefaultVoiceExperience(spokenTone = ""): VoiceExperienceDraft {
  return {
    customerStarts: true,
    guideTitle: "Coach Chewy Guidance",
    guideTopNote: "This activity evaluates only the approved learning objectives.",
    pacing: "Use warm, natural pacing and wait for completed learner thoughts.",
    verbalGuidance: "",
    endNote: "After the conversation is complete, click End to receive feedback.",
    spokenTone,
  };
}

export function defaultConditionalFollowUp(customer: CustomerDraft): string {
  return [
    ...customer.facts.map((fact) => `Approved customer fact: ${fact}`),
    ...customer.behaviorRules,
    ...customer.conditionalFollowUps,
    ...customer.revealOnlyWhenAsked.map((fact) => `Share only when asked: ${fact}`),
  ].join(" ");
}

interface GradingModel {
  mode: string;
  evaluationMethod?: string;
  scoreAggregation?: string;
  passingScore?: number;
  objectives?: ObjectiveDraft[];
  [key: string]: unknown;
}

export interface ScenarioObject {
  id: string;
  version: string | number;
  status: string;
  updatedAt: string;
  channels: Channel[];
  label: string;
  title: string;
  catalog: Record<string, unknown> & { groupId: string };
  simulation: {
    sourceTranscriptMetadata: Record<string, unknown>;
    managerOnlyIdealResponses: Array<Record<string, unknown>>;
    approvedTranscript: Array<Record<string, unknown>>;
    stateModel: Record<string, unknown> & {
      chatStepProgression: Array<Record<string, unknown>>;
      voiceStepProgression: Array<Record<string, unknown>>;
    };
  };
  evaluationCriteria: string[];
  runtime: Record<string, unknown> & { replyMode: string };
  facts: Record<string, unknown>;
  coaching: {
    summaryGuidance: string;
    gradingModel: GradingModel;
    qualityChecklist?: unknown;
    behaviorRubric?: unknown;
    [key: string]: unknown;
  };
  learnerGoal: string;
  conversationBetween: Record<string, unknown>;
  frontend: Record<string, unknown> & {
    shared: Record<string, unknown>;
    chat?: Record<string, unknown>;
    voice?: Record<string, unknown> & { selectedVoice: string };
  };
  customer: Record<string, unknown>;
  managerPreview: Record<string, unknown>;
  chatConfig?: Record<string, unknown> & { stepProgression: Array<Record<string, unknown>> };
  voice?: string;
  source?: Record<string, unknown>;
  owner?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScenarioFile {
  filename: string;
  scenario: ScenarioObject;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  fix: string;
}

export type ImportResult =
  | { kind: "focused"; draft: StudioDraft; original: ScenarioObject; requiresObjectiveApproval: false }
  | { kind: "full_conversation_copy"; draft: StudioDraft; original: ScenarioObject; requiresObjectiveApproval: true };

export function composeScenarioFiles(
  draft: StudioDraft,
  options: { now?: string } = {},
): ScenarioFile[] {
  const now = options.now || new Date().toISOString();
  const prepared = normalizeDraftLists(draft);
  const baseId = normalizeBaseId(prepared.baseId);
  const channels = [...new Set(prepared.channels)].filter(isChannel);
  return orderedChannels(channels).map((channel) => {
    const id = `${baseId}_${channel}`;
    const scenario = composeScenario(prepared, channel, id, baseId, now);
    return { filename: `${id}.json`, scenario };
  });
}

export function validateScenarioFiles(files: ScenarioFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  files.forEach(({ filename, scenario }, index) => {
    const prefix = `files[${index}].scenario`;
    const channel = scenario.channels[0];
    if (scenario.channels.length !== 1 || !isChannel(channel)) {
      issues.push(issue("one_channel_required", `${prefix}.channels`, "Each scenario file must contain exactly one channel.", "Choose either chat or voice for this file."));
      return;
    }
    const expectedBase = stripChannelSuffix(scenario.catalog.groupId || scenario.id);
    const expectedId = `${expectedBase}_${channel}`;
    if (!scenario.id.endsWith(`_${channel}`)) {
      issues.push(issue(
        "id_channel_mismatch",
        `${prefix}.id`,
        `${channel === "chat" ? "Chat" : "Voice"} scenario IDs must end in _${channel}.`,
        `Use ${expectedId} as the scenario ID and filename.`,
      ));
    }
    if (filename !== `${scenario.id}.json`) {
      issues.push(issue("filename_id_mismatch", `files[${index}].filename`, "The filename must match the scenario ID.", `Rename the file to ${scenario.id}.json.`));
    }
    if (scenario.coaching.gradingModel?.mode !== "focused_learning_objectives") {
      issues.push(issue("focused_objectives_required", `${prefix}.coaching.gradingModel.mode`, "V1 supports Learning objective evaluation only.", "Create a learning-objective copy and approve its objectives."));
    }
    if (scenario.coaching.qualityChecklist !== undefined || scenario.coaching.behaviorRubric !== undefined) {
      issues.push(issue("legacy_behavior_scoring", `${prefix}.coaching`, "Learning-objective scenarios cannot include Customer Care behavior scoring.", "Remove qualityChecklist and behaviorRubric."));
    }
    if (!Array.isArray(scenario.coaching.gradingModel?.objectives) || scenario.coaching.gradingModel.objectives.length === 0) {
      issues.push(issue("objectives_required", `${prefix}.coaching.gradingModel.objectives`, "Add at least one approved learning objective.", "Add an objective with a label, description, and observable criteria."));
    }
    if (JSON.stringify(scenario).includes("pauseAfter")) {
      issues.push(issue("unsupported_pause_after", prefix, "Rise guidance cannot include pauseAfter.", "Put response dependencies directly in the guidance text."));
    }
  });
  return issues;
}

export function importScenarioJson(source: string, mode: ImportMode): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("The uploaded file is not valid JSON. Fix the JSON syntax and upload it again.");
  }
  const scenarios = extractScenarios(parsed);
  validateImportedSet(scenarios);
  assertSupportedGuideSections(scenarios);
  const original = structuredClone(scenarios[0]);
  const focused = scenarios.every(isFocusedScenario);
  if (!focused && mode === "improve") {
    throw new Error("Full conversation evaluation files cannot be improved in V1. Choose Create similar from JSON to make a learning-objective copy.");
  }
  if (mode === "improve" && scenarios.length === 2) assertCompatibleSiblingPair(scenarios);
  const draft = scenariosToDraft(scenarios);
  if (focused) {
    return { kind: "focused", draft, original, requiresObjectiveApproval: false };
  }
  return {
    kind: "full_conversation_copy",
    draft: {
      ...draft,
      baseId: `${stripChannelSuffix(draft.baseId)}_learning_objective_copy`,
      objectives: [],
      objectiveApprovalRequired: true,
    },
    original,
    requiresObjectiveApproval: true,
  };
}

function composeScenario(draft: StudioDraft, channel: Channel, id: string, baseId: string, now: string): ScenarioObject {
  const sourceScenario = draft.sourceScenarios?.[channel];
  if (sourceScenario && draft.sourceOverlay !== true) return structuredClone(sourceScenario);
  const voiceExperience = draft.voice.experience ?? createDefaultVoiceExperience(draft.customer.tone);
  const behaviorRules = uniqueStrings([
    ...draft.customer.behaviorRules,
    ...(channel === "voice" ? voiceRoleRules(draft.customer.name) : []),
  ]);
  const chatProgression = channel === "chat" ? draft.phases.flatMap((phase, index) => phase.customerRemainsSilent ? [] : [{
    id: index,
    label: phase.title,
    match: phase.learnerActions,
    customerResponse: phase.partnerResponse,
    scenarioPathHint: phase.id,
  }]) : [];
  const voiceProgression = channel === "voice" ? draft.phases.flatMap((phase, index) => phase.customerRemainsSilent ? [] : [{
    id: index,
    label: phase.title,
    trigger: `Use after the learner completes this action: ${phase.learnerActions.join(" ")} Wait for the completed learner thought.`,
    customerResponse: phase.partnerResponse,
  }]) : [];
  const approvedTranscript = [
    { customer: draft.customer.openingLine, idealAgentResponse: draft.phases[0]?.learnerActions.join(" ") || draft.learnerGoal, guidance: draft.phases[0]?.managerGuidance || "Opening customer line." },
    ...draft.phases.flatMap((phase, index) => {
      if (phase.customerRemainsSilent) return [];
      const next = draft.phases[index + 1];
      return [{
        customer: phase.partnerResponse,
        idealAgentResponse: next?.learnerActions.join(" ") || "No additional learner response is required. After the customer finishes, click End to receive feedback.",
        guidance: next?.managerGuidance || next?.coachGuidance.join(" ") || "The customer has completed the focused activity.",
      }];
    }),
  ];
  const guideSections = draft.phases.map((phase, index) => ({
    sourceLabel: phase.guideSourceLabel ?? `Creator-approved guidance ${index + 1}`,
    channel,
    source: phase.guideSource ?? "manager_coaching_reminder",
    title: phase.guideTitle ?? `${index + 1}. ${phase.title}`,
    body: phase.guideBody ?? phase.learnerActions.join(" "),
    bullets: phase.coachGuidance,
  }));
  const standardTextGuideSections = channel === "chat" && draft.chat.standardTextDecision === "approved"
    ? draft.chat.standardText.map((item, index) => ({
        sourceLabel: `Creator-approved Standard Text guidance ${index + 1}`,
        channel,
        source: "manager_coaching_reminder",
        title: `Standard Text: ${item.hotkey.toUpperCase()} (${item.category})`,
        body: item.insertionMoment,
        bullets: [
          `Press F8 and enter ${item.hotkey.toUpperCase()} to insert the approved response.`,
          item.customization,
        ],
      }))
    : [];
  const evaluationCriteria = draft.objectives.flatMap((objective) => objective.criteria);
  const shared = {
    introInstructions: ["Review the scenario briefing before starting.", "Use Coach Chewy guidance without reading it aloud."],
    learnerBriefing: {
      about: draft.description,
      objectives: draft.objectives.map((objective) => objective.label),
      evaluationFocus: ["This activity uses Learning objective evaluation.", "Each objective is checked against its observable criteria."],
      goals: [...draft.correctProcess, ...draft.prohibitedActions.map((action) => `Avoid: ${action}`)],
    },
  };
  const runtime: ScenarioObject["runtime"] = { replyMode: "dynamic_customer_responder" };
  if (channel === "voice") {
    runtime.tuning = { version: 1, customer: { emotionIntensity: 3, patience: 4, resistance: 2, responseLength: "brief" }, conversation: { informationReveal: [], objectionBehavior: "gap_only", recoveryTolerance: 2 }, voice: { id: draft.voice.selectedVoice, speed: draft.voice.speed } };
  }
  const frontend: ScenarioObject["frontend"] = { shared };
  if (channel === "chat") {
    frontend.chat = {
      customerDisplayName: draft.customer.name,
      guideTitle: "Coach Chewy Guidance",
      guideSections: [...guideSections, ...standardTextGuideSections],
      standardText: draft.chat.standardTextDecision === "approved" ? draft.chat.standardText.map(({ hotkey, template, notes }) => ({ hotkey, template, notes })) : [],
      standardTextGuidance: draft.chat.standardTextDecision === "approved"
        ? draft.chat.standardText.map(composeStandardTextGuidance).join("\n\n")
        : "No approved Standard Text is required for this scenario.",
      hotkeyProfile: draft.chat.hotkeyProfile,
      initialTranscript: [{
        role: "assistant",
        label: draft.customer.name,
        scenarioPathHint: "frontend.chat.initialTranscript[0]",
        content: draft.customer.openingLine,
        meta: draft.customer.name,
      }],
    };
  } else {
    frontend.voice = {
      customerStarts: voiceExperience.customerStarts,
      customerDisplayName: draft.customer.name,
      guideTitle: voiceExperience.guideTitle,
      guideTopNote: voiceExperience.guideTopNote,
      pacing: voiceExperience.pacing,
      selectedVoice: draft.voice.selectedVoice,
      guideSections,
      ...(voiceExperience.verbalGuidance ? { verbalGuidance: voiceExperience.verbalGuidance } : {}),
      endNote: voiceExperience.endNote,
      ...(voiceExperience.completion ? { completion: voiceExperience.completion } : {}),
      ...(voiceExperience.spokenTone ? { spokenTone: voiceExperience.spokenTone } : {}),
    };
  }
  const scenario: ScenarioObject = {
    id,
    version: "1.0.0",
    status: "published",
    updatedAt: now,
    channels: [channel],
    label: draft.title,
    title: draft.title,
    source: { type: "scratch", anonymized: true, generalized: true },
    owner: { name: "", team: "", email: "" },
    catalog: {
      scenarioType: "Learning Objective Evaluation",
      agentType: draft.agentType,
      primarySkillFocus: draft.objectives[0]?.label || draft.subtopic,
      groupId: baseId,
      description: draft.description,
      skillFocus: draft.objectives[0]?.label || draft.subtopic,
      title: draft.title,
      practiceDescription: `Practice ${draft.learnerGoal}`,
      tags: [snakeId(draft.topic), snakeId(draft.subtopic), draft.agentType.toLowerCase(), channel, "manager_generated", "dynamic_customer_responder"].filter(Boolean),
      teamAudience: draft.teamAudience,
      difficulty: "beginner",
      skillId: draft.objectives[0]?.id || snakeId(draft.subtopic),
      qualityBehavior: "",
      domain: "customer_support",
      topic: draft.topic,
      customerEmotion: draft.customer.tone,
      trainingTopic: draft.teamAudience,
      subtopic: draft.subtopic,
      label: draft.title,
      searchDescription: draft.description,
      estimatedDurationMinutes: 6,
    },
    simulation: {
      sourceTranscriptMetadata: { scenarioType: "Learning Objective Evaluation", sourceType: "creator_input", qualityBehavior: "", topic: draft.topic, selectedChannels: [channel], customerEmotion: draft.customer.tone, subtopic: draft.subtopic, sourceMaterial: `${draft.description} Approved customer facts: ${draft.customer.facts.join(" ")} Correct process: ${draft.correctProcess.join(" ")} Avoid: ${draft.prohibitedActions.join(" ")}` },
      managerOnlyIdealResponses: draft.phases.map((phase, index) => ({ beat: index + 1, guidance: phase.managerGuidance ?? phase.coachGuidance.join(" "), idealAgentResponse: phase.learnerActions.join(" ") })),
      approvedTranscript,
      stateModel: { chatStepProgression: chatProgression, voiceStepProgression: voiceProgression, behaviorTriggers: [] },
    },
    evaluationCriteria,
    runtime,
    facts: {
      keyQuestion: draft.compatibilityFacts.keyQuestion ?? draft.customer.goal,
      knownFacts: draft.customer.facts,
      shareOnlyIfAsked: draft.customer.revealOnlyWhenAsked,
      address: draft.compatibilityFacts.address,
      medication: draft.compatibilityFacts.medication,
      rootCauseBelief: draft.compatibilityFacts.rootCauseBelief ?? draft.customer.goal,
      customerName: draft.customer.name,
      petName: draft.customer.petName,
      urgency: draft.compatibilityFacts.urgency,
      medicationOrProduct: draft.compatibilityFacts.medicationOrProduct,
      allowedObjections: draft.customer.objections,
      closingLine: draft.customer.closingLine,
      clinic: draft.compatibilityFacts.clinic,
      conditionalFollowUp: draft.compatibilityFacts.conditionalFollowUp ?? defaultConditionalFollowUp(draft.customer),
    },
    coaching: {
      summaryGuidance: `Evaluate only the approved learning objectives for ${draft.title}.`,
      gradingModel: { mode: "focused_learning_objectives", evaluationMethod: "criteria_checklist", scoreAggregation: "average_objectives", passingScore: 80, objectives: draft.objectives },
    },
    learnerGoal: draft.learnerGoal,
    conversationBetween: { aiPersonality: `${draft.customer.name} is ${draft.customer.tone}. ${behaviorRules.join(" ")}`, aiRole: `${draft.customer.name}, Conversation Partner`, aiStart: draft.customer.openingLine, participantRole: `${draft.agentType} Learner` },
    frontend,
    customer: { opening: { chat: channel === "chat" ? draft.customer.openingLine : "", voice: channel === "voice" ? draft.customer.openingLine : "" }, persona: { name: draft.customer.name, tone: draft.customer.tone, goal: draft.customer.goal }, behavior: { rules: behaviorRules, conditionalFollowUps: [...draft.customer.facts.map((fact) => `Approved customer fact: ${fact}`), ...draft.customer.conditionalFollowUps], allowedObjections: draft.customer.objections, softeningRule: `Become satisfied after the learner completes: ${draft.correctProcess.join(" ")}`, closingRule: terminalSilenceRule(draft) ?? `Use this closing only after the learner completes the scenario: ${draft.customer.closingLine}` } },
    managerPreview: { testRevision: "Standalone Conversation Builder draft", latestSuggestion: "Test this JSON in the matching Articulate Rise simulator.", updatedAt: now },
  };
  if (channel === "chat") scenario.chatConfig = { hotkeyProfile: draft.chat.hotkeyProfile, stepProgression: chatProgression };
  if (channel === "voice") scenario.voice = draft.voice.selectedVoice;
  return sourceScenario ? mergeScenarioEnvelope(sourceScenario, scenario, channel) : scenario;
}

function extractScenarios(payload: unknown): ScenarioObject[] {
  if (Array.isArray(payload)) return payload as ScenarioObject[];
  if (!payload || typeof payload !== "object") throw new Error("Upload one scenario JSON object or a chat/voice sibling pair.");
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.scenarios)) return record.scenarios as ScenarioObject[];
  if (record.chatScenario || record.voiceScenario) return [record.chatScenario, record.voiceScenario].filter(Boolean) as ScenarioObject[];
  return [payload as ScenarioObject];
}

function validateImportedSet(scenarios: ScenarioObject[]): void {
  if (scenarios.length < 1 || scenarios.length > 2) throw new Error("Upload one scenario or one chat/voice sibling pair.");
  const channels = scenarios.map((scenario) => scenario.channels);
  if (channels.some((entries) => !Array.isArray(entries) || entries.length !== 1 || !isChannel(entries[0]))) throw new Error("Each uploaded scenario must contain exactly one channel.");
  if (new Set(channels.map(([channel]) => channel)).size !== scenarios.length) throw new Error("A two-file upload must contain one chat scenario and one voice scenario.");
  if (scenarios.length === 2) {
    const bases = scenarios.map((scenario) => stripChannelSuffix(scenario.id));
    const groups = scenarios.map((scenario) => String(scenario.catalog?.groupId || ""));
    if (bases[0] !== bases[1] || groups[0] !== groups[1] || bases[0] !== groups[0]) throw new Error("Chat and voice uploads must be siblings with the same base ID and catalog groupId.");
  }
}

function assertSupportedGuideSections(scenarios: ScenarioObject[]): void {
  for (const scenario of scenarios) {
    const channel = scenario.channels[0];
    const frontend = (channel === "chat" ? scenario.frontend?.chat : scenario.frontend?.voice) as Record<string, unknown> | undefined;
    const sections = Array.isArray(frontend?.guideSections) ? frontend.guideSections : [];
    for (const [index, section] of sections.entries()) {
      if (!section || typeof section !== "object") continue;
      const bullets = (section as Record<string, unknown>).bullets;
      if (Array.isArray(bullets) && bullets.some((bullet) => typeof bullet !== "string")) {
        throw new Error(`Guide section ${index + 1} uses structured bullets that this Builder cannot safely edit yet. Use a scenario with text-only Coach Chewy bullets.`);
      }
    }
  }
}

function scenariosToDraft(scenarios: ScenarioObject[]): StudioDraft {
  const chatScenario = scenarios.find((scenario) => scenario.channels[0] === "chat");
  const voiceScenario = scenarios.find((scenario) => scenario.channels[0] === "voice");
  const primary = chatScenario || voiceScenario || scenarios[0];
  const briefing = primary.frontend?.shared?.learnerBriefing as Record<string, unknown> | undefined;
  const customer = primary.customer as Record<string, unknown>;
  const persona = customer?.persona as Record<string, unknown> | undefined;
  const behavior = customer?.behavior as Record<string, unknown> | undefined;
  const opening = customer?.opening as Record<string, unknown> | undefined;
  const objectives = Array.isArray(primary.coaching?.gradingModel?.objectives) ? primary.coaching.gradingModel.objectives as ObjectiveDraft[] : [];
  const transcript = primary.simulation?.approvedTranscript || [];
  const ideal = primary.simulation?.managerOnlyIdealResponses || [];
  const preferredFrontend = (chatScenario?.frontend?.chat || voiceScenario?.frontend?.voice) as Record<string, unknown> | undefined;
  const guideSections = Array.isArray(preferredFrontend?.guideSections)
    ? (preferredFrontend.guideSections as Array<Record<string, unknown>>)
      .filter((section) => !String(section.sourceLabel || "").startsWith("Creator-approved Standard Text guidance"))
    : [];
  const progression = (chatScenario?.simulation?.stateModel?.chatStepProgression || voiceScenario?.simulation?.stateModel?.voiceStepProgression || []) as Array<Record<string, unknown>>;
  const phaseCount = Math.max(ideal.length, guideSections.length, Math.max(0, transcript.length - 1), progression.length);
  const phases: PhaseDraft[] = Array.from({ length: phaseCount }, (_, index) => {
    const beat = ideal[index] || {};
    const guide = guideSections[index] || {};
    const step = progression[index] || {};
    const transcriptTurn = transcript[index + 1] || {};
    const partnerResponse = String(transcriptTurn.customer || step.customerResponse || "");
    const customerRemainsSilent = index === phaseCount - 1 && !partnerResponse.trim();
    const title = String(guide.title || beat.guidance || step.label || `Phase ${index + 1}`).replace(/^\d+\.\s*/, "");
    return {
      id: snakeId(String(step.scenarioPathHint || title || `phase_${index + 1}`)),
      title,
      learnerActions: arrayOfStrings([beat.idealAgentResponse || guide.body]),
      partnerResponse,
      coachGuidance: arrayOfStrings(guide.bullets).length > 0 ? arrayOfStrings(guide.bullets) : arrayOfStrings([beat.guidance]),
      ...(customerRemainsSilent ? { customerRemainsSilent: true } : {}),
      ...(typeof guide.sourceLabel === "string" ? { guideSourceLabel: guide.sourceLabel } : {}),
      ...(typeof guide.source === "string" ? { guideSource: guide.source } : {}),
      ...(typeof guide.title === "string" ? { guideTitle: guide.title } : {}),
      ...(typeof guide.body === "string" ? { guideBody: guide.body } : {}),
      ...(typeof beat.guidance === "string" ? { managerGuidance: beat.guidance } : {}),
    };
  });
  const chatFrontend = chatScenario?.frontend?.chat as Record<string, unknown> | undefined;
  const chatConfig = chatScenario?.chatConfig as Record<string, unknown> | undefined;
  const rawStandardText = chatFrontend?.standardText;
  const hasStandardTextDecision = Array.isArray(rawStandardText);
  const standardText = normalizeStandardText(rawStandardText, String(chatFrontend?.standardTextGuidance || ""));
  const importedHotkey = String(chatFrontend?.hotkeyProfile || chatConfig?.hotkeyProfile || "");
  const voiceFrontend = voiceScenario?.frontend?.voice as Record<string, unknown> | undefined;
  const voiceTuning = voiceScenario?.runtime?.tuning as Record<string, unknown> | undefined;
  const voiceTuningVoice = voiceTuning?.voice as Record<string, unknown> | undefined;
  const knownFacts = arrayOfStrings(primary.facts?.knownFacts);
  const briefingGoals = arrayOfStrings(briefing?.goals);
  const importedCriteria = arrayOfStrings(primary.evaluationCriteria);
  const focusedScenario = isFocusedScenario(primary);
  return {
    baseId: stripChannelSuffix(primary.id),
    title: primary.title || primary.label,
    description: String(primary.catalog?.description || briefing?.about || ""),
    learnerGoal: primary.learnerGoal || "",
    channels: orderedChannels(scenarios.map((scenario) => scenario.channels[0]).filter(isChannel)),
    agentType: primary.catalog?.agentType === "Rx" ? "Rx" : "Core",
    topic: String(primary.catalog?.topic || "Conversation practice"),
    subtopic: String(primary.catalog?.subtopic || "Learning objective practice"),
    teamAudience: String(primary.catalog?.teamAudience || "Chewy"),
    customer: {
      name: String(persona?.name || primary.facts?.customerName || "Conversation Partner"),
      petName: String(primary.facts?.petName || ""),
      tone: String(persona?.tone || primary.catalog?.customerEmotion || "Neutral"),
      goal: String(persona?.goal || primary.facts?.keyQuestion || ""),
      openingLine: String(opening?.chat || opening?.voice || primary.conversationBetween?.aiStart || ""),
      facts: knownFacts,
      revealOnlyWhenAsked: arrayOfStrings(primary.facts?.shareOnlyIfAsked),
      objections: arrayOfStrings(behavior?.allowedObjections || primary.facts?.allowedObjections),
      behaviorRules: arrayOfStrings(behavior?.rules).filter((rule) => !isBuilderVoiceRoleRule(rule)),
      conditionalFollowUps: arrayOfStrings(behavior?.conditionalFollowUps).filter((entry) => !entry.startsWith("Approved customer fact:")),
      closingLine: String(primary.facts?.closingLine || ""),
    },
    correctProcess: uniqueStrings([
      ...briefingGoals.filter((entry) => !entry.startsWith("Avoid:")),
      ...(!focusedScenario ? importedCriteria : []),
    ]),
    prohibitedActions: uniqueStrings([
      ...briefingGoals.filter((entry) => entry.startsWith("Avoid:")).map((entry) => entry.replace(/^Avoid:\s*/, "")),
      ...(!focusedScenario ? extractBoundaryActions([...briefingGoals, ...importedCriteria]) : []),
    ]),
    phases,
    objectives,
    objectiveApprovalRequired: false,
    compatibilityFacts: {
      address: String(primary.facts?.address || ""),
      medication: String(primary.facts?.medication || ""),
      urgency: String(primary.facts?.urgency || ""),
      medicationOrProduct: String(primary.facts?.medicationOrProduct || ""),
      clinic: String(primary.facts?.clinic || ""),
      keyQuestion: String(primary.facts?.keyQuestion ?? ""),
      rootCauseBelief: String(primary.facts?.rootCauseBelief ?? ""),
      conditionalFollowUp: String(primary.facts?.conditionalFollowUp ?? ""),
    },
    chat: {
      hotkeyProfile: importedHotkey === "rx" ? "rx" : importedHotkey === "core" ? "core" : primary.catalog?.agentType === "Rx" ? "rx" : "core",
      standardText,
      standardTextDecision: hasStandardTextDecision ? (standardText.length > 0 ? "approved" : "none") : "unreviewed",
      standardTextRecommendations: [],
    },
    voice: {
      selectedVoice: String(voiceScenario?.voice || voiceFrontend?.selectedVoice || voiceTuningVoice?.id || "marin"),
      speed: typeof voiceTuningVoice?.speed === "number" ? voiceTuningVoice.speed : 1,
      experience: importVoiceExperience(voiceFrontend, String(persona?.tone || primary.catalog?.customerEmotion || "")),
    },
    sourceScenarios: Object.fromEntries(scenarios.map((scenario) => [scenario.channels[0], structuredClone(scenario)])),
    sourceOverlay: false,
  };
}

function isFocusedScenario(scenario: ScenarioObject): boolean {
  return scenario.coaching?.gradingModel?.mode === "focused_learning_objectives" && scenario.coaching.qualityChecklist === undefined && scenario.coaching.behaviorRubric === undefined;
}

function issue(code: string, path: string, message: string, fix: string): ValidationIssue { return { code, path, message, fix }; }
function isChannel(value: unknown): value is Channel { return value === "chat" || value === "voice"; }
function orderedChannels(channels: Channel[]): Channel[] { return (["chat", "voice"] as Channel[]).filter((channel) => channels.includes(channel)); }
function stripChannelSuffix(id: string): string { return String(id || "scenario").replace(/_(?:chat|voice)$/i, ""); }
function normalizeBaseId(id: string): string { return stripChannelSuffix(snakeId(id)) || "conversation_practice"; }
function snakeId(value: string): string { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80); }
function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.map((entry) => String(entry || "").trim()).filter(Boolean) : []; }
function normalizeStandardText(value: unknown, guidance: string): StandardTextDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const hotkey = String(record.hotkey || "").trim();
    const template = String(record.template || "").trim();
    if (!hotkey && !template) return [];
    const approvedGuidance = guidanceForHotkey(guidance, hotkey);
    const parsed = parseStandardTextGuidance(approvedGuidance, hotkey);
    return [{
      hotkey,
      category: String(record.category || parsed.category || "Imported approved Standard Text"),
      template,
      insertionMoment: String(record.insertionMoment || parsed.insertionMoment || "Use at the approved point in the conversation."),
      customization: String(record.customization || parsed.customization || "Review and customize any scenario-specific placeholders before sending."),
      notes: arrayOfStrings(record.notes),
      approvedGuidance,
    }];
  });
}

function guidanceForHotkey(guidance: string, hotkey: string): string {
  const trimmed = guidance.trim();
  if (!trimmed) return "";
  const sections = trimmed.split(/\n{2,}/);
  return sections.find((section) => section.toLowerCase().includes(hotkey.toLowerCase())) || (sections.length === 1 ? sections[0] : "");
}

function parseStandardTextGuidance(guidance: string, hotkey: string): { category: string; insertionMoment: string; customization: string } {
  const category = guidance.match(new RegExp(`${escapeRegExp(hotkey)}\\s*\\(([^)]+)\\)`, "i"))?.[1]?.trim() || "";
  const insertionMoment = guidance.match(/\)\s*-\s*(.+?)\s+Press F8/i)?.[1]?.trim() || "";
  const customization = guidance.match(/\b(customize .+?)(?:,?\s+and send the exact approved response:)/i)?.[1]?.trim() || "";
  return { category, insertionMoment, customization };
}

function composeStandardTextGuidance(item: StandardTextDraft): string {
  if (item.approvedGuidance.trim()) return item.approvedGuidance.trim();
  return `${item.hotkey.toUpperCase()} (${item.category}) - ${item.insertionMoment} Press F8, enter ${item.hotkey.toUpperCase()}, ${item.customization.replace(/[.]$/, "")}, and send the exact approved response: ${item.template}`;
}

function voiceRoleRules(customerName: string): string[] {
  return [
    `Remain ${customerName}, the customer, for every response.`,
    "Never perform, narrate, or claim any Chewy-agent action, account change, verification, refund, order lookup, or system action.",
    "Wait for a completed learner thought before responding; treat short backchannels such as mm-hmm and okay as listening cues, not a completed turn.",
  ];
}

function isBuilderVoiceRoleRule(rule: string): boolean {
  return /^Remain .+, the customer, for every response\.$/.test(rule)
    || rule === "Never perform, narrate, or claim any Chewy-agent action, account change, verification, refund, order lookup, or system action."
    || rule === "Wait for a completed learner thought before responding; treat short backchannels such as mm-hmm and okay as listening cues, not a completed turn.";
}

function importVoiceExperience(frontend: Record<string, unknown> | undefined, spokenTone: string): VoiceExperienceDraft {
  const defaults = createDefaultVoiceExperience(spokenTone);
  const completion = frontend?.completion;
  return {
    customerStarts: typeof frontend?.customerStarts === "boolean" ? frontend.customerStarts : defaults.customerStarts,
    guideTitle: typeof frontend?.guideTitle === "string" ? frontend.guideTitle : defaults.guideTitle,
    guideTopNote: typeof frontend?.guideTopNote === "string" ? frontend.guideTopNote : defaults.guideTopNote,
    pacing: typeof frontend?.pacing === "string" ? frontend.pacing : defaults.pacing,
    verbalGuidance: typeof frontend?.verbalGuidance === "string" ? frontend.verbalGuidance : defaults.verbalGuidance,
    endNote: typeof frontend?.endNote === "string" ? frontend.endNote : defaults.endNote,
    spokenTone: typeof frontend?.spokenTone === "string" ? frontend.spokenTone : defaults.spokenTone,
    ...(isVoiceCompletion(completion) ? { completion: normalizeVoiceCompletion(completion) } : {}),
  };
}

function isVoiceCompletion(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const completion = value as Record<string, unknown>;
  return typeof completion.enabled === "boolean"
    && typeof completion.autoEnd === "boolean"
    && typeof completion.endDelayMs === "number"
    && Number.isFinite(completion.endDelayMs)
    && typeof completion.endStatus === "string"
    && (completion.terminalCustomerPhrases === undefined || (Array.isArray(completion.terminalCustomerPhrases) && completion.terminalCustomerPhrases.every((entry) => typeof entry === "string")))
    && (completion.terminalAgentPhrases === undefined || (Array.isArray(completion.terminalAgentPhrases) && completion.terminalAgentPhrases.every((entry) => typeof entry === "string")));
}

function normalizeVoiceCompletion(value: Record<string, unknown>): VoiceCompletionDraft {
  return {
    enabled: value.enabled as boolean,
    autoEnd: value.autoEnd as boolean,
    ...(value.terminalCustomerPhrases !== undefined ? { terminalCustomerPhrases: arrayOfStrings(value.terminalCustomerPhrases) } : {}),
    ...(value.terminalAgentPhrases !== undefined ? { terminalAgentPhrases: arrayOfStrings(value.terminalAgentPhrases) } : {}),
    endDelayMs: value.endDelayMs as number,
    endStatus: value.endStatus as string,
  };
}

function assertCompatibleSiblingPair(scenarios: ScenarioObject[]): void {
  const signatures = scenarios.map(sharedScenarioSignature);
  if (JSON.stringify(canonicalize(signatures[0])) !== JSON.stringify(canonicalize(signatures[1]))) {
    throw new Error("This chat/voice pair contains channel-specific wording that V1 cannot safely merge for improvement. Improve each file separately or choose Create similar from JSON.");
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function sharedScenarioSignature(scenario: ScenarioObject): unknown {
  const channel = scenario.channels[0];
  const channelFrontend = (channel === "chat" ? scenario.frontend?.chat : scenario.frontend?.voice) as Record<string, unknown> | undefined;
  const opening = scenario.customer?.opening as Record<string, unknown> | undefined;
  const guideSections = Array.isArray(channelFrontend?.guideSections) ? channelFrontend.guideSections as Array<Record<string, unknown>> : [];
  const progression = (channel === "chat" ? scenario.simulation?.stateModel?.chatStepProgression : scenario.simulation?.stateModel?.voiceStepProgression) || [];
  return {
    title: scenario.title,
    learnerGoal: scenario.learnerGoal,
    catalog: {
      agentType: scenario.catalog?.agentType,
      description: scenario.catalog?.description,
      topic: scenario.catalog?.topic,
      subtopic: scenario.catalog?.subtopic,
      teamAudience: scenario.catalog?.teamAudience,
    },
    briefing: scenario.frontend?.shared?.learnerBriefing,
    facts: scenario.facts,
    coaching: scenario.coaching,
    persona: scenario.customer?.persona,
    behavior: normalizeSharedBehavior(scenario.customer?.behavior),
    opening: opening?.[channel] || scenario.conversationBetween?.aiStart,
    approvedTranscript: scenario.simulation?.approvedTranscript,
    managerOnlyIdealResponses: scenario.simulation?.managerOnlyIdealResponses,
    guideSections: guideSections
      .filter((section) => !String(section.sourceLabel || "").startsWith("Creator-approved Standard Text guidance"))
      .map((section) => ({ title: section.title, body: section.body, bullets: section.bullets })),
    progression: Array.isArray(progression) ? progression.map((step) => ({
      label: step.label,
      customerResponse: step.customerResponse,
    })) : [],
  };
}

function normalizeSharedBehavior(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const behavior = value as Record<string, unknown>;
  return {
    ...behavior,
    rules: arrayOfStrings(behavior.rules).filter((rule) => !isBuilderVoiceRoleRule(rule)),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDraftLists(draft: StudioDraft): StudioDraft {
  return {
    ...draft,
    objectiveApprovalRequired: draft.objectiveApprovalRequired === true,
    compatibilityFacts: draft.compatibilityFacts ?? {
      address: "",
      medication: "",
      urgency: draft.description,
      medicationOrProduct: "",
      clinic: "",
    },
    customer: {
      ...draft.customer,
      facts: arrayOfStrings(draft.customer.facts),
      revealOnlyWhenAsked: arrayOfStrings(draft.customer.revealOnlyWhenAsked),
      objections: arrayOfStrings(draft.customer.objections),
      behaviorRules: arrayOfStrings(draft.customer.behaviorRules),
      conditionalFollowUps: arrayOfStrings(draft.customer.conditionalFollowUps),
    },
    correctProcess: arrayOfStrings(draft.correctProcess),
    prohibitedActions: arrayOfStrings(draft.prohibitedActions),
    phases: draft.phases.map((phase) => ({
      ...phase,
      learnerActions: arrayOfStrings(phase.learnerActions),
      coachGuidance: arrayOfStrings(phase.coachGuidance),
    })),
    objectives: draft.objectives.map((objective) => ({
      ...objective,
      criteria: arrayOfStrings(objective.criteria),
    })),
    chat: {
      ...draft.chat,
      standardText: draft.chat.standardText.map((item) => ({
        hotkey: item.hotkey || "",
        category: item.category || "Approved Standard Text",
        template: item.template || "",
        insertionMoment: item.insertionMoment || "Use at the approved point in the conversation.",
        customization: item.customization || "Review and customize any scenario-specific placeholders before sending.",
        notes: arrayOfStrings(item.notes),
        approvedGuidance: item.approvedGuidance || "",
      })),
      standardTextRecommendations: (draft.chat.standardTextRecommendations ?? []).map((item) => ({
        ...item,
        notes: arrayOfStrings(item.notes),
      })),
    },
  };
}

function mergeScenarioEnvelope(source: ScenarioObject, generated: ScenarioObject, channel: Channel): ScenarioObject {
  const merged = deepMerge(source, generated) as ScenarioObject;
  merged.version = source.version;
  merged.status = source.status;
  if (source.source !== undefined) merged.source = structuredClone(source.source);
  if (source.owner !== undefined) merged.owner = structuredClone(source.owner);

  const sourceTuning = source.runtime?.tuning;
  const generatedTuning = generated.runtime?.tuning;
  if (channel === "voice" && sourceTuning && typeof sourceTuning === "object" && generatedTuning && typeof generatedTuning === "object") {
    const generatedVoice = (generatedTuning as Record<string, unknown>).voice;
    merged.runtime.tuning = deepMerge(sourceTuning, generatedVoice && typeof generatedVoice === "object" ? { voice: generatedVoice } : {});
  } else if (channel === "voice" && sourceTuning === undefined) {
    delete merged.runtime.tuning;
  }

  if (source.managerPreview !== undefined) merged.managerPreview = structuredClone(source.managerPreview);
  return merged;
}

function deepMerge(base: unknown, overlay: unknown): unknown {
  if (Array.isArray(overlay)) return structuredClone(overlay);
  if (!overlay || typeof overlay !== "object") return structuredClone(overlay);
  const baseRecord = base && typeof base === "object" && !Array.isArray(base) ? base as Record<string, unknown> : {};
  const result: Record<string, unknown> = structuredClone(baseRecord);
  for (const [key, value] of Object.entries(overlay as Record<string, unknown>)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(baseRecord[key], value)
      : structuredClone(value);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function terminalSilenceRule(draft: StudioDraft): string | null {
  const phase = draft.phases.find((candidate) => candidate.customerRemainsSilent);
  if (!phase) return null;
  return `After the learner completes this final action, remain silent and do not provide another customer response: ${phase.learnerActions.join(" ")}`;
}

function extractBoundaryActions(values: string[]): string[] {
  const actions: string[] = [];
  for (const value of values) {
    const text = value.replace(/^Guardrails:\s*/i, "").trim();
    if (/^(?:avoid|do not|never|must not)\b/i.test(text)) actions.push(ensurePeriod(text));

    for (const match of text.matchAll(/\bwithout\s+([^.;,]+)/gi)) {
      actions.push(`Do not ${toBaseVerbPhrase(match[1])}.`);
    }
    if (/\bvalidat(?:e|ion)\b[^.]*\bbefore\b[^.]*\b(?:access|accessing)\b/i.test(text)) {
      actions.push("Do not access the account before completing customer validation.");
    }
    if (/\bconsent\b[^.]*\bbefore\b[^.]*\b(?:process|processing|confirm|confirming)\b/i.test(text)) {
      actions.push("Do not process or confirm the refund without customer consent.");
    }
    if (/\b(?:optional offerings|autoship|chewy app)\b[^.]*\bonly after\b[^.]*\bresolv/i.test(text)) {
      actions.push("Do not present optional offerings before resolving the primary concern.");
    }
    for (const match of text.matchAll(/\bstay(?:ing)? within\s+([^.;,]+)/gi)) {
      actions.push(`Do not exceed ${match[1].trim()}.`);
    }
    if (/\bexpected timing\b/i.test(text)) actions.push("Do not guarantee timing.");
    if (/\bpressure-free\b/i.test(text)) actions.push("Do not pressure the customer to accept optional offerings.");
  }
  return uniqueStrings(actions.map(cleanSentence).filter(Boolean));
}

function toBaseVerbPhrase(value: string): string {
  const phrase = value.trim();
  const [first = "", ...rest] = phrase.split(/\s+/);
  const normalized = first.toLowerCase();
  const verb = ({
    accessing: "access", changing: "change", confirming: "confirm", exceeding: "exceed", giving: "give",
    guaranteeing: "guarantee", making: "make", moving: "move", offering: "offer", placing: "place", processing: "process",
    promising: "promise", reading: "read", taking: "take", updating: "update",
  } as Record<string, string>)[normalized] ?? normalized;
  return [verb, ...rest].join(" ").trim();
}

function cleanSentence(value: string): string {
  return ensurePeriod(value.replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim());
}

function ensurePeriod(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
