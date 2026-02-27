import { useEffect, useMemo, useState } from "react";
import {
  deleteAuthoredDrill,
  getAuthoredDrills,
  modeAdaptiveKeyExamples,
  saveAuthoredDrill,
  subscribeAuthoredDrills,
  type AuthoredDrill,
} from "../store/contentStore";
import { trackEvent } from "../store/analyticsStore";
import type { TrainingMode } from "../training/types";

type DraftState = {
  id?: string;
  name: string;
  mode: TrainingMode;
  adaptiveKey: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string;
  promptOverride: string;
  explanationTitle: string;
  explanationBody: string;
  coachingNotes: string;
  moreBody: string;
  enabled: boolean;
};

const EMPTY_DRAFT: DraftState = {
  name: "",
  mode: "scale_degree",
  adaptiveKey: "degree:3",
  difficulty: 2,
  tags: "warmup",
  promptOverride: "",
  explanationTitle: "",
  explanationBody: "",
  coachingNotes: "",
  moreBody: "",
  enabled: true,
};

function toDraft(drill: AuthoredDrill): DraftState {
  return {
    id: drill.id,
    name: drill.name,
    mode: drill.mode,
    adaptiveKey: drill.adaptiveKey,
    difficulty: drill.difficulty,
    tags: drill.tags.join(", "),
    promptOverride: drill.promptOverride,
    explanationTitle: drill.explanationTitle,
    explanationBody: drill.explanationBody,
    coachingNotes: drill.coachingNotes.join("\n"),
    moreBody: drill.moreBody,
    enabled: drill.enabled,
  };
}

export default function StudioPage() {
  const [drills, setDrills] = useState(getAuthoredDrills());
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  useEffect(() => subscribeAuthoredDrills(() => setDrills(getAuthoredDrills())), []);

  const examples = useMemo(() => modeAdaptiveKeyExamples(draft.mode), [draft.mode]);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    if (!draft.name.trim() || !draft.adaptiveKey.trim()) return;
    saveAuthoredDrill({
      id: draft.id,
      name: draft.name.trim(),
      mode: draft.mode,
      adaptiveKey: draft.adaptiveKey.trim(),
      difficulty: draft.difficulty,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      promptOverride: draft.promptOverride.trim(),
      explanationTitle: draft.explanationTitle.trim() || draft.name.trim(),
      explanationBody: draft.explanationBody.trim(),
      coachingNotes: draft.coachingNotes.split("\n").map((line) => line.trim()).filter(Boolean),
      moreBody: draft.moreBody.trim(),
      enabled: draft.enabled,
    });
    trackEvent("authoring_saved", "/studio", { mode: draft.mode, difficulty: draft.difficulty });
    setDraft({
      ...EMPTY_DRAFT,
      mode: draft.mode,
      adaptiveKey: examples[0] ?? draft.adaptiveKey,
    });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <h2>Studio</h2>
        <p className="subtle">Build reusable drill overlays, tag them for sequencing, and tune the explanatory copy that appears after each answer.</p>
      </div>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h3>{draft.id ? "Edit drill" : "Create drill"}</h3>
          <p className="subtle">The adaptive key should match a supported concept so practice sessions can generate it on demand.</p>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label>
            Name
            <input value={draft.name} onChange={(event) => update("name", event.target.value)} aria-label="Drill name" />
          </label>
          <label>
            Mode
            <select
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as TrainingMode;
                setDraft((current) => ({
                  ...current,
                  mode,
                  adaptiveKey: modeAdaptiveKeyExamples(mode)[0] ?? current.adaptiveKey,
                }));
              }}
              aria-label="Drill mode"
            >
              <option value="scale_degree">Scale degree</option>
              <option value="functional_interval">Functional interval</option>
              <option value="functional_harmony">Functional harmony</option>
              <option value="timing_grid">Timing grid</option>
              <option value="phrase_recall">Phrase recall</option>
            </select>
          </label>
          <label>
            Difficulty
            <select value={draft.difficulty} onChange={(event) => update("difficulty", Number(event.target.value) as DraftState["difficulty"])} aria-label="Drill difficulty">
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>Level {value}</option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Adaptive key
          <input value={draft.adaptiveKey} onChange={(event) => update("adaptiveKey", event.target.value)} aria-label="Adaptive key" />
        </label>
        <div className="subtle" style={{ fontSize: 13 }}>
          Examples: {examples.join(", ")}
        </div>

        <label>
          Prompt override
          <input value={draft.promptOverride} onChange={(event) => update("promptOverride", event.target.value)} aria-label="Prompt override" />
        </label>
        <label>
          Explanation heading
          <input value={draft.explanationTitle} onChange={(event) => update("explanationTitle", event.target.value)} aria-label="Explanation heading" />
        </label>
        <label>
          Explanation
          <textarea value={draft.explanationBody} onChange={(event) => update("explanationBody", event.target.value)} aria-label="Explanation body" />
        </label>
        <label>
          Coaching notes
          <textarea value={draft.coachingNotes} onChange={(event) => update("coachingNotes", event.target.value)} aria-label="Coaching notes" />
        </label>
        <label>
          Extended notes
          <textarea value={draft.moreBody} onChange={(event) => update("moreBody", event.target.value)} aria-label="Extended notes" />
        </label>
        <label>
          Tags
          <input value={draft.tags} onChange={(event) => update("tags", event.target.value)} aria-label="Tags" />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => update("enabled", event.target.checked)}
            style={{ width: 18, minHeight: 18 }}
            aria-label="Enabled"
          />
          Include in live sessions
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={submit}>{draft.id ? "Update drill" : "Save drill"}</button>
          <button onClick={() => setDraft({ ...EMPTY_DRAFT, mode: draft.mode, adaptiveKey: examples[0] ?? EMPTY_DRAFT.adaptiveKey })}>Reset form</button>
        </div>
      </section>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h3>Saved drills</h3>
          <div className="subtle">{drills.length} total</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {drills.map((drill) => (
            <article key={drill.id} style={{ padding: 14, borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-strong)", display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{drill.name}</div>
                  <div className="subtle" style={{ fontSize: 13 }}>{drill.mode.replace("_", " ")} | {drill.adaptiveKey} | level {drill.difficulty}</div>
                </div>
                <div className="subtle" style={{ fontSize: 13 }}>{drill.enabled ? "Live" : "Disabled"}</div>
              </div>
              <div>{drill.explanationBody || "No explanation body yet."}</div>
              <div className="subtle" style={{ fontSize: 13 }}>{drill.tags.join(", ") || "No tags"}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => setDraft(toDraft(drill))}>Edit</button>
                <button onClick={() => deleteAuthoredDrill(drill.id)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
