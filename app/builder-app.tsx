"use client";

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import {
  createDefaultVoiceExperience,
  defaultConditionalFollowUp,
  importScenarioJson,
  SUPPORTED_VOICES,
  type Channel,
  type ImportMode,
  type ScenarioFile,
  type StudioDraft,
  type ValidationIssue,
  type VoiceExperienceDraft,
} from "@/lib/scenario-contract";
import { parseEditableLines } from "@/lib/editable-lines";
import { objectiveFingerprint } from "@/lib/objective-approval";
import { readScenarioUploads } from "@/lib/scenario-upload";

type Step = 1 | 2 | 3;
type StartMode = "new" | ImportMode;

interface ApiError {
  code: string;
  message: string;
  details?: Array<{ code: string; path: string }>;
}

const modes: Array<{ id: StartMode; title: string; description: string; icon: string }> = [
  { id: "new", title: "Start new", description: "Describe a practice conversation and let Coach Chewy build the first draft.", icon: "+" },
  { id: "improve", title: "Improve existing JSON", description: "Upload a learning-objective scenario and keep its identity while you revise it.", icon: "↥" },
  { id: "similar", title: "Create similar from JSON", description: "Use an existing scenario as inspiration and create a separate learning-objective copy.", icon: "⧉" },
];

export default function BuilderApp() {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<StartMode>("new");
  const [situation, setSituation] = useState("");
  const [learnerGoal, setLearnerGoal] = useState("");
  const [correctProcess, setCorrectProcess] = useState("");
  const [agentType, setAgentType] = useState<"Core" | "Rx">("Core");
  const [channels, setChannels] = useState<Channel[]>(["chat", "voice"]);
  const [deidentified, setDeidentified] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<StudioDraft | null>(null);
  const [importedName, setImportedName] = useState("");
  const [requiresObjectiveApproval, setRequiresObjectiveApproval] = useState(false);
  const [objectiveApproved, setObjectiveApproved] = useState(false);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [files, setFiles] = useState<ScenarioFile[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [buildDirty, setBuildDirty] = useState(false);

  useEffect(() => {
    const hasUnsavedWork = Boolean(draft || sourceDraft || situation.trim() || learnerGoal.trim() || correctProcess.trim());
    if (!hasUnsavedWork) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [correctProcess, draft, learnerGoal, situation, sourceDraft]);

  useEffect(() => {
    const headingId = step === 1 ? "build-heading" : step === 2 ? "review-heading" : "test-heading";
    document.getElementById(headingId)?.focus();
  }, [step]);

  useEffect(() => {
    if (error) document.getElementById("builder-error")?.focus();
  }, [error]);

  function markBuildChanged(resetConfirmation = true) {
    if (draft) setBuildDirty(true);
    setFiles([]);
    setIssues([]);
    setError(null);
    setObjectiveApproved(false);
    if (resetConfirmation) setDeidentified(false);
  }

  function selectMode(nextMode: StartMode) {
    if (busy || nextMode === mode) return;
    markBuildChanged();
    setMode(nextMode);
    setSourceDraft(null);
    setImportedName("");
    setSituation("");
    setLearnerGoal("");
    setCorrectProcess("");
    setAgentType("Core");
    setChannels(["chat", "voice"]);
    setDeidentified(false);
    setRequiresObjectiveApproval(false);
    setObjectiveApproved(false);
    setAnnouncement(nextMode === "new" ? "Start new selected." : `${modes.find((entry) => entry.id === nextMode)?.title} selected. Upload JSON to continue.`);
  }

  function toggleChannel(channel: Channel) {
    if (busy) return;
    markBuildChanged();
    setChannels((current) => current.includes(channel)
      ? current.filter((entry) => entry !== channel)
      : orderedChannels([...current, channel]));
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = Array.from(event.target.files || []);
    markBuildChanged();
    if (selected.length < 1 || selected.length > 2) {
      setError({ code: "upload_count", message: "Upload one scenario or one chat/voice sibling pair." });
      input.value = "";
      return;
    }
    const importMode = mode === "improve" ? "improve" : "similar";
    setBusy(true);
    setAnnouncement("Loading and checking the selected JSON file.");
    try {
      const parsed = await readScenarioUploads(selected);
      const source = JSON.stringify(parsed.length === 1 ? parsed[0] : parsed);
      const imported = importScenarioJson(source, importMode);
      setSourceDraft(imported.draft);
      setImportedName(selected.map((file) => file.name).join(" + "));
      setChannels(imported.draft.channels);
      setAgentType(imported.draft.agentType);
      setLearnerGoal(imported.draft.learnerGoal);
      setCorrectProcess(imported.draft.correctProcess.join("\n"));
      setSituation("");
      setRequiresObjectiveApproval(imported.requiresObjectiveApproval);
      setObjectiveApproved(false);
      setAnnouncement(`${selected.length} JSON file${selected.length === 1 ? "" : "s"} loaded. Describe the change you want.`);
    } catch (caught) {
      setSourceDraft(null);
      setImportedName("");
      setError({ code: "upload_invalid", message: caught instanceof Error ? caught.message : "The JSON could not be imported." });
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  async function generateDraft() {
    setError(null);
    setIssues([]);
    if (mode !== "new" && !sourceDraft) {
      setError({ code: "upload_required", message: "Upload the JSON you want to use before creating a draft." });
      return;
    }
    if (!situation.trim()) {
      setError({ code: "situation_required", message: mode === "new" ? "Describe the conversation before creating a draft." : "Describe what you want to change." });
      return;
    }
    if (channels.length === 0) {
      setError({ code: "channel_required", message: "Choose Chat, Voice, or both." });
      return;
    }
    if (!deidentified) {
      setError({ code: "confirmation_required", message: "Confirm that the content is fictional or de-identified." });
      return;
    }

    setBusy(true);
    setAnnouncement("Coach Chewy is creating the draft.");
    try {
      const response = await fetch("/api/builder/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, deidentificationConfirmed: deidentified, channels, situation, learnerGoal, correctProcess, agentType, sourceDraft }),
      });
      const payload = await response.json() as { draft?: StudioDraft; assumptions?: string[]; error?: ApiError };
      if (!response.ok || !payload.draft) throw payload.error || new Error("Draft generation failed.");
      setDraft(payload.draft);
      setAssumptions(payload.assumptions || []);
      setFiles([]);
      setBuildDirty(false);
      setObjectiveApproved(false);
      setStep(2);
      setAnnouncement("Draft created. Review and edit every detail before testing.");
    } catch (caught) {
      const apiError = isApiError(caught)
        ? caught
        : { code: "generation_unavailable", message: caught instanceof Error ? caught.message : "Coach Chewy could not create a draft." };
      setError(apiError);
      setAnnouncement("Draft creation stopped. Review the error and try again.");
    } finally {
      setBusy(false);
    }
  }

  function editDraft(mutator: (next: StudioDraft) => void) {
    if (busy) return;
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
    setFiles([]);
    setIssues([]);
    setError(null);
    setObjectiveApproved(false);
  }

  async function validateDraft() {
    if (!draft) return;
    setError(null);
    setIssues([]);
    if (!objectiveApproved) {
      setIssues([{ code: "objective_approval_required", path: "draft.objectives", message: "Approve the current learning objectives before downloading.", fix: "Review every objective and select the approval checkbox." }]);
      return;
    }

    setBusy(true);
    setAnnouncement("Checking the JSON files.");
    try {
      const response = await fetch("/api/builder/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft,
          deidentificationConfirmed: deidentified,
          objectiveApproval: {
            required: true,
            approved: objectiveApproved,
            fingerprint: objectiveApproved ? objectiveFingerprint(draft.objectives) : "",
          },
        }),
      });
      const payload = await response.json() as { ok?: boolean; files?: ScenarioFile[]; issues?: ValidationIssue[]; error?: ApiError };
      if (!response.ok || !payload.ok || !payload.files) {
        setIssues(payload.issues || []);
        if (payload.error) setError(payload.error);
        setAnnouncement("Validation found changes to make.");
        return;
      }
      setFiles(payload.files);
      setStep(3);
      setAnnouncement("Validation passed. The JSON files are ready to download and test in Rise.");
    } catch {
      setError({ code: "validation_unavailable", message: "The files could not be checked. Try again." });
    } finally {
      setBusy(false);
    }
  }

  function goTo(next: Step) {
    if (busy || (next === 2 && (!draft || buildDirty)) || (next === 3 && files.length === 0)) return;
    setStep(next);
  }

  return (
    <main>
      <header className="brand-bar">
        <div className="brand-lockup" aria-label="Chewy Conversation Builder"><span className="chewy-wordmark">chewy</span><span className="brand-product">Conversation Builder</span></div>
        <span className="workspace-badge">Chewy workspace</span>
      </header>

      <section className="page-intro"><div><p className="eyebrow">Conversation practice for Articulate Rise</p><h1>Conversation Builder</h1><p>Create, review, and download ready-to-test conversation JSON files.</p></div></section>

      <nav className="step-nav" aria-label="Builder progress">
        {([1, 2, 3] as Step[]).map((number) => {
          const labels = { 1: "Build", 2: "Review/Edit", 3: "Test in Rise" } as const;
          const disabled = busy || (number === 2 && (!draft || buildDirty)) || (number === 3 && files.length === 0);
          return <button className={`step-card${step === number ? " active" : ""}`} type="button" key={number} onClick={() => goTo(number)} disabled={disabled} aria-current={step === number ? "step" : undefined}><span>Step {number}</span><strong>{labels[number]}</strong></button>;
        })}
      </nav>

      {step === 1 && <BuildStep mode={mode} situation={situation} learnerGoal={learnerGoal} correctProcess={correctProcess} agentType={agentType} channels={channels} deidentified={deidentified} importedName={importedName} sourceDraft={sourceDraft} busy={busy} buildDirty={buildDirty} error={error} onMode={selectMode} onImport={handleImport} onSituation={(value) => { markBuildChanged(); setSituation(value); }} onLearnerGoal={(value) => { markBuildChanged(); setLearnerGoal(value); }} onCorrectProcess={(value) => { markBuildChanged(); setCorrectProcess(value); }} onAgentType={(value) => { markBuildChanged(); setAgentType(value); }} onChannel={toggleChannel} onDeidentified={(value) => { markBuildChanged(false); setDeidentified(value); }} onGenerate={generateDraft} />}

      {step === 2 && draft && <ReviewStep draft={draft} assumptions={assumptions} requiresObjectiveApproval={requiresObjectiveApproval} objectiveApproved={objectiveApproved} issues={issues} error={error} busy={busy} onEdit={editDraft} onApproval={setObjectiveApproved} onBack={() => { if (!busy) setStep(1); }} onValidate={validateDraft} />}

      {step === 3 && draft && files.length > 0 && <TestStep files={files} onBack={() => setStep(2)} />}

      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </main>
  );
}

