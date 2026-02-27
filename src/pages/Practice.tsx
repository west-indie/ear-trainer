import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NOTE_NAMES, midiToNoteLabel, midiToNoteName, type NoteName } from "../audio/music";
import { engine } from "../audio/engine";
import type { PlaybackPlan } from "../audio/PlaybackEngine";
import { analyzePitchFrame, type PitchFrame } from "../audio/pitchDetection";
import { getQuickplayPresetDefinition, QUICKPLAY_DEFAULT_PRESET_ID, resolveQuickplayPreset } from "../config/quickplayPresets";
import { getEnabledTrainingModes, isTrainingModeEnabled, sanitizeTrainingModePool } from "../config/featureFlags";
import { generateAuthoredSession, generateFocusedSet, generateSessionQuestions, logTrainingAttempt } from "../training/session";
import { degreeMidi, randomNoteName } from "../training/theory";
import { assessTapPattern, quantizeTapBeats } from "../training/timing";
import { centsOffTarget, extractPitchSegments, type VoicePitchSample } from "../training/voice";
import type { DictationInputMode, GeneratorConfig, TrainingMode, TrainingQuestion } from "../training/types";
import {
  DEFAULT_TRAINING_TOGGLES,
  getTrainingSettings,
  setTrainingSettings,
  type FreePracticePreset,
} from "../store/trainingStore";
import type { ReviewStrategy } from "../store/progressStore";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import { getVoiceSettings } from "../store/voiceStore";
import { getEnabledAuthoredDrills, subscribeAuthoredDrills } from "../store/contentStore";
import { trackEvent } from "../store/analyticsStore";
import PianoRoll from "../ui/PianoRoll";

const DEGREE_TICKS = ["1", "2", "3", "4", "5", "6", "7"];
const EMPTY_FRAME: PitchFrame = {
  freqHz: null,
  midi: null,
  cents: null,
  clarity: 0,
  rms: 0,
  isSignal: false,
  noteLabel: null,
};

function playbackDurationMs(plan: PlaybackPlan, tempoBpm: number) {
  const beatsToMs = (beats: number) => (60_000 / tempoBpm) * beats;

  if (plan.kind === "note" || plan.kind === "chord") {
    return beatsToMs((plan.atBeats ?? 0) + plan.durationBeats);
  }

  if (plan.kind === "sequence") {
    const totalBeats = plan.events.reduce((max, event) => Math.max(max, event.atBeats + event.durationBeats), 0);
    return beatsToMs(totalBeats);
  }

  return 0;
}

const SESSION_TOGGLE_COPY = [
  {
    key: "showAnswerNoteNames",
    title: "Note name answers",
    description: "Adds note names like 2 (F) or 3->2 (G-F) to answer buttons.",
  },
  {
    key: "allowPromptReplay",
    title: "Replay prompt",
    description: "Shows a replay button so the current prompt can be heard more than once.",
  },
  {
    key: "droneEnabled",
    title: "Drone",
    description: "Plays a steady, sustained tonic underneath each prompt.",
  },
  {
    key: "enforceSinging",
    title: "Sing before reveal",
    description: "Holds back the final pitch on sing-back prompts until you reveal it manually.",
  },
  {
    key: "requireMicForSinging",
    title: "Mic answer input",
    description: "Registers your sung note or sung interval as the answer on supported pitch prompts.",
  },
  {
    key: "allowKeyboardInput",
    title: "Keyboard input",
    description: "Adds a text box so you can type the exact answer label.",
  },
] as const;

const EXPLAIN_WHY_TOGGLE_COPY = [
  {
    key: "showExplainWhy",
    title: "Show 'Explain Why' Button",
    description: "Lets the user open the post-answer explanation panel.",
  },
  {
    key: "showIntervalNames",
    title: "Interval names",
    description: "Shows labels like m3, P5, or M6 in the explanation panel.",
  },
  {
    key: "showSemitoneCount",
    title: "Semitone count",
    description: "Shows the raw semitone distance in the explanation panel.",
  },
  {
    key: "showSolfege",
    title: "Solfege",
    description: "Shows movable-do syllables when that prompt includes them.",
  },
  {
    key: "showScaleMap",
    title: "Degree map",
    description: "Shows a 1-7 degree strip with the active movement highlighted.",
  },
  {
    key: "showPianoStrip",
    title: "Keyboard Excerpt",
    description: "Shows a small keyboard view of the notes involved.",
  },
] as const;

type PendingAdvance =
  | { kind: "next_focus_question" }
  | { kind: "finish_focus_set" }
  | { kind: "pause_for_focus_offer" }
  | { kind: "next_question" }
  | { kind: "restart_session" };

type SessionRunKind = "free" | "due" | "weak" | "authored";
type PracticeSetup = Omit<FreePracticePreset, "id" | "name"> & { tonicPool?: NoteName[] };

function buildConfig(args: {
  modePool: TrainingMode[];
  tonicMode: "random" | "fixed";
  intervalLevel: 1 | 2 | 3 | 4;
  degreeLevel: 1 | 2 | 3;
  harmonyLevel: 1 | 2;
  timingLevel: 1 | 2 | 3;
  phraseLevel: 1 | 2 | 3;
  dictationInputMode: DictationInputMode;
  tonalMode: "major" | "natural_minor" | "harmonic_minor" | "melodic_minor" | "modal";
  intervalVariant: "sequential_pause" | "immediate_jump" | "harmonic_stack" | "scale_context";
  harmonyVariant: "block" | "arpeggiated" | "mixed";
  tonicPool?: NoteName[];
  enforceSinging: boolean;
}): GeneratorConfig {
  return {
    sessionType: "free",
    modePool: args.modePool.length > 0 ? args.modePool : ["scale_degree"],
    tonicPool: args.tonicPool,
    intervalLevel: args.intervalLevel,
    degreeLevel: args.degreeLevel,
    harmonyLevel: args.harmonyLevel,
    timingLevel: args.timingLevel,
    phraseLevel: args.phraseLevel,
    dictationInputMode: args.dictationInputMode,
    tonalMode: args.tonalMode,
    intervalPlaybackVariant: args.intervalVariant,
    harmonyPlaybackVariant: args.harmonyVariant,
    randomTonicEvery: args.tonicMode === "random" ? 3 : -1,
    singingQuota: args.enforceSinging ? 1 : 0,
    predictiveResolutionChance: 0.2,
  };
}

