const COMPONENT_LIBRARY_OWNER = "Conversation Builder system library";

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

const COMPONENTS = [
  {
    id: "persona_concerned_cooperative",
    kind: "persona",
    name: "Concerned and cooperative",
    description: "A conversation partner who wants clarity and gives the learner room to respond.",
    appliesTo: "Conversation Partner mood and behavior settings",
    provenance: "Repository convention: concerned partner tone and cooperative tuning preset",
    values: {
      customerEmotion: "Concerned",
      tuning: {
        emotionIntensity: 2,
        patience: 5,
        resistance: 1,
        responseLength: "balanced"
      }
    }
  },
  {
    id: "persona_frustrated_reasonable",
    kind: "persona",
    name: "Frustrated but reasonable",
    description: "A conversation partner who needs direct acknowledgment and a clear response.",
    appliesTo: "Conversation Partner mood and behavior settings",
    provenance: "Repository convention: frustrated-but-reasonable tone and frustrated tuning preset",
    values: {
      customerEmotion: "Frustrated but reasonable",
      tuning: {
        emotionIntensity: 4,
        patience: 2,
        resistance: 4,
        responseLength: "brief"
      }
    }
  },
  {
    id: "persona_neutral_direct",
    kind: "persona",
    name: "Neutral and direct",
    description: "A composed conversation partner who shares only what the current conversation calls for.",
    appliesTo: "Conversation Partner mood and behavior settings",
    provenance: "Repository convention: neutral partner tone and low-resistance tuning",
    values: {
      customerEmotion: "Neutral",
      tuning: {
        emotionIntensity: 1,
        patience: 4,
        resistance: 1,
        responseLength: "brief"
      }
    }
  },
  {
    id: "objective_clarify_reason",
    kind: "objective",
    name: "Clarify the reason for contact",
    description: "Evaluate whether the Learner understands the Conversation Partner's stated need before moving forward.",
    appliesTo: "One focused learning objective and its success criteria",
    provenance: "Repository convention: focused_learning_objectives with criteria_checklist",
    values: {
      objective: {
        id: "clarify_reason_for_contact",
        label: "Clarify the reason for contact",
        description: "Clarify why the Conversation Partner started the conversation before discussing a resolution.",
        criteria: [
          "Ask a relevant discovery question.",
          "Accurately summarize the Conversation Partner's stated need."
        ]
      }
    }
  },
  {
    id: "objective_set_expectations",
    kind: "objective",
    name: "Set clear expectations",
    description: "Evaluate whether the learner explains the approved next step clearly.",
    appliesTo: "One focused learning objective and its success criteria",
    provenance: "Repository convention: focused_learning_objectives with observable criteria",
    values: {
      objective: {
        id: "set_clear_expectations",
        label: "Set clear expectations",
        description: "Explain the approved next step in clear, audience-friendly language.",
        criteria: [
          "Explain the approved next step without adding unsupported details.",
          "Check that the Conversation Partner understands what will happen next."
        ]
      }
    }
  },
  {
    id: "objective_recap_close",
    kind: "objective",
    name: "Recap and close",
    description: "Evaluate whether the learner confirms the outcome and any remaining need.",
    appliesTo: "One focused learning objective and its success criteria",
    provenance: "Repository convention: focused_learning_objectives with observable close criteria",
    values: {
      objective: {
        id: "recap_and_close",
        label: "Recap and close",
        description: "Confirm the agreed action and close with clear ownership.",
        criteria: [
          "Recap the agreed action and approved expectation.",
          "Check for any remaining need before closing."
        ]
      }
    }
  },
  {
    id: "guidance_match_handling",
    kind: "guidance",
    name: "Match the conversation flow",
    description: "Create one Coach Chewy card for each current conversation phase.",
    appliesTo: "The guidance version currently selected in Conversation Flow",
    provenance: "Repository convention: numbered guideSections aligned to expected learner behaviors",
    values: { mode: "from_handling" }
  },
  {
    id: "guidance_understand_act_confirm",
    kind: "guidance",
    name: "Understand, act, confirm",
    description: "Start with three editable cards for a clear beginning, middle, and close.",
    appliesTo: "The guidance version currently selected in Conversation Flow",
    provenance: "Repository convention: concise, response-ordered Coach Chewy guidance",
    values: {
      mode: "replace",
      sections: [
        {
          title: "1. Understand the request",
          body: "Clarify the Conversation Partner's stated need before moving through the conversation flow.",
          bullets: ["Use the conversation facts and current partner response only."]
        },
        {
          title: "2. Follow the conversation flow",
          body: "Follow the authored phases without adding policy, promises, or outcomes.",
          bullets: ["Keep the response focused on the next approved action."]
        },
        {
          title: "3. Confirm next steps",
          body: "Recap the approved action and confirm what the Conversation Partner should expect next.",
          bullets: ["Check for understanding before closing."]
        }
      ]
    }
  }
].map((component) => ({
  ...component,
  owner: COMPONENT_LIBRARY_OWNER,
  ownership: "system",
  readOnly: true
}));