interface BuildStepProps {
  mode: StartMode;
  situation: string;
  learnerGoal: string;
  correctProcess: string;
  agentType: "Core" | "Rx";
  channels: Channel[];
  deidentified: boolean;
  importedName: string;
  sourceDraft: StudioDraft | null;
  busy: boolean;
  buildDirty: boolean;
  error: ApiError | null;
  onMode: (mode: StartMode) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onSituation: (value: string) => void;
  onLearnerGoal: (value: string) => void;
  onCorrectProcess: (value: string) => void;
  onAgentType: (value: "Core" | "Rx") => void;
  onChannel: (channel: Channel) => void;
  onDeidentified: (value: boolean) => void;
  onGenerate: () => void;
}

function BuildStep(props: BuildStepProps) {
  const imported = props.mode !== "new";
  const uploadError = Boolean(props.error && props.error.code.startsWith("upload"));
  return (
    <section className="workspace-card" aria-labelledby="build-heading" aria-busy={props.busy} inert={props.busy ? true : undefined}>
      <div className="section-heading"><p className="step-label">Step 1 of 3</p><h2 id="build-heading" tabIndex={-1}>Build</h2><p>Choose a starting point, then give Coach Chewy the facts it needs.</p></div>

      {props.error && <ErrorBanner error={props.error} />}
      {props.buildDirty && <aside className="notice-panel"><strong>Build details changed</strong><p>Create a new draft before returning to Review/Edit.</p></aside>}

      <div className="mode-grid" role="group" aria-label="Starting point">
        {modes.map((entry) => <button className={`mode-card${props.mode === entry.id ? " selected" : ""}`} type="button" key={entry.id} onClick={() => props.onMode(entry.id)} aria-pressed={props.mode === entry.id} disabled={props.busy}><span className="mode-icon" aria-hidden="true">{entry.icon}</span><span><strong>{entry.title}</strong><small>{entry.description}</small></span></button>)}
      </div>

      {imported && <div className="upload-panel"><label className="file-input-label" htmlFor="scenario-upload">Scenario JSON file(s)</label><input id="scenario-upload" className="file-input" type="file" accept="application/json,.json" multiple onChange={props.onImport} aria-invalid={uploadError} aria-describedby={uploadError ? "builder-error" : undefined} disabled={props.busy} /><p>{props.importedName ? <><strong>Loaded:</strong> {props.importedName}</> : "Upload one scenario or a matching chat/voice pair."}</p>{props.sourceDraft && <span className="success-chip">Ready to {props.mode === "improve" ? "improve" : "reimagine"}</span>}</div>}

      <div className="coach-prompt">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/coach-chewy.png" alt="" width="64" height="64" />
        <div><strong>Coach Chewy</strong><p>{imported ? "Coach Chewy can revise the scenario setup, Conversation Partner behavior, process, phases, and objectives. Edit exact guide wording, compatibility facts, Standard Text, and voice settings manually in Review/Edit." : "Tell me about the Conversation Partner, the situation, and the correct outcome."}</p></div>
      </div>

      <div className="form-grid two-column">
        <label className="field full-width" htmlFor="conversation-about"><span>{imported ? "What should change in the scenario setup, behavior, process, phases, or objectives?" : "What is this conversation about?"} <em>Required</em></span><textarea id="conversation-about" rows={5} value={props.situation} onChange={(event) => props.onSituation(event.target.value)} placeholder={imported ? "Example: Make the customer more concerned and focus the objectives on setting accurate expectations..." : "Example: A customer calls because a delayed order may leave their pet without food..."} /></label>
        <label className="field" htmlFor="learner-goal"><span>Learning objective</span><textarea id="learner-goal" rows={3} value={props.learnerGoal} onChange={(event) => props.onLearnerGoal(event.target.value)} placeholder="What should the learner demonstrate?" /></label>
        <label className="field" htmlFor="correct-process"><span>Correct process</span><textarea id="correct-process" rows={3} value={props.correctProcess} onChange={(event) => props.onCorrectProcess(event.target.value)} placeholder="List approved steps, facts, or boundaries." /></label>
        <label className="field" htmlFor="agent-type"><span>Agent type</span><select id="agent-type" value={props.agentType} onChange={(event) => props.onAgentType(event.target.value === "Rx" ? "Rx" : "Core")}><option value="Core">Core</option><option value="Rx">Rx</option></select></label>
        <fieldset className="channel-choice"><legend>Practice format</legend><label><input type="checkbox" checked={props.channels.includes("chat")} onChange={() => props.onChannel("chat")} /> Chat</label><label><input type="checkbox" checked={props.channels.includes("voice")} onChange={() => props.onChannel("voice")} /> Voice</label></fieldset>
      </div>

      <label className="confirmation-check"><input type="checkbox" checked={props.deidentified} onChange={(event) => props.onDeidentified(event.target.checked)} /><span>I confirm this content is fictional or de-identified and contains no real customer contact, address, payment, or health information.</span></label>

      <div className="page-actions"><button className="primary-button" type="button" onClick={props.onGenerate} disabled={props.busy}>{props.busy ? "Creating draft…" : "Create draft with Coach Chewy"}</button></div>
    </section>
  );
}

