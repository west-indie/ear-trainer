import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NOTE_NAMES, type NoteName } from "../audio/music";
import { engine } from "../audio/engine";
import { isTrainingModeEnabled } from "../config/featureFlags";
import { randomNoteName } from "../training/theory";
import { generateSessionQuestions, logTrainingAttempt } from "../training/session";
import type { TrainingMode, TrainingQuestion } from "../training/types";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import { makeGuidedConfig } from "../store/trainingStore";
import PianoRoll from "../ui/PianoRoll";

type Attempt = {
  question: TrainingQuestion;
  selected: string;
  correct: boolean;
  responseMs: number;
};

type PendingAdvance =
  | { kind: "next_question" }
  | { kind: "start_review"; mistakes: Attempt[] }
  | { kind: "complete_session" }
  | { kind: "next_review" }
  | { kind: "complete_review" };

function chooseQuestionCount(): number {
  return 10 + Math.floor(Math.random() * 6);
}

export default function BeginnerPath() {
  const [searchParams] = useSearchParams();
  const [settings, setSettings] = useState(getSettings());
  const [tonicMode, setTonicMode] = useState<"random" | "fixed">("random");
  const [fixedTonic, setFixedTonic] = useState<NoteName>(getSettings().keyRoot);
  const [session, setSession] = useState<TrainingQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const startedAtRef = useRef(0);
  const [revealedQuestionId, setRevealedQuestionId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<Attempt[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewHeard, setReviewHeard] = useState(false);
  const [reviewSung, setReviewSung] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [pendingAdvance, setPendingAdvance] = useState<PendingAdvance | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "review" | "done">("idle");

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);

  const current = status === "review" ? reviewQueue[reviewIndex]?.question : session[index];
  const awaitingReveal = Boolean(
    current
      && current.enforceSinging
      && current.playbackPlan.kind === "sequence"
      && current.playbackPlan.events.length > 1
      && revealedQuestionId !== current.id,
  );
  const progressLabel = useMemo(() => {
    if (status === "review") return `Review ${reviewIndex + 1}/${reviewQueue.length}`;
    if (status !== "running") return "Not started";
    return `Question ${index + 1}/${session.length}`;
  }, [index, reviewIndex, reviewQueue.length, session.length, status]);
  const selectedMode = useMemo<TrainingMode | undefined>(() => {
    const raw = searchParams.get("mode");
    if (raw == null) return undefined;
    if ((raw === "scale_degree" || raw === "functional_interval") && isTrainingModeEnabled(raw)) return raw;
    return undefined;
  }, [searchParams]);

  useEffect(() => {
    if (!current) return;
    void engine.setDrone(
      current.tonicMidi,
      { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre },
      0.16
    );
  }, [current, settings.masterGain, settings.tempoBpm, settings.timbre]);

  useEffect(() => {
    return () => {
      engine.clearDrone();
      engine.stopAll();
    };
  }, []);

  useEffect(() => {
    if (!current || (status !== "running" && status !== "review")) return;
    startedAtRef.current = performance.now();
    if (awaitingReveal && current.playbackPlan.kind === "sequence") {
      const promptEvents = current.playbackPlan.events.slice(0, current.playbackPlan.events.length - 1);
      void engine.play(
        { kind: "sequence", events: promptEvents },
        { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre }
      );
      return;
    }
    void engine.play(current.playbackPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }, [awaitingReveal, current, settings.masterGain, settings.tempoBpm, settings.timbre, status]);

  function startSession() {
    const config = {
      ...makeGuidedConfig(selectedMode == null ? undefined : [selectedMode]),
      randomTonicEvery: tonicMode === "random" ? 3 : -1,
    };
    const questions = generateSessionQuestions({
      config,
      questionCount: chooseQuestionCount(),
      startTonic: tonicMode === "random" ? randomNoteName() : fixedTonic,
      tonicOctave: settings.octave,
    });
    setSession(questions);
    setIndex(0);
    setAttempts([]);
    setSelected(null);
    setRevealedQuestionId(null);
    setReviewQueue([]);
    setReviewIndex(0);
    setShowExplanation(false);
    setPendingAdvance(null);
    setStatus("running");
  }

  function revealAfterSinging() {
    if (!current || current.playbackPlan.kind !== "sequence") return;
    const tail = current.playbackPlan.events[current.playbackPlan.events.length - 1];
    setRevealedQuestionId(current.id);
    void engine.play(
      { kind: "sequence", events: [{ ...tail, atBeats: 0 }] },
      { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre }
    );
  }

  function submitAnswer(answer: string, eventTime: number) {
    if (!current) return;
    const correct = answer === current.correctAnswer;
    const responseMs = Math.max(1, eventTime - startedAtRef.current);
    setSelected(answer);

    if (status === "running") {
      const attempt: Attempt = { question: current, selected: answer, correct, responseMs };
      logTrainingAttempt({ question: current, correct, responseMs });
      const nextAttempts = [...attempts, attempt];
      setAttempts(nextAttempts);

      if (index + 1 < session.length) {
        setPendingAdvance({ kind: "next_question" });
        return;
      }
      const mistakes = nextAttempts.filter((a) => !a.correct);
      if (mistakes.length > 0) {
        setPendingAdvance({ kind: "start_review", mistakes });
        return;
      }
      setPendingAdvance({ kind: "complete_session" });
      return;
    }

    if (status === "review") {
      if (!correct || !reviewHeard || !reviewSung) return;
      if (reviewIndex + 1 < reviewQueue.length) {
        setPendingAdvance({ kind: "next_review" });
        return;
      }
      setPendingAdvance({ kind: "complete_review" });
    }
  }

  function continueAfterFeedback() {
    if (!pendingAdvance) return;
    setSelected(null);
    setPendingAdvance(null);
    setShowExplanation(false);

    if (pendingAdvance.kind === "next_question") {
      setIndex((x) => x + 1);
      return;
    }

    if (pendingAdvance.kind === "start_review") {
      setReviewQueue(pendingAdvance.mistakes);
      setReviewIndex(0);
      setReviewHeard(false);
      setReviewSung(false);
      setStatus("review");
      return;
    }

    if (pendingAdvance.kind === "complete_session" || pendingAdvance.kind === "complete_review") {
      setStatus("done");
      return;
    }

    setReviewIndex((x) => x + 1);
    setReviewHeard(false);
    setReviewSung(false);
  }

  function playCurrent() {
    if (!current) return;
    void engine.play(current.playbackPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }

  const sessionAccuracy = attempts.length > 0 ? (attempts.filter((a) => a.correct).length / attempts.length) * 100 : 0;

  return (
    <div className="page">
      <div style={{ display: "grid", gap: "0.45rem" }}>
        <h2 style={{ margin: 0 }}>Start from Basics</h2>
        <div className="subtle">
          Guided beginner on-ramp with tonic-anchored mixed drills, mandatory singing prediction, and required mistake review.
        </div>
      </div>

      <section className="panel">
        <div className="control-grid">
          <label className="control-label">Tonic source
            <select value={tonicMode} onChange={(e) => setTonicMode(e.target.value as "random" | "fixed")}>
              <option value="random">Randomize tonic</option>
              <option value="fixed">Fixed tonic</option>
            </select>
          </label>
          {tonicMode === "fixed" && (
            <label className="control-label">Fixed tonic
              <select value={fixedTonic} onChange={(e) => setFixedTonic(e.target.value as NoteName)}>
                {NOTE_NAMES.map((note) => (
                  <option key={note} value={note}>{note}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="button-row">
          <button onClick={startSession}>
            {status === "idle" ? "Start basics session" : "Restart basics session"}
          </button>
          <button onClick={playCurrent} disabled={!current}>
            Replay
          </button>
          <div className="meta-pill">{progressLabel}</div>
        </div>
      </section>

      {current && (status === "running" || status === "review") && (
        <section className="panel panel--blue question-card">
          <div className="kicker kicker--blue">Guided Prompt</div>
          <div className="prompt-title">{current.prompt}</div>
          <div className="meta-strip">
            <div className="meta-pill">Tonic <strong>{current.tonic}</strong></div>
            <div className="meta-pill">Mode <strong>{current.mode.replace("_", " ")}</strong></div>
          </div>

          {awaitingReveal && (
            <div className="notice notice--blue">
              <div className="panel-copy">
                Sing the next pitch, then reveal it.
              </div>
              <button onClick={revealAfterSinging} style={{ width: 220 }}>I sang it, reveal pitch</button>
            </div>
          )}

          {!awaitingReveal && (
            <div className="answer-grid">
              {current.answerChoices.map((choice) => {
                const isSelected = selected === choice;
                return (
                  <button
                    key={choice}
                    onClick={(event) => submitAnswer(choice, event.timeStamp)}
                    disabled={selected !== null && status === "running"}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.2)",
                      background: isSelected ? "rgba(0,0,0,0.1)" : "white",
                    }}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="button-row">
              {pendingAdvance && (
                <button style={{ width: 220 }} onClick={continueAfterFeedback}>
                  Continue
                </button>
              )}
              {pendingAdvance && (
                <button type="button" style={{ width: 220 }} onClick={() => setShowExplanation(true)}>
                  Explain why
                </button>
              )}
            </div>
          )}

          {status === "review" && (
            <div className="notice">
              <div className="kicker kicker--red">Review requirements</div>
              <div className="button-row">
                <button
                  onClick={() => {
                    void engine.play(current.playbackPlan, {
                      tempoBpm: settings.tempoBpm,
                      masterGain: settings.masterGain,
                      timbre: settings.timbre,
                    });
                    setReviewHeard(true);
                  }}
                >
                  Play correct answer
                </button>
                <button onClick={() => setReviewSung(true)}>I sang correct answer</button>
              </div>
              <div className="subtle">
                Required: play + sing + answer correctly to continue.
              </div>
            </div>
          )}
        </section>
      )}

      {status === "done" && (
        <section className="panel panel--accent">
          <div className="panel-title">Session complete</div>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__label">Questions</div>
              <div className="metric-card__value">{session.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Accuracy</div>
              <div className="metric-card__value">{sessionAccuracy.toFixed(1)}%</div>
            </div>
          </div>
          <div className="subtle">
            Adaptive reinforcement has updated weak scale degrees, movements, and chord/function areas.
          </div>
        </section>
      )}

      {selected && current && showExplanation && (
        <div className="mode-overlay" onClick={() => setShowExplanation(false)} role="presentation">
          <div
            className="mode-overlay__panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="beginner-feedback-title"
          >
            <div id="beginner-feedback-title" className="panel-title">{current.feedback.title}</div>
            {current.feedback.subtitle && <div className="teaching-line">{current.feedback.subtitle}</div>}
            {current.feedback.note && <div className="teaching-line">{current.feedback.note}</div>}
            <div className="panel-copy">{current.feedback.explanation}</div>
            {current.teaching.lines.map((line, i) => (
              <div key={`${current.id}_teach_${i}`} className="teaching-line">{line}</div>
            ))}
            {current.teaching.tendencyHint && <div className="teaching-line">Hint: {current.teaching.tendencyHint}</div>}
            {current.compareAudio && (
              <button
                style={{ width: 220 }}
                onClick={() => {
                  void engine.play(current.compareAudio!.playbackPlan, {
                    tempoBpm: settings.tempoBpm,
                    masterGain: settings.masterGain,
                    timbre: settings.timbre,
                  });
                }}
              >
                {current.compareAudio.label}
              </button>
            )}
            {settings.visualsEnabled && current.metadata.visualCue?.timelineMidis && (
              <PianoRoll midis={current.metadata.visualCue.timelineMidis} tonicMidi={current.tonicMidi} />
            )}
            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowExplanation(false)}>
              Close explanation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