export const REUSABLE_COMPONENTS = freezeDeep(COMPONENTS);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function componentById(componentId) {
  return REUSABLE_COMPONENTS.find((component) => component.id === componentId) || null;
}

function uniqueObjectiveId(objectives, requestedId) {
  const used = new Set(objectives.map((objective) => String(objective?.id || "")));
  if (!used.has(requestedId)) return requestedId;
  let suffix = 2;
  while (used.has(`${requestedId}_${suffix}`)) suffix += 1;
  return `${requestedId}_${suffix}`;
}

function guidanceFromHandling(draft) {
  return (draft?.handling?.correct || []).map((step, index) => ({
    title: `${index + 1}. Conversation phase`,
    body: String(step || "").trim(),
    bullets: [String(step || "").trim()]
  })).filter((section) => section.body);
}

function setGuidanceSections(draft, sections, scope) {
  draft.guidance ||= {};
  if (scope === "chat" || scope === "voice") {
    draft.guidance.channelSections ||= {};
    draft.guidance.channelSections[scope] = sections;
    return;
  }
  draft.guidance.sections = sections;
}

export function reusableComponentsForKind(kind) {
  return REUSABLE_COMPONENTS.filter((component) => component.kind === kind);
}

export function applyReusableComponent(inputDraft, componentId, options = {}) {
  const component = componentById(componentId);
  if (!component || component.ownership !== "system" || component.readOnly !== true) {
    throw new Error("Choose a system-provided reusable component.");
  }
  const draft = clone(inputDraft || {});

  if (component.kind === "persona") {
    draft.scenario ||= {};
    draft.partner ||= {};
    draft.tuning ||= {};
    draft.tuning.customer ||= {};
    draft.scenario.customerEmotion = component.values.customerEmotion;
    draft.partner.mood = component.values.customerEmotion;
    draft.tuning.customer = {
      ...draft.tuning.customer,
      ...clone(component.values.tuning)
    };
  }

  if (component.kind === "objective") {
    draft.evaluation ||= {};
    draft.evaluation.objectives ||= [];
    const objective = clone(component.values.objective);
    objective.id = uniqueObjectiveId(draft.evaluation.objectives, objective.id);
    draft.evaluation.objectives.push(objective);
  }

  if (component.kind === "guidance") {
    const sections = component.values.mode === "from_handling"
      ? guidanceFromHandling(draft)
      : clone(component.values.sections || []);
    setGuidanceSections(draft, sections, options.guidanceScope || "shared");
  }

  return draft;
}

export function previewReusableComponent(inputDraft, componentId, options = {}) {
  const component = componentById(componentId);
  if (!component) return null;
  const draft = inputDraft || {};
  const scope = options.guidanceScope || "shared";
  const values = component.kind === "guidance" && component.values.mode === "from_handling"
    ? { ...component.values, sections: guidanceFromHandling(draft) }
    : component.values;
  return {
    ...component,
    values: clone(values),
    appliesTo: component.kind === "guidance"
      ? `${scope === "shared" ? "Shared" : scope === "chat" ? "Chat-specific" : "Voice-specific"} Coach Chewy guidance only`
      : component.appliesTo
  };
}