interface ReviewStepProps {
  draft: StudioDraft;
  assumptions: string[];
  requiresObjectiveApproval: boolean;
  objectiveApproved: boolean;
  issues: ValidationIssue[];
  error: ApiError | null;
  busy: boolean;
  onEdit: (mutator: (draft: StudioDraft) => void) => void;
  onApproval: (approved: boolean) => void;
  onBack: () => void;
  onValidate: () => void;
}

function ReviewStep(props: ReviewStepProps) {
  const { draft, onEdit } = props;
  const voiceExperience = draft.voice.experience ?? createDefaultVoiceExperience(draft.customer.tone);
  return (
    <section className="workspace-card" aria-labelledby="review-heading" aria-busy={props.busy} inert={props.busy ? true : undefined}>
      <div className="section-heading split-heading"><div><p className="step-label">Step 2 of 3</p><h2 id="review-heading" tabIndex={-1}>Review/Edit</h2><p>AI created the draft. You own the final facts, guidance, and learning objectives.</p></div><span className="draft-badge">Draft · not published</span></div>

      {props.error && <ErrorBanner error={props.error} />}
      {props.assumptions.length > 0 && <aside className="notice-panel" aria-label="Coach Chewy assumptions"><strong>Check these assumptions</strong><ul>{props.assumptions.map((assumption, index) => <li key={`${index}-${assumption}`}>{assumption}</li>)}</ul></aside>}

      <ReviewSection title="Scenario setup" description="Name the files and describe the learner’s job.">
        <div className="form-grid two-column">
          <TextField label="Scenario title" value={draft.title} onChange={(value) => onEdit((next) => { next.title = value; })} />
          <TextField label="File base ID" value={draft.baseId} onChange={(value) => onEdit((next) => { next.baseId = value; })} hint="Lowercase letters, numbers, and underscores work best." />
          <TextArea label="Description" value={draft.description} onChange={(value) => onEdit((next) => { next.description = value; })} />
          <TextArea label="Learner goal" value={draft.learnerGoal} onChange={(value) => onEdit((next) => { next.learnerGoal = value; })} />
          <TextField label="Topic" value={draft.topic} onChange={(value) => onEdit((next) => { next.topic = value; })} />
          <TextField label="Subtopic" value={draft.subtopic} onChange={(value) => onEdit((next) => { next.subtopic = value; })} />
          <TextField label="Team audience" value={draft.teamAudience} onChange={(value) => onEdit((next) => { next.teamAudience = value; })} />
          <SelectField label="Agent type" value={draft.agentType} options={[{ value: "Core", label: "Core" }, { value: "Rx", label: "Rx" }]} onChange={(value) => onEdit((next) => { next.agentType = value === "Rx" ? "Rx" : "Core"; })} />
        </div>
      </ReviewSection>

      <ReviewSection title="Conversation Partner" description="Confirm what the customer knows, says, and reveals.">
        <div className="form-grid two-column">
          <TextField label="Customer name" value={draft.customer.name} onChange={(value) => onEdit((next) => { next.customer.name = value; })} />
          <TextField label="Pet name" value={draft.customer.petName} onChange={(value) => onEdit((next) => { next.customer.petName = value; })} />
          <TextField label="Tone" value={draft.customer.tone} onChange={(value) => onEdit((next) => { next.customer.tone = value; })} />
          <TextArea label="Customer goal" value={draft.customer.goal} onChange={(value) => onEdit((next) => { next.customer.goal = value; })} />
          <TextArea label="Opening line" value={draft.customer.openingLine} onChange={(value) => onEdit((next) => { next.customer.openingLine = value; })} />
          <TextArea label="Closing line" value={draft.customer.closingLine} onChange={(value) => onEdit((next) => { next.customer.closingLine = value; })} />
          <LinesField label="Known facts" values={draft.customer.facts} onChange={(values) => onEdit((next) => { next.customer.facts = values; })} />
          <LinesField label="Reveal only when asked" values={draft.customer.revealOnlyWhenAsked} onChange={(values) => onEdit((next) => { next.customer.revealOnlyWhenAsked = values; })} />
          <LinesField label="Allowed objections" values={draft.customer.objections} onChange={(values) => onEdit((next) => { next.customer.objections = values; })} />
          <LinesField label="Behavior rules" values={draft.customer.behaviorRules} onChange={(values) => onEdit((next) => { next.customer.behaviorRules = values; })} />
          <LinesField label="Conditional follow-ups" values={draft.customer.conditionalFollowUps} onChange={(values) => onEdit((next) => { next.customer.conditionalFollowUps = values; })} />
        </div>
      </ReviewSection>

      <ReviewSection title="Approved process" description="Use one approved action or boundary per line.">
        <div className="form-grid two-column">
          <LinesField label="Correct process" values={draft.correctProcess} onChange={(values) => onEdit((next) => { next.correctProcess = values; })} />
          <LinesField label="Prohibited actions" values={draft.prohibitedActions} onChange={(values) => onEdit((next) => { next.prohibitedActions = values; })} />
        </div>
      </ReviewSection>

      <ReviewSection title="Simulator facts" description="Review every fact written to the simulator’s compatibility fields. Imported values stay here until you change or clear them.">
        <div className="form-grid two-column">
          <TextArea label="Key question" value={draft.compatibilityFacts.keyQuestion ?? draft.customer.goal} onChange={(value) => onEdit((next) => { next.compatibilityFacts.keyQuestion = value; })} />
          <TextArea label="Root-cause belief" value={draft.compatibilityFacts.rootCauseBelief ?? draft.customer.goal} onChange={(value) => onEdit((next) => { next.compatibilityFacts.rootCauseBelief = value; })} />
          <TextField label="Address" value={draft.compatibilityFacts.address} onChange={(value) => onEdit((next) => { next.compatibilityFacts.address = value; })} hint="Use only fictional or de-identified training details." />
          <TextField label="Medication" value={draft.compatibilityFacts.medication} onChange={(value) => onEdit((next) => { next.compatibilityFacts.medication = value; })} />
          <TextField label="Medication or product" value={draft.compatibilityFacts.medicationOrProduct} onChange={(value) => onEdit((next) => { next.compatibilityFacts.medicationOrProduct = value; })} />
          <TextField label="Clinic" value={draft.compatibilityFacts.clinic} onChange={(value) => onEdit((next) => { next.compatibilityFacts.clinic = value; })} />
          <TextArea label="Urgency" value={draft.compatibilityFacts.urgency} onChange={(value) => onEdit((next) => { next.compatibilityFacts.urgency = value; })} />
          <TextArea label="Conditional follow-up" value={draft.compatibilityFacts.conditionalFollowUp ?? defaultConditionalFollowUp(draft.customer)} onChange={(value) => onEdit((next) => { next.compatibilityFacts.conditionalFollowUp = value; })} />
        </div>
      </ReviewSection>

      <ReviewSection title="Conversation flow and Coach Chewy guidance" description="Put answer-critical guidance in the same order the learner should respond.">
        <div className="stack-list">
          {draft.phases.map((phase, index) => <article className="editor-card" key={index}>
            <div className="editor-card-heading"><strong>Phase {index + 1}</strong>{draft.phases.length > 1 && <button className="text-button danger" type="button" aria-label={`Remove phase ${index + 1}`} onClick={() => onEdit((next) => { next.phases.splice(index, 1); })}>Remove</button>}</div>
            <div className="form-grid two-column">
              <TextField label="Phase title" value={phase.title} onChange={(value) => onEdit((next) => { next.phases[index].title = value; })} />
              <TextField label="Phase ID" value={phase.id} onChange={(value) => onEdit((next) => { next.phases[index].id = value; })} hint="Use a unique lower_snake_case ID." />
              <CheckboxField label="Conversation Partner remains silent after this learner action" checked={phase.customerRemainsSilent === true} onChange={(value) => onEdit((next) => { next.phases[index].customerRemainsSilent = value; if (value) next.phases[index].partnerResponse = ""; })} />
              {!phase.customerRemainsSilent && <TextArea label="Conversation Partner response" value={phase.partnerResponse} onChange={(value) => onEdit((next) => { next.phases[index].partnerResponse = value; })} />}
              <LinesField label="Learner actions" values={phase.learnerActions} onChange={(values) => onEdit((next) => { next.phases[index].learnerActions = values; })} />
              <TextArea label="Manager-only ideal-response guidance" value={phase.managerGuidance ?? phase.coachGuidance.join(" ")} onChange={(value) => onEdit((next) => { next.phases[index].managerGuidance = value; })} />
              <TextField label="Coach Chewy guide title" value={phase.guideTitle ?? `${index + 1}. ${phase.title}`} onChange={(value) => onEdit((next) => { next.phases[index].guideTitle = value; })} />
              <TextField label="Guidance source label" value={phase.guideSourceLabel ?? `Creator-approved guidance ${index + 1}`} onChange={(value) => onEdit((next) => { next.phases[index].guideSourceLabel = value; })} />
              <TextArea label="Coach Chewy guide body" value={phase.guideBody ?? phase.learnerActions.join(" ")} onChange={(value) => onEdit((next) => { next.phases[index].guideBody = value; })} />
              <LinesField label="Coach Chewy guidance" values={phase.coachGuidance} onChange={(values) => onEdit((next) => { next.phases[index].coachGuidance = values; })} />
            </div>
          </article>)}
          <button className="secondary-button add-button" type="button" onClick={() => onEdit((next) => { next.phases.push(emptyPhase(next.phases.length)); })}>+ Add phase</button>
        </div>
      </ReviewSection>

      <ReviewSection title="Learning objectives" description="The simulator will evaluate only these objectives and observable criteria.">
        <div className="stack-list">
          {draft.objectives.map((objective, index) => <article className="editor-card" key={index}>
            <div className="editor-card-heading"><strong>Objective {index + 1}</strong>{draft.objectives.length > 1 && <button className="text-button danger" type="button" aria-label={`Remove objective ${index + 1}`} onClick={() => onEdit((next) => { next.objectives.splice(index, 1); })}>Remove</button>}</div>
            <div className="form-grid two-column">
              <TextField label="Objective label" value={objective.label} onChange={(value) => onEdit((next) => { next.objectives[index].label = value; })} />
              <TextField label="Objective ID" value={objective.id} onChange={(value) => onEdit((next) => { next.objectives[index].id = value; })} hint="Use a unique lower_snake_case ID." />
              <TextArea label="Description" value={objective.description} onChange={(value) => onEdit((next) => { next.objectives[index].description = value; })} />
              <LinesField label="Observable criteria" values={objective.criteria} onChange={(values) => onEdit((next) => { next.objectives[index].criteria = values; })} fullWidth />
            </div>
          </article>)}
          <button className="secondary-button add-button" type="button" onClick={() => onEdit((next) => { next.objectives.push(emptyObjective(next.objectives.length)); })}>+ Add objective</button>
        </div>
      </ReviewSection>

      {draft.channels.includes("chat") && <ReviewSection title="Chat settings" description="Make an explicit Standard Text decision before downloading chat JSON.">
        <div className="form-grid two-column">
          <SelectField label="Hotkey profile" value={draft.chat.hotkeyProfile} options={[{ value: "core", label: "Core" }, { value: "rx", label: "Rx" }]} onChange={(value) => onEdit((next) => { next.chat.hotkeyProfile = value === "rx" ? "rx" : "core"; })} />
          <SelectField label="Standard Text" value={draft.chat.standardTextDecision} options={[{ value: "unreviewed", label: "Choose an option" }, { value: "none", label: "No Standard Text" }, { value: "approved", label: "Use approved Standard Text" }]} onChange={(value) => onEdit((next) => {
            next.chat.standardTextDecision = value === "approved" ? "approved" : value === "none" ? "none" : "unreviewed";
          })} />
        </div>
        {(draft.chat.standardTextRecommendations?.length ?? 0) > 0 && <div className="stack-list nested-editor-list" aria-label="Approved Standard Text recommendations">
          {draft.chat.standardTextRecommendations!.map((recommendation) => {
            const added = draft.chat.standardText.some((item) => item.hotkey.toLowerCase() === recommendation.hotkey.toLowerCase());
            return <article className="editor-card" key={`recommendation-${recommendation.hotkey}`}><div className="editor-card-heading"><strong>{recommendation.hotkey.toUpperCase()} · {recommendation.category}</strong><button className="secondary-button" type="button" disabled={added} onClick={() => onEdit((next) => { next.chat.standardTextDecision = "approved"; next.chat.standardText.push(structuredClone(recommendation)); })}>{added ? "Added" : "Use recommendation"}</button></div><p>{recommendation.template}</p><p><strong>Why it fits:</strong> {recommendation.recommendationReason}</p><p><strong>Suggested moment:</strong> {recommendation.insertionMoment}</p><p><strong>Customize:</strong> {recommendation.customization}</p></article>;
          })}
        </div>}
        {draft.chat.standardTextDecision === "approved" && <div className="stack-list nested-editor-list">
          {draft.chat.standardText.map((item, index) => <article className="editor-card" key={index}>
            <div className="editor-card-heading"><strong>Standard Text {index + 1}</strong><button className="text-button danger" type="button" aria-label={`Remove Standard Text ${index + 1}`} onClick={() => onEdit((next) => { next.chat.standardText.splice(index, 1); })}>Remove</button></div>
            <div className="form-grid two-column">
              <TextField label="Hotkey" value={item.hotkey} onChange={(value) => onEdit((next) => { next.chat.standardText[index].hotkey = value; next.chat.standardText[index].approvedGuidance = ""; })} />
              <TextField label="Category" value={item.category} onChange={(value) => onEdit((next) => { next.chat.standardText[index].category = value; next.chat.standardText[index].approvedGuidance = ""; })} />
              <TextArea label="Exact approved response" value={item.template} onChange={(value) => onEdit((next) => { next.chat.standardText[index].template = value; next.chat.standardText[index].approvedGuidance = ""; })} />
              <TextArea label="When to prompt the learner" value={item.insertionMoment} onChange={(value) => onEdit((next) => { next.chat.standardText[index].insertionMoment = value; next.chat.standardText[index].approvedGuidance = ""; })} />
              <TextArea label="What to customize before sending" value={item.customization} onChange={(value) => onEdit((next) => { next.chat.standardText[index].customization = value; next.chat.standardText[index].approvedGuidance = ""; })} />
              <LinesField label="Notes" values={item.notes} onChange={(values) => onEdit((next) => { next.chat.standardText[index].notes = values; })} fullWidth />
            </div>
          </article>)}
          <button className="secondary-button add-button" type="button" onClick={() => onEdit((next) => { next.chat.standardText.push(emptyStandardText()); })}>+ Add Standard Text</button>
        </div>}
      </ReviewSection>}

      {draft.channels.includes("voice") && <ReviewSection title="Voice settings" description="Confirm the voice, pacing, guidance, and ending behavior used by the Rise voice simulator.">
        <div className="form-grid two-column">
          <SelectField label="Selected voice" value={draft.voice.selectedVoice} options={SUPPORTED_VOICES.map((voice) => ({ value: voice, label: voice[0].toUpperCase() + voice.slice(1) }))} onChange={(value) => onEdit((next) => { next.voice.selectedVoice = value; })} />
          <NumberField label="Voice speed" value={draft.voice.speed} min={0.75} max={1.25} step={0.05} onChange={(value) => onEdit((next) => { next.voice.speed = value; })} />
          <CheckboxField label="Conversation Partner starts the voice conversation" checked={voiceExperience.customerStarts} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.customerStarts = value; }))} />
          <TextField label="Spoken tone" value={voiceExperience.spokenTone} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.spokenTone = value; }))} />
          <TextField label="Guide title" value={voiceExperience.guideTitle} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.guideTitle = value; }))} />
          <TextArea label="Guide top note" value={voiceExperience.guideTopNote} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.guideTopNote = value; }))} />
          <TextArea label="Pacing guidance" value={voiceExperience.pacing} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.pacing = value; }))} />
          <TextArea label="Verbal guidance" value={voiceExperience.verbalGuidance} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.verbalGuidance = value; }))} />
          <TextArea label="End note" value={voiceExperience.endNote} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.endNote = value; }))} />
          <SelectField label="Completion controls" value={voiceExperience.completion ? "included" : "none"} options={[{ value: "none", label: "No completion controls" }, { value: "included", label: "Use completion controls" }]} onChange={(value) => onEdit((next) => editVoiceExperience(next, (experience) => { experience.completion = value === "included" ? experience.completion ?? defaultVoiceCompletion() : undefined; }))} />
        </div>
        {voiceExperience.completion && <div className="form-grid two-column nested-editor-list">
          <CheckboxField label="Completion detection enabled" checked={voiceExperience.completion.enabled} onChange={(value) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.enabled = value; }))} />
          <CheckboxField label="End automatically after a matching phrase" checked={voiceExperience.completion.autoEnd} onChange={(value) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.autoEnd = value; }))} />
          <LinesField label="Terminal customer phrases" values={voiceExperience.completion.terminalCustomerPhrases ?? []} onChange={(values) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.terminalCustomerPhrases = values; }))} />
          <LinesField label="Terminal learner phrases" values={voiceExperience.completion.terminalAgentPhrases ?? []} onChange={(values) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.terminalAgentPhrases = values; }))} />
          <NumberField label="End delay (milliseconds)" value={voiceExperience.completion.endDelayMs} min={0} max={5000} step={50} onChange={(value) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.endDelayMs = value; }))} />
          <TextArea label="Completion status" value={voiceExperience.completion.endStatus} onChange={(value) => onEdit((next) => editVoiceCompletion(next, (completion) => { completion.endStatus = value; }))} />
        </div>}
      </ReviewSection>}

      <label className="confirmation-check approval-check"><input type="checkbox" checked={props.objectiveApproved} onChange={(event) => props.onApproval(event.target.checked)} /><span>{props.requiresObjectiveApproval ? "I reviewed and approve these new learning objectives. The uploaded full-conversation evaluation remains unchanged." : "I reviewed and approve these learning objectives and observable criteria."}</span></label>

      {props.issues.length > 0 && <IssueList issues={props.issues} />}

      <div className="page-actions spread-actions"><button className="secondary-button" type="button" onClick={props.onBack}>Back to Build</button><button className="primary-button" type="button" onClick={props.onValidate} disabled={props.busy}>{props.busy ? "Checking files…" : "Validate files"}</button></div>
    </section>
  );
}