export default function Practice() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState(getSettings());
  const [training, setTraining] = useState(getTrainingSettings());
  const [voiceSettings] = useState(getVoiceSettings());
  const [modePool, setModePool] = useState<TrainingMode[]>(getEnabledTrainingModes());
  const [tonicMode, setTonicMode] = useState<"random" | "fixed">("random");
  const [fixedTonic, setFixedTonic] = useState<NoteName>(getSettings().keyRoot);
  const [tonicPool, setTonicPool] = useState<NoteName[] | undefined>(undefined);
  const [intervalLevel, setIntervalLevel] = useState<1 | 2 | 3 | 4>(1);
  const [degreeLevel, setDegreeLevel] = useState<1 | 2 | 3>(1);
  const [harmonyLevel, setHarmonyLevel] = useState<1 | 2>(1);
  const [timingLevel, setTimingLevel] = useState<1 | 2 | 3>(1);
  const [phraseLevel, setPhraseLevel] = useState<1 | 2 | 3>(1);
  const [dictationInputMode, setDictationInputMode] = useState<DictationInputMode>("multiple_choice");
  const [intervalVariant, setIntervalVariant] = useState<"sequential_pause" | "immediate_jump" | "harmonic_stack" | "scale_context">("scale_context");
  const [harmonyVariant, setHarmonyVariant] = useState<"block" | "arpeggiated" | "mixed">("block");
  const [tonalMode, setTonalMode] = useState<"major" | "natural_minor" | "harmonic_minor" | "melodic_minor" | "modal">("major");
  const [questions, setQuestions] = useState<TrainingQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [awaitingReveal, setAwaitingReveal] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [practiceMicReady, setPracticeMicReady] = useState(false);
  const [practiceMicError, setPracticeMicError] = useState<string | null>(null);
  const [practiceMicFrame, setPracticeMicFrame] = useState<PitchFrame>(EMPTY_FRAME);
  const [practiceMicCandidateAnswer, setPracticeMicCandidateAnswer] = useState<string | null>(null);
  const [practiceMicHoldMs, setPracticeMicHoldMs] = useState(0);
  const [promptPlaybackActive, setPromptPlaybackActive] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [score, setScore] = useState({ attempts: 0, correct: 0 });
  const [activeReview, setActiveReview] = useState<ReviewStrategy | null>(null);
  const [missStreak, setMissStreak] = useState(0);
  const [focusOfferSource, setFocusOfferSource] = useState<TrainingQuestion | null>(null);
  const [focusQuestions, setFocusQuestions] = useState<TrainingQuestion[] | null>(null);
  const [focusResumeIndex, setFocusResumeIndex] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusStartedAt, setFocusStartedAt] = useState(0);
  const [focusNow, setFocusNow] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const [pendingAdvance, setPendingAdvance] = useState<PendingAdvance | null>(null);
  const [pendingSessionRestart, setPendingSessionRestart] = useState(false);
  const [tapCaptureStartAt, setTapCaptureStartAt] = useState<number | null>(null);
  const [tapBeats, setTapBeats] = useState<number[]>([]);
  const [tapOverlay, setTapOverlay] = useState<string[]>([]);
  const [phraseDraft, setPhraseDraft] = useState<string[]>([]);
  const [phraseText, setPhraseText] = useState("");
  const [authoredDrills, setAuthoredDrills] = useState(getEnabledAuthoredDrills());
  const [sessionRunKind, setSessionRunKind] = useState<SessionRunKind>("free");
  const sessionActiveRef = useRef(false);
  const detectorContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const lastMicUiTickRef = useRef(0);
  const micMatchStartedAtRef = useRef<number | null>(null);
  const micCandidateAnswerRef = useRef<string | null>(null);
  const micAutoSubmittedRef = useRef(false);
  const practiceMicSamplesRef = useRef<VoicePitchSample[]>([]);
  const micAnswerActiveRef = useRef(false);
  const promptPlaybackTimerRef = useRef<number | null>(null);

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);
  useEffect(() => subscribeAuthoredDrills(() => setAuthoredDrills(getEnabledAuthoredDrills())), []);

  useEffect(() => () => {
    if (sessionActiveRef.current && score.attempts > 0) {
      trackEvent("session_abandon", "/practice", { attempts: score.attempts, modeCount: modePool.length });
    }
  }, [modePool.length, score.attempts]);

  const inFocusSet = focusQuestions != null;
  const current = inFocusSet ? focusQuestions[focusIndex] : questions[index];
  const toggles = training.freePracticeToggles;
  const sessionStarted = questions.length > 0 || inFocusSet || focusOfferSource != null;
  const scaleDegreeEnabled = modePool.includes("scale_degree");
  const functionalIntervalEnabled = modePool.includes("functional_interval");
  const fixedTonicDisabled = tonicMode === "random";
  const micAnswerTargets = useMemo(() => {
    if (!current || current.metadata.phrase || current.metadata.timing?.supportsTapPad) {
      return [];
    }
    const tonal = current.metadata.tonalMode ?? tonalMode;
    const tonicOctave = midiToNoteName(current.tonicMidi).octave;

    if (current.mode === "scale_degree") {
      return current.answerChoices.map((answer) => ({
        answer,
        targetMidis: [degreeMidi(current.tonic, tonicOctave, answer, tonal)],
        label: midiToNoteLabel(degreeMidi(current.tonic, tonicOctave, answer, tonal)),
      }));
    }

    if (current.mode === "functional_interval") {
      return current.answerChoices
        .map((answer) => {
          const [fromDegree, toDegree] = answer.split("->");
          if (!fromDegree || !toDegree) return null;
          const fromMidi = degreeMidi(current.tonic, tonicOctave, fromDegree, tonal);
          let toMidi = degreeMidi(current.tonic, tonicOctave, toDegree, tonal);
          if (
            answer === current.correctAnswer
            && current.metadata.semitones === 12
            && fromDegree === "1"
            && toDegree === "1"
          ) {
            toMidi += 12;
          }
          return {
            answer,
            targetMidis: [fromMidi, toMidi],
            label: `${midiToNoteLabel(fromMidi)} -> ${midiToNoteLabel(toMidi)}`,
          };
        })
        .filter((target): target is { answer: string; targetMidis: number[]; label: string } => target != null);
    }

    return [];
  }, [current, tonalMode]);
  const micAnswerActive =
    toggles.requireMicForSinging
    && !awaitingReveal
    && !promptPlaybackActive
    && selected === null
    && micAnswerTargets.length > 0;
  const micAnswerUnsupported =
    toggles.requireMicForSinging
    && !awaitingReveal
    && !promptPlaybackActive
    && selected === null
    && current != null
    && !current.metadata.phrase
    && !current.metadata.timing?.supportsTapPad
    && micAnswerTargets.length === 0;
  const micCandidateTarget = practiceMicCandidateAnswer == null
    ? null
    : micAnswerTargets.find((target) => target.answer === practiceMicCandidateAnswer) ?? null;
  const micCentsOff = micCandidateTarget != null && practiceMicFrame.midi != null
    ? centsOffTarget(practiceMicFrame.midi, micCandidateTarget.targetMidis[micCandidateTarget.targetMidis.length - 1])
    : null;
  const shouldShowAnswerSummary =
    current != null
    && selected !== null
    && (
      (current.mode === "scale_degree" && scaleDegreeEnabled)
      || (current.mode === "functional_interval" && functionalIntervalEnabled)
    );
  const functionUnlocked = useMemo(() => {
    if (score.attempts < 10) return false;
    return score.correct / score.attempts >= 0.8;
  }, [score.attempts, score.correct]);
  const focusSecondsLeft = inFocusSet ? Math.max(0, 60 - Math.floor((focusNow - focusStartedAt) / 1000)) : 0;

  useEffect(() => {
    micAnswerActiveRef.current = micAnswerActive;
  }, [micAnswerActive]);

  useEffect(() => {
    if (!inFocusSet) return;
    setFocusNow(Date.now());
    const timer = window.setInterval(() => setFocusNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [inFocusSet]);

  useEffect(() => {
    setShowMore(false);
    setTapCaptureStartAt(null);
    setTapBeats([]);
    setTapOverlay([]);
    setPhraseDraft([]);
    setPhraseText("");
    setPracticeMicCandidateAnswer(null);
    setPracticeMicHoldMs(0);
    practiceMicSamplesRef.current = [];
    micMatchStartedAtRef.current = null;
    micCandidateAnswerRef.current = null;
    micAutoSubmittedRef.current = false;
    if (!current) return;
    setSelected(null);
    setPendingAdvance(null);
    setTypedAnswer("");
    setStartedAt(Date.now());

    if (toggles.droneEnabled && !toggles.requireMicForSinging) {
      void engine.setDrone(
        current.tonicMidi,
        { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre },
        0.16
      );
    } else {
      engine.clearDrone();
    }

    if (current.enforceSinging && current.playbackPlan.kind === "sequence" && current.playbackPlan.events.length > 1) {
      const promptOnly = current.playbackPlan.events.slice(0, current.playbackPlan.events.length - 1);
      setAwaitingReveal(true);
      playWithMicSuppressed({ kind: "sequence", events: promptOnly });
      return;
    }

    setAwaitingReveal(false);
    playWithMicSuppressed(current.playbackPlan);
  }, [current, settings.masterGain, settings.tempoBpm, settings.timbre, toggles.droneEnabled, toggles.requireMicForSinging]);

  useEffect(() => {
    return () => {
      engine.clearDrone();
      engine.stopAll();
      if (promptPlaybackTimerRef.current != null) window.clearTimeout(promptPlaybackTimerRef.current);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      if (detectorContextRef.current != null) void detectorContextRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (!micAnswerActive || micAutoSubmittedRef.current) {
      micMatchStartedAtRef.current = null;
      micCandidateAnswerRef.current = null;
      setPracticeMicCandidateAnswer(null);
      setPracticeMicHoldMs(0);
      return;
    }

    const segments = extractPitchSegments(practiceMicSamplesRef.current);
    let matched:
      | { answer: string; targetMidis: number[]; label: string; cents: number }
      | undefined;

    if (current?.mode === "scale_degree") {
      if (practiceMicFrame.midi == null || !practiceMicFrame.isSignal) {
        micMatchStartedAtRef.current = null;
        micCandidateAnswerRef.current = null;
        setPracticeMicCandidateAnswer(null);
        setPracticeMicHoldMs(0);
        return;
      }
      const detectedMidi = practiceMicFrame.midi;
      matched = micAnswerTargets
        .map((target) => ({
          ...target,
          cents: centsOffTarget(detectedMidi, target.targetMidis[0]),
        }))
        .filter((target) => Math.abs(target.cents) <= voiceSettings.toleranceCents)
        .sort((a, b) => Math.abs(a.cents) - Math.abs(b.cents))[0];
    } else if (current?.mode === "functional_interval" && segments.length >= 2) {
      const sung = segments.slice(-2);
      matched = micAnswerTargets
        .filter((target) => target.targetMidis.length === 2)
        .map((target) => {
          const firstCents = centsOffTarget(sung[0].avgMidi, target.targetMidis[0]);
          const secondCents = centsOffTarget(sung[1].avgMidi, target.targetMidis[1]);
          return {
            ...target,
            cents: (Math.abs(firstCents) + Math.abs(secondCents)) / 2,
            firstCents,
            secondCents,
          };
        })
        .filter((target) =>
          Math.abs(target.firstCents) <= voiceSettings.toleranceCents
          && Math.abs(target.secondCents) <= voiceSettings.toleranceCents
        )
        .sort((a, b) => a.cents - b.cents)[0];
    }

    if (!matched) {
      micMatchStartedAtRef.current = null;
      micCandidateAnswerRef.current = null;
      setPracticeMicCandidateAnswer(null);
      setPracticeMicHoldMs(0);
      return;
    }

    const now = performance.now();
    if (micCandidateAnswerRef.current !== matched.answer) {
      micCandidateAnswerRef.current = matched.answer;
      micMatchStartedAtRef.current = now;
      setPracticeMicCandidateAnswer(matched.answer);
      setPracticeMicHoldMs(0);
      return;
    }

    micMatchStartedAtRef.current ??= now;
    setPracticeMicCandidateAnswer(matched.answer);
    const holdMs = Math.max(0, Math.round(now - micMatchStartedAtRef.current));
    setPracticeMicHoldMs(holdMs);
    if (holdMs >= voiceSettings.holdDurationMs) {
      micAutoSubmittedRef.current = true;
      submit(matched.answer);
    }
  }, [current?.mode, micAnswerActive, micAnswerTargets, practiceMicFrame, voiceSettings.holdDurationMs, voiceSettings.toleranceCents]);

  useEffect(() => {
    if (!pendingSessionRestart || !sessionStarted) return;
    setPendingSessionRestart(false);
    restartCurrentSession();
  }, [pendingSessionRestart, sessionStarted, modePool, tonicMode, fixedTonic, tonicPool, intervalLevel, degreeLevel, tonalMode, intervalVariant]);

  function persist(nextToggles: typeof toggles) {
    const next = { ...training, freePracticeToggles: nextToggles };
    setTraining(next);
    setTrainingSettings(next);
  }

  function renderToggle(
    key: keyof typeof toggles,
    title: string,
    description: string,
    disabled = false,
    onToggle?: (nextValue: boolean) => void,
    compact = false
  ) {
    const selected = toggles[key];
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={
          selected
            ? `checkbox-chip checkbox-chip--stacked checkbox-chip--selected${compact ? " checkbox-chip--compact" : ""}`
            : `checkbox-chip checkbox-chip--stacked${compact ? " checkbox-chip--compact" : ""}`
        }
        key={key}
        disabled={disabled}
        onClick={() => {
          const nextValue = !selected;
          if (onToggle) {
            onToggle(nextValue);
            return;
          }
          persist({ ...toggles, [key]: nextValue });
        }}
      >
        <span className="checkbox-chip__body">
          <span className="checkbox-chip__title">{title}</span>
          {!compact && <span className="checkbox-chip__copy">{description}</span>}
        </span>
      </button>
    );
  }

  function formatAnswerSummary(question: TrainingQuestion): string {
    const tonal = question.metadata.tonalMode ?? tonalMode;
    const tonicOctave = midiToNoteName(question.tonicMidi).octave;

    if (question.mode === "scale_degree") {
      const answerMidi = degreeMidi(question.tonic, tonicOctave, question.correctAnswer, tonal);
      return `${question.correctAnswer} (${midiToNoteName(answerMidi).name})`;
    }

    if (question.mode === "functional_interval") {
      const [fromDegree, toDegree] = question.correctAnswer.split("->");
      if (fromDegree && toDegree) {
        const fromMidi = degreeMidi(question.tonic, tonicOctave, fromDegree, tonal);
        const toMidi = degreeMidi(question.tonic, tonicOctave, toDegree, tonal);
        return `${fromDegree}-${toDegree} (${midiToNoteName(fromMidi).name}-${midiToNoteName(toMidi).name})`;
      }
    }

    return question.correctAnswer;
  }

  function formatChoiceWithNotes(question: TrainingQuestion, choice: string): { label: string; noteText: string | null } {
    const tonal = question.metadata.tonalMode ?? tonalMode;
    const tonicOctave = midiToNoteName(question.tonicMidi).octave;

    if (question.mode === "scale_degree") {
      const answerMidi = degreeMidi(question.tonic, tonicOctave, choice, tonal);
      return {
        label: choice,
        noteText: `(${midiToNoteName(answerMidi).name})`,
      };
    }

    if (question.mode === "functional_interval") {
      const [fromDegree, toDegree] = choice.split("->");
      if (fromDegree && toDegree) {
        const fromMidi = degreeMidi(question.tonic, tonicOctave, fromDegree, tonal);
        const toMidi = degreeMidi(question.tonic, tonicOctave, toDegree, tonal);
        return {
          label: choice,
          noteText: `(${midiToNoteName(fromMidi).name}-${midiToNoteName(toMidi).name})`,
        };
      }
    }

    return { label: choice, noteText: null };
  }

  function rerunSession(kind: SessionRunKind = sessionRunKind) {
    if (kind === "authored") {
      startAuthoredRun();
      return;
    }
    if (kind === "due" || kind === "weak") {
      start(kind);
      return;
    }
    start();
  }

  function restartCurrentSession() {
    setShowSessionSettings(false);
    setShowMore(false);
    setSelected(null);
    setPendingAdvance(null);
    setFocusOfferSource(null);
    setFocusQuestions(null);
    setFocusResumeIndex(null);
    setFocusIndex(0);
    setTapCaptureStartAt(null);
    setTapBeats([]);
    setTapOverlay([]);
    setPhraseDraft([]);
    setPhraseText("");
    engine.clearDrone();
    engine.stopAll();
    rerunSession();
  }

  function updateSubstantialSetting(change: () => void) {
    change();
    if (sessionStarted) {
      setPendingSessionRestart(true);
    }
  }

  function updateSessionToggle(key: keyof typeof toggles, nextValue: boolean, shouldRestart: boolean) {
    let nextToggles = { ...toggles, [key]: nextValue };
    if (key === "requireMicForSinging" && nextValue) {
      nextToggles = { ...nextToggles, enforceSinging: true };
    }
    if (key === "enforceSinging" && !nextValue) {
      nextToggles = { ...nextToggles, requireMicForSinging: false };
    }
    persist(nextToggles);
    if (shouldRestart && sessionStarted) {
      setPendingSessionRestart(true);
    }
  }

  function playWithMicSuppressed(plan: PlaybackPlan) {
    if (promptPlaybackTimerRef.current != null) {
      window.clearTimeout(promptPlaybackTimerRef.current);
    }
    const durationMs = playbackDurationMs(plan, settings.tempoBpm);
    setPromptPlaybackActive(durationMs > 0);
    void engine.play(plan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
    if (durationMs <= 0) return;
    promptPlaybackTimerRef.current = window.setTimeout(() => {
      setPromptPlaybackActive(false);
      promptPlaybackTimerRef.current = null;
    }, durationMs + 120);
  }

  function replayCurrentPrompt() {
    if (!current) return;
    if (awaitingReveal && current.playbackPlan.kind === "sequence" && current.playbackPlan.events.length > 1) {
      playWithMicSuppressed({ kind: "sequence", events: current.playbackPlan.events.slice(0, current.playbackPlan.events.length - 1) });
      return;
    }
    playWithMicSuppressed(current.playbackPlan);
  }

  async function enablePracticeMic() {
    if (practiceMicReady) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPracticeMicError("This browser does not expose microphone input.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.12;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
      detectorContextRef.current = context;
      analyserRef.current = analyser;
      sourceRef.current = source;
      streamRef.current = stream;
      frameBufferRef.current = buffer;
      setPracticeMicReady(true);
      setPracticeMicError(null);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const detectorContext = detectorContextRef.current;
        const frameBuffer = frameBufferRef.current;
        if (!analyserNode || !detectorContext || !frameBuffer) return;

        analyserNode.getFloatTimeDomainData(frameBuffer);
        const frame = analyzePitchFrame(frameBuffer, detectorContext.sampleRate, voiceSettings.noiseGate);
        if (micAnswerActiveRef.current && frame.midi != null) {
          const nextSamples = [...practiceMicSamplesRef.current, { atMs: performance.now(), midi: frame.midi, rms: frame.rms }];
          practiceMicSamplesRef.current = nextSamples.slice(-160);
        } else if (!micAnswerActiveRef.current) {
          practiceMicSamplesRef.current = [];
        }
        const now = performance.now();
        if (now - lastMicUiTickRef.current > 70) {
          lastMicUiTickRef.current = now;
          setPracticeMicFrame(frame);
        }
        rafRef.current = window.requestAnimationFrame(tick);
      };

      rafRef.current = window.requestAnimationFrame(tick);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microphone permission failed.";
      setPracticeMicError(message);
      setPracticeMicReady(false);
    }
  }

  function revealHiddenPitch() {
    if (!current || !awaitingReveal || current.playbackPlan.kind !== "sequence") return;
    const tail = current.playbackPlan.events[current.playbackPlan.events.length - 1];
    setAwaitingReveal(false);
    setPracticeMicHoldMs(0);
    micMatchStartedAtRef.current = null;
    playWithMicSuppressed({ kind: "sequence", events: [{ ...tail, atBeats: 0 }] });
  }

  function getCurrentPracticeSetup(): PracticeSetup {
    return {
      modePool: sanitizeTrainingModePool(modePool),
      tonicMode,
      fixedTonic,
      tonicPool,
      intervalLevel,
      degreeLevel,
      harmonyLevel,
      timingLevel,
      phraseLevel,
      dictationInputMode,
      tonalMode,
      intervalPlaybackVariant: intervalVariant,
      harmonyPlaybackVariant: harmonyVariant,
      toggles,
    };
  }

  function applyPracticeSetup(next: PracticeSetup) {
    setModePool(sanitizeTrainingModePool(next.modePool));
    setTonicMode(next.tonicMode);
    setFixedTonic(next.fixedTonic);
    setTonicPool(next.tonicPool);
    setIntervalLevel(next.intervalLevel);
    setDegreeLevel(next.degreeLevel);
    setHarmonyLevel(next.harmonyLevel);
    setTimingLevel(next.timingLevel);
    setPhraseLevel(next.phraseLevel);
    setDictationInputMode(next.dictationInputMode);
    setTonalMode(next.tonalMode);
    setIntervalVariant(next.intervalPlaybackVariant);
    setHarmonyVariant(next.harmonyPlaybackVariant);
    persist(next.toggles);
  }

  function start(reviewStrategy?: ReviewStrategy, practiceSetup: PracticeSetup = getCurrentPracticeSetup()) {
    const config = buildConfig({
      modePool: practiceSetup.modePool,
      tonicMode: practiceSetup.tonicMode,
      tonicPool: practiceSetup.tonicPool,
      intervalLevel: practiceSetup.intervalLevel,
      degreeLevel: practiceSetup.degreeLevel,
      harmonyLevel: practiceSetup.harmonyLevel,
      timingLevel: practiceSetup.timingLevel,
      phraseLevel: practiceSetup.phraseLevel,
      dictationInputMode: practiceSetup.dictationInputMode,
      tonalMode: practiceSetup.tonalMode,
      intervalVariant: practiceSetup.intervalPlaybackVariant,
      harmonyVariant: practiceSetup.harmonyPlaybackVariant,
      enforceSinging: practiceSetup.toggles.enforceSinging,
    });
    const session = generateSessionQuestions({
      config,
      questionCount: 15,
      startTonic:
        practiceSetup.tonicMode === "random"
          ? randomNoteName(undefined, practiceSetup.tonicPool ?? NOTE_NAMES)
          : practiceSetup.fixedTonic,
      tonicOctave: settings.octave,
      reviewStrategy,
    });
    setQuestions(session);
    setIndex(0);
    setScore({ attempts: 0, correct: 0 });
    setActiveReview(reviewStrategy ?? null);
    setMissStreak(0);
    setFocusOfferSource(null);
    setFocusQuestions(null);
    setFocusResumeIndex(null);
    setFocusIndex(0);
    setPendingAdvance(null);
    setSessionRunKind(reviewStrategy ?? "free");
    sessionActiveRef.current = true;
    trackEvent("session_start", "/practice", {
      review: reviewStrategy ?? "none",
      questionCount: session.length,
      modeCount: practiceSetup.modePool.length,
    });
  }

  function startAuthoredRun(practiceSetup: PracticeSetup = getCurrentPracticeSetup()) {
    const config = buildConfig({
      modePool: practiceSetup.modePool,
      tonicMode: practiceSetup.tonicMode,
      tonicPool: practiceSetup.tonicPool,
      intervalLevel: practiceSetup.intervalLevel,
      degreeLevel: practiceSetup.degreeLevel,
      harmonyLevel: practiceSetup.harmonyLevel,
      timingLevel: practiceSetup.timingLevel,
      phraseLevel: practiceSetup.phraseLevel,
      dictationInputMode: practiceSetup.dictationInputMode,
      tonalMode: practiceSetup.tonalMode,
      intervalVariant: practiceSetup.intervalPlaybackVariant,
      harmonyVariant: practiceSetup.harmonyPlaybackVariant,
      enforceSinging: false,
    });
    const matching = authoredDrills.filter((drill) => practiceSetup.modePool.includes(drill.mode));
    if (matching.length === 0) return;
    const session = generateAuthoredSession({
      config,
      drills: matching.slice(0, 12),
      startTonic:
        practiceSetup.tonicMode === "random"
          ? randomNoteName(undefined, practiceSetup.tonicPool ?? NOTE_NAMES)
          : practiceSetup.fixedTonic,
      tonicOctave: settings.octave,
    });
    setQuestions(session);
    setIndex(0);
    setScore({ attempts: 0, correct: 0 });
    setActiveReview(null);
    setMissStreak(0);
    setFocusOfferSource(null);
    setFocusQuestions(null);
    setFocusResumeIndex(null);
    setFocusIndex(0);
    setPendingAdvance(null);
    setSessionRunKind("authored");
    sessionActiveRef.current = true;
    trackEvent("session_start", "/practice", { review: "authored", questionCount: session.length });
  }

  function startSessionKind(kind: SessionRunKind, practiceSetup: PracticeSetup = getCurrentPracticeSetup()) {
    if (kind === "authored") {
      if (authoredDrills.some((drill) => practiceSetup.modePool.includes(drill.mode))) {
        startAuthoredRun(practiceSetup);
        return;
      }
      start(undefined, practiceSetup);
      return;
    }
    if (kind === "due" || kind === "weak") {
      start(kind, practiceSetup);
      return;
    }
    start(undefined, practiceSetup);
  }

  useEffect(() => {
    const review = searchParams.get("review");
    const mode = searchParams.get("mode");
    const presetId = searchParams.get("preset");
    const quickplayId = searchParams.get("quickplay");
    const quickplayTopics = searchParams.get("quickplayTopics");
    const quickplayTonicLevel = searchParams.get("quickplayTonicLevel");
    const quickplayFixedTonic = searchParams.get("quickplayFixedTonic");
    const quickplayFixedPool = searchParams.get("quickplayFixedPool");
    const quickplayIntervalLevel = searchParams.get("quickplayIntervalLevel");
    const quickplayDegreeLevel = searchParams.get("quickplayDegreeLevel");
    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (quickplayId) {
      const resolved = resolveQuickplayPreset(quickplayId, {
        modePool: sanitizeTrainingModePool(
          (quickplayTopics ?? "")
            .split(",")
            .filter((value): value is TrainingMode =>
              value === "scale_degree"
              || value === "functional_interval"
              || value === "functional_harmony"
              || value === "timing_grid"
              || value === "phrase_recall"
            )
        ),
        tonicSourceLevel: quickplayTonicLevel === "3" ? 3 : quickplayTonicLevel === "2" ? 2 : 1,
        fixedTonic: NOTE_NAMES.includes((quickplayFixedTonic ?? settings.keyRoot) as NoteName)
          ? (quickplayFixedTonic as NoteName)
          : settings.keyRoot,
        fixedPoolRoot: NOTE_NAMES.includes((quickplayFixedPool ?? "C") as NoteName)
          ? (quickplayFixedPool as NoteName)
          : "C",
        intervalLevel:
          quickplayIntervalLevel === "4"
            ? 4
            : quickplayIntervalLevel === "3"
              ? 3
              : quickplayIntervalLevel === "2"
                ? 2
                : 1,
        degreeLevel: quickplayDegreeLevel === "3" ? 3 : quickplayDegreeLevel === "2" ? 2 : 1,
      });
      applyPracticeSetup(resolved.settings);
      startSessionKind("free", resolved.settings);
      next.delete("quickplay");
      next.delete("quickplayTopics");
      next.delete("quickplayTonicLevel");
      next.delete("quickplayFixedTonic");
      next.delete("quickplayFixedPool");
      next.delete("quickplayIntervalLevel");
      next.delete("quickplayDegreeLevel");
      changed = true;
    }

    if ((mode === "scale_degree" || mode === "functional_interval") && isTrainingModeEnabled(mode)) {
      setModePool([mode]);
      next.delete("mode");
      changed = true;
    }

    if (review === "due" || review === "weak") {
      start(review);
      next.delete("review");
      changed = true;
    }

    if (presetId) {
      applyPreset(presetId);
      next.delete("preset");
      changed = true;
    }

    if (!changed) return;

    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);

  function submitOutcome(answer: string, correct: boolean) {
    if (!current) return;
    const responseMs = Math.max(1, Date.now() - startedAt);
    setPracticeMicCandidateAnswer(null);
    setPracticeMicHoldMs(0);
    micCandidateAnswerRef.current = null;
    setSelected(answer);
    logTrainingAttempt({ question: current, correct, responseMs });
    trackEvent("question_answered", "/practice", { mode: current.mode, correct, responseMs });

    if (inFocusSet) {
      if (!focusQuestions || focusIndex + 1 >= focusQuestions.length) {
        setPendingAdvance({ kind: "finish_focus_set" });
        return;
      }
      setPendingAdvance({ kind: "next_focus_question" });
      return;
    }

    const nextMissStreak = correct ? 0 : missStreak + 1;
    const shouldPauseForFocus = nextMissStreak >= 3;
    setScore((s) => ({ attempts: s.attempts + 1, correct: s.correct + (correct ? 1 : 0) }));
    setMissStreak(shouldPauseForFocus ? 0 : nextMissStreak);
    if (shouldPauseForFocus) {
      setFocusOfferSource(current);
      setFocusResumeIndex(index + 1);
      setPendingAdvance({ kind: "pause_for_focus_offer" });
      return;
    }

    if (index + 1 >= questions.length) {
      setPendingAdvance({ kind: "restart_session" });
      return;
    }
    setPendingAdvance({ kind: "next_question" });
  }

  function submit(answer: string) {
    if (!current) return;
    submitOutcome(answer, answer === current.correctAnswer);
  }

  function continueAfterFeedback() {
    if (!pendingAdvance) return;
    setPendingAdvance(null);
    setSelected(null);

    if (pendingAdvance.kind === "next_focus_question") {
      setFocusIndex((x) => x + 1);
      return;
    }

    if (pendingAdvance.kind === "finish_focus_set") {
      setFocusQuestions(null);
      setFocusIndex(0);
      if (focusResumeIndex != null) {
        if (focusResumeIndex >= questions.length) {
          sessionActiveRef.current = false;
          trackEvent("session_complete", "/practice", {
            attempts: score.attempts,
            accuracy: score.correct / Math.max(1, score.attempts),
          });
          rerunSession();
        } else {
          setIndex(focusResumeIndex);
        }
      }
      setFocusResumeIndex(null);
      return;
    }

    if (pendingAdvance.kind === "pause_for_focus_offer") return;

    if (pendingAdvance.kind === "restart_session") {
      sessionActiveRef.current = false;
      trackEvent("session_complete", "/practice", {
        attempts: score.attempts,
        accuracy: score.correct / Math.max(1, score.attempts),
      });
      rerunSession();
      return;
    }

    setIndex((x) => x + 1);
  }

  function beginTapCapture() {
    if (!current?.metadata.timing?.supportsTapPad) return;
    setTapCaptureStartAt(Date.now());
    setTapBeats([]);
    setTapOverlay([]);
    const replay = current.compareAudio?.playbackPlan ?? current.playbackPlan;
    playWithMicSuppressed(replay);
  }

  function registerTap() {
    if (!current?.metadata.timing?.supportsTapPad || tapCaptureStartAt == null) return;
    const beatMs = (60_000 / settings.tempoBpm);
    const countIn = current.metadata.countInBeats ?? 0;
    const elapsedBeats = (Date.now() - tapCaptureStartAt) / beatMs - countIn;
    if (elapsedBeats < -0.4) return;
    setTapBeats((prev) => [...prev, elapsedBeats]);
  }

  function submitTapCapture() {
    if (!current?.metadata.timing?.supportsTapPad) return;
    const timing = current.metadata.timing;
    const quantized = quantizeTapBeats(tapBeats, timing.quantizeStepBeats, timing.patternLengthBeats);
    const result = assessTapPattern({
      taps: quantized,
      target: timing.targetBeats,
      bpm: settings.tempoBpm,
    });
    const overlay = result.errors.map((err, idx) => {
      if (err.deltaMs == null || err.tappedBeat == null) return `Hit ${idx + 1}: missed`;
      const sign = err.deltaMs > 0 ? "+" : "";
      return `Hit ${idx + 1}: ${sign}${Math.round(err.deltaMs)}ms`;
    });
    setTapOverlay(overlay);
    submitOutcome(`tap:${result.matched}/${result.expected}`, result.accuracy >= 0.72);
  }

  function appendPhraseDegree(degree: string) {
    if (!current?.metadata.phrase) return;
    const max = current.metadata.phrase.expectedDegrees.length;
    setPhraseDraft((prev) => prev.length >= max ? prev : [...prev, degree]);
  }

  function clearPhraseDraft() {
    setPhraseDraft([]);
  }

  function submitPhraseDraft() {
    if (!current?.metadata.phrase) return;
    const groups = current.metadata.phrase.measureGroups;
    const notesPerBar = groups[0]?.length ?? 4;
    const bars = groups.length;
    const clipped = phraseDraft.slice(0, notesPerBar * bars);
    const answer = Array.from({ length: bars }, (_, idx) => clipped.slice(idx * notesPerBar, idx * notesPerBar + notesPerBar).join(" ")).join(" | ");
    submit(answer);
  }

  function submitPhraseText() {
    if (!current?.metadata.phrase) return;
    const normalized = phraseText.trim().replace(/\s*\|\s*/g, " | ").replace(/\s+/g, " ");
    submit(normalized);
  }

  function startFocusSet() {
    if (!focusOfferSource) return;
    const config = buildConfig({
      modePool,
      tonicMode,
      tonicPool,
      intervalLevel,
      degreeLevel,
      harmonyLevel,
      timingLevel,
      phraseLevel,
      dictationInputMode,
      tonalMode,
      intervalVariant,
      harmonyVariant,
      enforceSinging: false,
    });
    setFocusQuestions(
      generateFocusedSet({
        config,
        sourceQuestion: focusOfferSource,
        startTonic: tonicMode === "random" ? randomNoteName(focusOfferSource.tonic, tonicPool ?? NOTE_NAMES) : fixedTonic,
        tonicOctave: settings.octave,
        questionCount: 5,
      })
    );
    setFocusIndex(0);
    setFocusStartedAt(Date.now());
    setFocusNow(Date.now());
    setFocusOfferSource(null);
  }

  function toggleMode(mode: TrainingMode) {
    if (!isTrainingModeEnabled(mode)) return;
    setModePool((curr) => {
      if (curr.includes(mode)) {
        const next = curr.filter((m) => m !== mode);
        return next.length > 0 ? next : curr;
      }
      return [...curr, mode];
    });
  }

  function savePreset() {
    const id = `preset_${Math.random().toString(36).slice(2, 9)}`;
    const preset: FreePracticePreset = {
      id,
      name: `Preset ${training.freePracticePresets.length + 1}`,
      modePool: sanitizeTrainingModePool(modePool),
      tonicMode,
      fixedTonic,
      intervalLevel,
      degreeLevel,
      harmonyLevel,
      timingLevel,
      phraseLevel,
      dictationInputMode,
      tonalMode,
      intervalPlaybackVariant: intervalVariant,
      harmonyPlaybackVariant: harmonyVariant,
      toggles,
    };
    const next = { ...training, freePracticePresets: [...training.freePracticePresets, preset] };
    setTraining(next);
    setTrainingSettings(next);
    trackEvent("authoring_saved", "/practice", { surface: "preset", modeCount: preset.modePool.length });
  }

  function resetPracticeSettings() {
    setTonicMode("random");
    setFixedTonic(settings.keyRoot);
    setTonicPool(undefined);
    setIntervalLevel(1);
    setDegreeLevel(1);
    setHarmonyLevel(1);
    setTimingLevel(1);
    setPhraseLevel(1);
    setDictationInputMode("multiple_choice");
    setTonalMode("major");
    setIntervalVariant("scale_context");
    setHarmonyVariant("block");
    persist(DEFAULT_TRAINING_TOGGLES);
  }

  function applyPreset(presetId: string) {
    if (presetId === QUICKPLAY_DEFAULT_PRESET_ID) {
      const quickplayPreset = getQuickplayPresetDefinition();
      applyPracticeSetup(quickplayPreset.settings);
      return;
    }
    const preset = training.freePracticePresets.find((p) => p.id === presetId);
    if (!preset) return;
    applyPracticeSetup({
      modePool: preset.modePool,
      tonicMode: preset.tonicMode,
      fixedTonic: preset.fixedTonic,
      tonicPool: undefined,
      intervalLevel: preset.intervalLevel,
      degreeLevel: preset.degreeLevel,
      harmonyLevel: preset.harmonyLevel,
      timingLevel: preset.timingLevel,
      phraseLevel: preset.phraseLevel,
      dictationInputMode: preset.dictationInputMode,
      tonalMode: preset.tonalMode,
      intervalPlaybackVariant: preset.intervalPlaybackVariant,
      harmonyPlaybackVariant: preset.harmonyPlaybackVariant,
      toggles: preset.toggles,
    });
  }

  return (
    <div className="page">
      {!sessionStarted ? (
        <>
          <div style={{ display: "grid", gap: "0.45rem" }}>
            <h2 style={{ margin: 0 }}>Practice</h2>
            <div className="subtle">Choose any mode subset, save presets, and toggle the training aids you want in play.</div>
          </div>

          <section className="panel panel--accent">
            <div className="panel-header">
              <div>
                <div className="kicker kicker--red">Session Builder</div>
                <h2 className="panel-title">Mode subset</h2>
              </div>
              <div className="panel-copy">Set up the run here, then the session opens on its own screen.</div>
            </div>

            <div className="chip-row">
              <button
                type="button"
                className={modePool.includes("scale_degree") ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                aria-pressed={modePool.includes("scale_degree")}
                onClick={() => toggleMode("scale_degree")}
              >
                Scale Degree
              </button>
              <button
                type="button"
                className={modePool.includes("functional_interval") ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                aria-pressed={modePool.includes("functional_interval")}
                onClick={() => toggleMode("functional_interval")}
              >
                Functional Interval
              </button>
            </div>

            <div className="control-grid">
              <label className="control-label">Tonic source
                <select value={tonicMode} onChange={(e) => setTonicMode(e.target.value as "random" | "fixed")}>
                  <option value="random">Randomize tonic</option>
                  <option value="fixed">Fixed tonic</option>
                </select>
              </label>
              <label className={fixedTonicDisabled ? "control-label control-label--disabled" : "control-label"}>Fixed tonic
                <select value={fixedTonic} disabled={fixedTonicDisabled} onChange={(e) => setFixedTonic(e.target.value as NoteName)}>
                  {NOTE_NAMES.map((note) => (
                    <option key={note} value={note}>{note}</option>
                  ))}
                </select>
              </label>
              <label className={functionalIntervalEnabled ? "control-label" : "control-label control-label--disabled"}>Interval level
                <select
                  value={intervalLevel}
                  disabled={!functionalIntervalEnabled}
                  onChange={(e) => setIntervalLevel(Number(e.target.value) as 1 | 2 | 3 | 4)}
                >
                  <option value={1}>Level 1 (2nds, 1-5)</option>
                  <option value={2}>Level 2 (+3rds)</option>
                  <option value={3}>Level 3 (+P4/P5)</option>
                  <option value={4}>Level 4 (+Octave)</option>
                </select>
              </label>
              <label className={scaleDegreeEnabled ? "control-label" : "control-label control-label--disabled"}>Degree level
                <select
                  value={degreeLevel}
                  disabled={!scaleDegreeEnabled}
                  onChange={(e) => setDegreeLevel(Number(e.target.value) as 1 | 2 | 3)}
                >
                  <option value={1}>1-5</option>
                  <option value={2}>+6/7</option>
                  <option value={3}>+b3/#4/b7</option>
                </select>
              </label>
              <label className="control-label">Tonal mode
                <select value={tonalMode} onChange={(e) => setTonalMode(e.target.value as typeof tonalMode)}>
                  <option value="major">Major</option>
                  <option value="natural_minor">Natural Minor</option>
                  <option value="harmonic_minor">Harmonic Minor</option>
                  <option value="melodic_minor">Melodic Minor</option>
                  <option value="modal">Modal</option>
                </select>
              </label>
            </div>

            <div className="control-grid">
              <label className={functionalIntervalEnabled ? "control-label" : "control-label control-label--disabled"}>Interval playback
                <select
                  value={intervalVariant}
                  disabled={!functionalIntervalEnabled}
                  onChange={(e) => setIntervalVariant(e.target.value as typeof intervalVariant)}
                >
                  <option value="scale_context">Scale-context</option>
                  <option value="sequential_pause">Sequential pause</option>
                  <option value="immediate_jump">Immediate jump</option>
                  <option value="harmonic_stack">Harmonic stack</option>
                </select>
              </label>
            </div>

            <div className="control-group">
              <div className="subtle">Session controls</div>
              <div className="checkbox-grid">
                {SESSION_TOGGLE_COPY.map((item) => renderToggle(item.key, item.title, item.description))}
              </div>
            </div>

            <div className="control-group">
              <div className="subtle">"Explain Why" Features</div>
              <div className="panel-copy">These options only affect the post-answer explanation view.</div>
              <div className="checkbox-grid">
                {EXPLAIN_WHY_TOGGLE_COPY.map((item) =>
                  renderToggle(
                    item.key,
                    item.title,
                    item.description,
                    (item.key === "showIntervalNames" || item.key === "showSemitoneCount") && !functionalIntervalEnabled
                  )
                )}
              </div>
            </div>

            <div className="button-row">
              <button onClick={() => start()}>Start free practice</button>
              <button onClick={() => start("due")}>Start due set</button>
              <button onClick={() => start("weak")}>Start focus set</button>
              <button onClick={() => startAuthoredRun()} disabled={authoredDrills.length === 0}>Start authored run</button>
              <button onClick={savePreset}>Save preset</button>
              <select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
                <option value="" disabled>Load preset</option>
                <option value={QUICKPLAY_DEFAULT_PRESET_ID}>Quickplay</option>
                {training.freePracticePresets.map((preset) => (
                  <option value={preset.id} key={preset.id}>{preset.name}</option>
                ))}
              </select>
              <button onClick={resetPracticeSettings}>Reset settings</button>
            </div>
            <div className="subtle">
              Live authored drills available: {authoredDrills.length}
            </div>
          </section>
        </>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <h2 style={{ margin: 0 }}>Free Practice</h2>
            <div className="subtle">Question view only. Use the setup screen again if you want to change the session configuration.</div>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => setShowSessionSettings(true)}>
              Session settings
            </button>
            <button
              type="button"
              onClick={() => {
                setQuestions([]);
                setIndex(0);
                setSelected(null);
                setPendingAdvance(null);
                setFocusOfferSource(null);
                setFocusQuestions(null);
                setFocusResumeIndex(null);
                setFocusIndex(0);
                setScore({ attempts: 0, correct: 0 });
                setMissStreak(0);
                setActiveReview(null);
                setShowSessionSettings(false);
                setTonicPool(undefined);
                sessionActiveRef.current = false;
                engine.clearDrone();
                engine.stopAll();
              }}
            >
              Back to setup
            </button>
          </div>
        </div>
      )}

      {focusOfferSource && !inFocusSet && (
        <div className="notice notice--alert">
          <div className="kicker kicker--red">Recovery Triggered</div>
          <div className="panel-title">Focused recovery required</div>
          <div className="panel-copy">Three misses in a row detected. Complete the targeted set (5 questions) to continue this session.</div>
          <div className="button-row">
            <button onClick={startFocusSet}>Start focused set</button>
          </div>
        </div>
      )}

      {current && (
        <section className="panel panel--blue question-card">
          <div className="kicker kicker--blue">Current Prompt</div>
          <div className="prompt-title">{current.prompt}</div>
          {toggles.allowPromptReplay && (
            <div className="button-row">
              <button type="button" onClick={replayCurrentPrompt} disabled={selected !== null || promptPlaybackActive}>
                {promptPlaybackActive ? "Playing..." : "Replay prompt"}
              </button>
            </div>
          )}
          <div className="meta-strip">
            <div className="meta-pill">Tonic <strong>{current.tonic}</strong></div>
            <div className="meta-pill">Session score <strong>{(score.correct / Math.max(1, score.attempts) * 100).toFixed(0)}%</strong></div>
            {activeReview && <div className="meta-pill">{activeReview === "due" ? "Due-focus run" : "Weak-focus run"}</div>}
            {!inFocusSet && <div className="meta-pill">Miss streak <strong>{missStreak}/3</strong></div>}
            {inFocusSet && <div className="meta-pill">Focus set <strong>{focusIndex + 1}/{focusQuestions?.length ?? 0}</strong> {focusSecondsLeft}s</div>}
          </div>
          {shouldShowAnswerSummary && (
            <div className={selected === current.correctAnswer ? "answer-line answer-line--correct" : "answer-line answer-line--wrong"}>
              Answer: {formatAnswerSummary(current)}
            </div>
          )}

          {awaitingReveal ? (
            <div className="notice">
              <div className="panel-copy">Sing the next pitch first.</div>
              <button onClick={revealHiddenPitch} style={{ width: 200 }}>
                I sang it, reveal
              </button>
            </div>
          ) : current.metadata.timing?.supportsTapPad ? (
            <div className="panel">
              <div className="button-row">
                <button onClick={beginTapCapture} disabled={selected !== null}>Start tap capture</button>
                <button onClick={registerTap} disabled={tapCaptureStartAt == null || selected !== null}>Tap pad</button>
                <button onClick={submitTapCapture} disabled={tapBeats.length === 0 || selected !== null}>Score taps</button>
              </div>
              <div className="subtle">
                Recorded taps: {tapBeats.length} | Grid: {current.metadata.timing.subdivision} ({current.metadata.timing.meter})
              </div>
              {current.metadata.timing.showErrorOverlay && tapOverlay.length > 0 && (
                <div className="chip-row">
                  {tapOverlay.map((line, idx) => (
                    <div key={`${current.id}_tap_${idx}`} className="chip">{line}</div>
                  ))}
                </div>
              )}
            </div>
          ) : current.metadata.phrase?.inputMode === "piano_grid" ? (
            <div className="panel">
              <div className="button-row">
                {["1", "2", "3", "4", "5", "6", "7", "b3", "#4", "b7"].map((degree) => (
                  <button key={degree} onClick={() => appendPhraseDegree(degree)} disabled={selected !== null}>{degree}</button>
                ))}
              </div>
              <div className="subtle">Draft: {phraseDraft.join(" ") || "none"}</div>
              <div className="button-row">
                <button onClick={clearPhraseDraft} disabled={selected !== null}>Clear</button>
                <button onClick={submitPhraseDraft} disabled={phraseDraft.length === 0 || selected !== null}>Submit phrase</button>
              </div>
            </div>
          ) : current.metadata.phrase?.inputMode === "staff_entry" ? (
            <div className="panel">
              <input value={phraseText} onChange={(e) => setPhraseText(e.target.value)} placeholder="Example: 1 2 3 4 | 5 4 3 2" />
              <button onClick={submitPhraseText} disabled={phraseText.trim().length === 0 || selected !== null} style={{ width: 160 }}>
                Submit phrase
              </button>
            </div>
          ) : (
            <>
              <div className="answer-grid">
                {current.answerChoices.map((choice) => (
                  <button key={choice} onClick={() => submit(choice)} disabled={selected !== null}>
                    {toggles.showAnswerNoteNames && (current.mode === "scale_degree" || current.mode === "functional_interval") ? (
                      (() => {
                        const formatted = formatChoiceWithNotes(current, choice);
                        return (
                          <span className="answer-choice-label">
                            <span>{formatted.label}</span>
                            {formatted.noteText && <span className="answer-choice-note"> {formatted.noteText}</span>}
                          </span>
                        );
                      })()
                    ) : (
                      choice
                    )}
                  </button>
                ))}
              </div>
              {(micAnswerActive || micAnswerUnsupported) && (
                <div className="panel" style={{ marginTop: 16 }}>
                  {micAnswerActive ? (
                    <>
                      <div className="panel-copy">
                        {current.mode === "functional_interval"
                          ? "After revealing the prompt, sing both notes of the interval in order. The mic can submit the matching movement automatically."
                          : "After revealing the prompt, sing the answer note and hold it steady. The mic can submit the matching degree automatically."}
                      </div>
                      <div className="subtle">
                        Drone playback is paused while mic answer input is on, and mic listening pauses whenever the app is playing audio.
                      </div>
                      <div className="subtle">
                        Choices {micAnswerTargets.map((target) => `${target.answer} (${target.label})`).join(" | ")}
                      </div>
                      <div className="subtle">
                        Detected {practiceMicFrame.noteLabel ?? "none"}
                        {micCandidateTarget ? ` | Matching ${micCandidateTarget.answer} (${micCandidateTarget.label})` : ""}
                        {micCentsOff != null ? ` | ${Math.round(micCentsOff)} cents` : ""}
                        {practiceMicReady ? ` | Hold ${Math.min(practiceMicHoldMs, voiceSettings.holdDurationMs)}/${voiceSettings.holdDurationMs} ms` : ""}
                        {practiceMicError ? ` | ${practiceMicError}` : ""}
                      </div>
                      <div className="button-row">
                        <button onClick={enablePracticeMic} disabled={practiceMicReady} style={{ width: 180 }}>
                          Enable mic
                        </button>
                        <button
                          onClick={() => {
                            if (practiceMicCandidateAnswer) submit(practiceMicCandidateAnswer);
                          }}
                          disabled={!practiceMicCandidateAnswer}
                          style={{ width: 180 }}
                        >
                          Submit detected note
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="subtle">Mic answer input is not available for this prompt, so standard answer controls stay active.</div>
                  )}
                </div>
              )}
            </>
          )}

          {toggles.allowKeyboardInput && !current.metadata.phrase && !current.metadata.timing?.supportsTapPad && (
            <div className="compact-row">
              <input
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                placeholder="Type exact answer label"
              />
              <button onClick={() => submit(typedAnswer)} disabled={typedAnswer.length === 0 || selected !== null}>
                Submit typed
              </button>
            </div>
          )}

          {selected && pendingAdvance && (
            <div className="button-row">
              <button style={{ width: 190 }} onClick={continueAfterFeedback}>
                Continue
              </button>
              {toggles.showExplainWhy && (
                <button type="button" style={{ width: 210 }} onClick={() => setShowMore(true)}>
                  Explain why
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {selected && current && showMore && toggles.showExplainWhy && (
        <div className="mode-overlay" onClick={() => setShowMore(false)} role="presentation">
          <div
            className="mode-overlay__panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-feedback-title"
          >
            <div id="practice-feedback-title" className="panel-title">{current.feedback.title}</div>
            {current.feedback.subtitle && <div className="panel-copy">{current.feedback.subtitle}</div>}
            {current.mode === "functional_interval" && toggles.showIntervalNames && current.metadata.intervalName && (
              <div className="teaching-line">Interval: {current.metadata.intervalName}</div>
            )}
            {current.mode === "functional_interval" && toggles.showSemitoneCount && current.metadata.semitones != null && (
              <div className="teaching-line">Semitones: {current.metadata.semitones}</div>
            )}
            {toggles.showSolfege && current.metadata.solfege && <div className="teaching-line">Solfege: {current.metadata.solfege}</div>}
            {current.mode === "functional_harmony" && toggles.showChordTones && current.metadata.chordTones && (
              <div className="teaching-line">Chord tones (MIDI): {current.metadata.chordTones.join(", ")}</div>
            )}
            {current.mode === "functional_harmony" && functionUnlocked && current.metadata.functionLabel && (
              <div className="teaching-line">Function: {current.metadata.functionLabel}</div>
            )}
            {current.mode === "timing_grid" && current.metadata.timing && (
              <div className="teaching-line">
                Meter {current.metadata.timing.meter} | Subdivision {current.metadata.timing.subdivision}
              </div>
            )}
            {current.mode === "phrase_recall" && current.metadata.phrase && (
              <div className="teaching-line">
                Tag {current.metadata.phrase.tag} | Bars {current.metadata.phrase.bars} | Correct {current.correctAnswer}
              </div>
            )}
            <div className="panel-copy">{current.feedback.explanation}</div>

            {current.teaching.lines.map((line, i) => (
              <div key={`${current.id}_line_${i}`} className="teaching-line">{line}</div>
            ))}
            {current.teaching.tendencyHint && (
              <div className="teaching-line">Hint: {current.teaching.tendencyHint}</div>
            )}
            {current.teaching.more && <div className="teaching-line">{current.teaching.more}</div>}

            {current.compareAudio && (
              <>
                <button
                  style={{ width: 230 }}
                  onClick={() => {
                    playWithMicSuppressed(current.compareAudio!.playbackPlan);
                  }}
                >
                  {current.compareAudio.label}
                </button>
                <div style={{ opacity: 0.74, fontSize: 12 }}>{current.compareAudio.description}</div>
              </>
            )}
            {current.metadata.phrase?.measurePlaybackPlans && current.metadata.phrase.measurePlaybackPlans.length > 0 && (
              <div className="button-row">
                {current.metadata.phrase.measurePlaybackPlans.map((plan, idx) => (
                  <button
                    key={`${current.id}_measure_${idx}`}
                    onClick={() => {
                      playWithMicSuppressed(plan);
                    }}
                  >
                    Play bar {idx + 1}
                  </button>
                ))}
              </div>
            )}

            {settings.visualsEnabled && toggles.showScaleMap && (
              <div className="control-group">
                <div className="subtle">Degree map</div>
                <div className="chip-row">
                  {DEGREE_TICKS.map((degree) => {
                    const isActive = current.metadata.visualCue?.activeDegree === degree;
                    const isMoveA = current.metadata.visualCue?.movement?.from === degree;
                    const isMoveB = current.metadata.visualCue?.movement?.to === degree;
                    return (
                      <div
                        key={`${current.id}_d_${degree}`}
                        style={{
                          minWidth: 36,
                          textAlign: "center",
                          padding: "6px 8px",
                          borderRadius: 999,
                          border: "2px solid var(--ink)",
                          background: isActive || isMoveA || isMoveB ? "var(--accent-yellow)" : "rgba(255,252,247,0.92)",
                          fontWeight: isActive || isMoveA || isMoveB ? 700 : 500,
                        }}
                      >
                        {degree}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {settings.visualsEnabled && toggles.showPianoStrip && current.metadata.visualCue?.timelineMidis && (
              <div className="control-group">
                <div className="subtle">Keyboard</div>
                <PianoRoll midis={current.metadata.visualCue.timelineMidis} tonicMidi={current.tonicMidi} />
              </div>
            )}

            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowMore(false)}>
              Close explanation
            </button>
          </div>
        </div>
      )}

      {sessionStarted && showSessionSettings && (
        <div className="mode-overlay" onClick={() => setShowSessionSettings(false)} role="presentation">
          <div
            className="mode-overlay__panel mode-overlay__panel--wide mode-overlay__panel--compact"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-session-settings-title"
          >
            <div id="practice-session-settings-title" className="panel-title">Session settings</div>

            <div className="chip-row">
              <button
                type="button"
                className={modePool.includes("scale_degree") ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                aria-pressed={modePool.includes("scale_degree")}
                onClick={() => updateSubstantialSetting(() => toggleMode("scale_degree"))}
              >
                Scale Degree
              </button>
              <button
                type="button"
                className={modePool.includes("functional_interval") ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                aria-pressed={modePool.includes("functional_interval")}
                onClick={() => updateSubstantialSetting(() => toggleMode("functional_interval"))}
              >
                Functional Interval
              </button>
            </div>

            <div className="control-grid">
              <label className="control-label">Tonic source
                <select value={tonicMode} onChange={(e) => updateSubstantialSetting(() => setTonicMode(e.target.value as "random" | "fixed"))}>
                  <option value="random">Randomize tonic</option>
                  <option value="fixed">Fixed tonic</option>
                </select>
              </label>
              <label className={fixedTonicDisabled ? "control-label control-label--disabled" : "control-label"}>Fixed tonic
                <select
                  value={fixedTonic}
                  disabled={fixedTonicDisabled}
                  onChange={(e) => updateSubstantialSetting(() => setFixedTonic(e.target.value as NoteName))}
                >
                  {NOTE_NAMES.map((note) => (
                    <option key={note} value={note}>{note}</option>
                  ))}
                </select>
              </label>
              <label className={functionalIntervalEnabled ? "control-label" : "control-label control-label--disabled"}>Interval level
                <select
                  value={intervalLevel}
                  disabled={!functionalIntervalEnabled}
                  onChange={(e) => updateSubstantialSetting(() => setIntervalLevel(Number(e.target.value) as 1 | 2 | 3 | 4))}
                >
                  <option value={1}>Level 1</option>
                  <option value={2}>Level 2</option>
                  <option value={3}>Level 3</option>
                  <option value={4}>Level 4</option>
                </select>
              </label>
              <label className={scaleDegreeEnabled ? "control-label" : "control-label control-label--disabled"}>Degree level
                <select
                  value={degreeLevel}
                  disabled={!scaleDegreeEnabled}
                  onChange={(e) => updateSubstantialSetting(() => setDegreeLevel(Number(e.target.value) as 1 | 2 | 3))}
                >
                  <option value={1}>1-5</option>
                  <option value={2}>+6/7</option>
                  <option value={3}>+b3/#4/b7</option>
                </select>
              </label>
              <label className="control-label">Tonal mode
                <select value={tonalMode} onChange={(e) => updateSubstantialSetting(() => setTonalMode(e.target.value as typeof tonalMode))}>
                  <option value="major">Major</option>
                  <option value="natural_minor">Natural minor</option>
                  <option value="harmonic_minor">Harmonic minor</option>
                  <option value="melodic_minor">Melodic minor</option>
                  <option value="modal">Modal</option>
                </select>
              </label>
              <label className={functionalIntervalEnabled ? "control-label" : "control-label control-label--disabled"}>Interval playback
                <select
                  value={intervalVariant}
                  disabled={!functionalIntervalEnabled}
                  onChange={(e) => updateSubstantialSetting(() => setIntervalVariant(e.target.value as typeof intervalVariant))}
                >
                  <option value="scale_context">Scale-context</option>
                  <option value="sequential_pause">Sequential pause</option>
                  <option value="immediate_jump">Immediate jump</option>
                  <option value="harmonic_stack">Harmonic stack</option>
                </select>
              </label>
            </div>

            <div className="control-group">
              <div className="subtle">Session controls</div>
              <div className="checkbox-grid checkbox-grid--compact">
                {SESSION_TOGGLE_COPY.map((item) =>
                  renderToggle(
                    item.key,
                    item.title,
                    item.description,
                    false,
                    (nextValue) => updateSessionToggle(item.key, nextValue, false),
                    true
                  )
                )}
              </div>
            </div>

            <div className="control-group">
              <div className="subtle">"Explain Why" Features</div>
              <div className="checkbox-grid checkbox-grid--compact">
                {EXPLAIN_WHY_TOGGLE_COPY.map((item) =>
                  renderToggle(
                    item.key,
                    item.title,
                    item.description,
                    (item.key === "showIntervalNames" || item.key === "showSemitoneCount") && !functionalIntervalEnabled,
                    (nextValue) => updateSessionToggle(item.key, nextValue, true),
                    true
                  )
                )}
              </div>
            </div>

            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowSessionSettings(false)}>
              Close settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