function TestStep({ files, onBack }: { files: ScenarioFile[]; onBack: () => void }) {
  return (
    <section className="workspace-card" aria-labelledby="test-heading">
      <div className="section-heading"><p className="step-label">Step 3 of 3</p><h2 id="test-heading" tabIndex={-1}>Test in Rise</h2><p>Your files passed the standalone Builder checks. Download each one and test it in the matching Rise simulator.</p></div>

      <div className="success-panel" role="status"><span aria-hidden="true">✓</span><div><strong>JSON ready</strong><p>This Site does not publish or save your scenario. Keep the downloaded files as your copy.</p></div></div>

      <div className="download-grid">
        {files.map((file) => {
          const channel = file.scenario.channels[0];
          return <article className="download-card" key={file.filename}><span className="channel-badge">{channel === "chat" ? "Chat" : "Voice"}</span><h3>{file.scenario.title}</h3><code>{file.filename}</code><button className="primary-button" type="button" onClick={() => downloadFile(file)}>Download {channel} JSON</button></article>;
        })}
      </div>

      <ol className="rise-steps"><li><strong>Download</strong> every JSON file shown above.</li><li><strong>Open</strong> your Articulate Rise course and its conversation simulator.</li><li><strong>Load</strong> each downloaded JSON into its matching {files.length === 1 ? files[0].scenario.channels[0] : "chat or voice"} simulator.</li><li><strong>Test</strong> the full conversation. Return here to edit if anything feels wrong.</li></ol>

      <div className="page-actions spread-actions"><button className="secondary-button" type="button" onClick={onBack}>Back to Review/Edit</button></div>
    </section>
  );
}

function ReviewSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="review-section"><div className="review-section-heading"><h3>{title}</h3><p>{description}</p></div>{children}</section>;
}

function TextField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /></label>;
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="inline-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function LinesField({ label, values, onChange, fullWidth = false }: { label: string; values: string[]; onChange: (values: string[]) => void; fullWidth?: boolean }) {
  return <label className={`field${fullWidth ? " full-width" : ""}`}><span>{label}</span><textarea rows={4} value={values.join("\n")} onChange={(event) => onChange(parseEditableLines(event.target.value))} /><small>One item per line.</small></label>;
}

function ErrorBanner({ error }: { error: ApiError }) {
  return <aside id="builder-error" className="floating-error" role="alert" tabIndex={-1}><strong>Fix this before continuing</strong><p>{error.message}</p>{error.details && <ul>{error.details.map((detail, index) => <li key={`${detail.code}-${detail.path}-${index}`}>{detail.path}: replace the {detail.code.replaceAll("_", " ")}.</li>)}</ul>}</aside>;
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return <aside className="issue-panel" role="alert"><strong>{issues.length} change{issues.length === 1 ? "" : "s"} needed</strong><ul>{issues.map((issue, index) => <li key={`${issue.code}-${issue.path}-${index}`}><b>{issue.path}</b>: {issue.message} {issue.fix}</li>)}</ul></aside>;
}

function downloadFile(file: ScenarioFile) {
  const blob = new Blob([`${JSON.stringify(file.scenario, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function emptyPhase(index: number) {
  return { id: `phase_${index + 1}`, title: `Phase ${index + 1}`, learnerActions: [""], partnerResponse: "", coachGuidance: [""], customerRemainsSilent: false };
}

function emptyObjective(index: number) {
  return { id: `objective_${index + 1}`, label: `Objective ${index + 1}`, description: "", criteria: [""] };
}

function emptyStandardText() {
  return { hotkey: "", category: "", template: "", insertionMoment: "", customization: "", notes: [] as string[], approvedGuidance: "" };
}

function defaultVoiceCompletion(): NonNullable<VoiceExperienceDraft["completion"]> {
  return { enabled: false, autoEnd: false, terminalCustomerPhrases: [], terminalAgentPhrases: [], endDelayMs: 300, endStatus: "Conversation complete. Click End to receive feedback." };
}

function editVoiceExperience(draft: StudioDraft, mutator: (experience: VoiceExperienceDraft) => void) {
  const experience = draft.voice.experience ?? createDefaultVoiceExperience(draft.customer.tone);
  draft.voice.experience = experience;
  mutator(experience);
}

function editVoiceCompletion(draft: StudioDraft, mutator: (completion: NonNullable<VoiceExperienceDraft["completion"]>) => void) {
  editVoiceExperience(draft, (experience) => {
    const completion = experience.completion ?? defaultVoiceCompletion();
    experience.completion = completion;
    mutator(completion);
  });
}

function orderedChannels(channels: Channel[]): Channel[] {
  return (["chat", "voice"] as Channel[]).filter((channel) => channels.includes(channel));
}

function isApiError(value: unknown): value is ApiError {
  return Boolean(value && typeof value === "object" && typeof (value as ApiError).code === "string" && typeof (value as ApiError).message === "string");
}
