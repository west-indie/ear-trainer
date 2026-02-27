import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NOTE_NAMES, type NoteName } from "../audio/music";
import { engine } from "../audio/engine";
import { getEnabledTrainingModes, sanitizeTrainingModePool } from "../config/featureFlags";
import { getProgress, getWeakestAreas } from "../store/progressStore";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import {
  DEFAULT_TRAINING_TOGGLES,
  getTrainingSettings,
  setTrainingSettings,
  type FreePracticePreset,
} from "../store/trainingStore";
import { generateSessionQuestions, logTrainingAttempt } from "../training/session";
import { randomNoteName } from "../training/theory";
import type {
  DictationInputMode,
  GeneratorConfig,
  HarmonyPlaybackVariant,
  HarmonyLevel,
  IntervalLevel,
  IntervalPlaybackVariant,
  PhraseLevel,
  TimingLevel,
  TonalMode,
  TrainingMode,
  TrainingQuestion,
  TrainingUserToggles,
} from "../training/types";

type WizardStep = "assessment" | "results" | "topics" | "settings" | "saved";
type AssessmentConfigOverrides = {
  intervalLevel?: IntervalLevel;
  degreeLevel?: 1 | 2 | 3;
  harmonyLevel?: HarmonyLevel;
  timingLevel?: TimingLevel;
  phraseLevel?: PhraseLevel;
  tonalMode?: TonalMode;
  intervalPlaybackVariant?: IntervalPlaybackVariant;
  harmonyPlaybackVariant?: HarmonyPlaybackVariant;
  dictationInputMode?: DictationInputMode;
};
type AssessmentStage = {
  mode: TrainingMode;
  level: number;
  shortLabel: string;
  title: string;
  description: string;
  overrides: AssessmentConfigOverrides;
};
type StageStat = { attempts: number; correct: number };
type PlacementState = {
  mode: TrainingMode;
  startStageIndex: number;
  currentStageIndex: number;
  recommendedStageIndex: number;
  complete: boolean;
  totalAttempts: number;
  totalCorrect: number;
  stageStats: StageStat[];
};
type AssessmentAttempt = {
  question: TrainingQuestion;
  mode: TrainingMode;
  stageIndex: number;
  stageLabel: string;
  selected: string;
  correct: boolean;
  responseMs: number;
};
type AssessmentPrompt = { question: TrainingQuestion; mode: TrainingMode; stageIndex: number; ordinal: number };
type ModeSummary = {
  mode: TrainingMode;
  attempts: number;
  correct: number;
  accuracy: number;
  recommendedStage: AssessmentStage;
  stageBreakdown: Array<{ stage: AssessmentStage; attempts: number; correct: number; accuracy: number | null }>;
  startedHigher: boolean;
};

const PASSING_ACCURACY = 0.8;

const MODE_COPY: Record<TrainingMode, { title: string; description: string }> = {
  scale_degree: { title: "Scale Degree", description: "Hear pitches against the tonic and name the exact degree." },
  functional_interval: { title: "Functional Interval", description: "Track movement between degrees and hear where lines want to resolve." },
  functional_harmony: { title: "Functional Harmony", description: "Identify chord quality and harmonic pull inside the key." },
  timing_grid: { title: "Timing Grid", description: "Recognize meter, subdivision, and rhythmic placement." },
  phrase_recall: { title: "Phrase Recall", description: "Retain and identify short tonal patterns over multiple beats." },
};

const SESSION_TOGGLE_COPY: Array<{ key: keyof TrainingUserToggles; title: string; description: string }> = [
  { key: "showAnswerNoteNames", title: "Answer note names", description: "Show note names next to scale-degree and interval answers." },
  { key: "allowPromptReplay", title: "Replay prompt", description: "Show a replay button so the current prompt can be heard more than once." },
  { key: "droneEnabled", title: "Drone", description: "Keep a tonic drone under each prompt." },
  { key: "enforceSinging", title: "Sing before reveal", description: "Hold back the last pitch until you sing it and reveal it manually." },
  { key: "requireMicForSinging", title: "Mic answer input", description: "Use the microphone to register sung pitches as answers on supported prompts." },
  { key: "allowKeyboardInput", title: "Keyboard input", description: "Allow typed answers when a topic supports it." },
  { key: "showExplainWhy", title: "Explain why", description: "Keep the post-answer explanation panel available." },
  { key: "showScaleMap", title: "Degree map", description: "Show the highlighted scale-degree strip in explanations." },
  { key: "showPianoStrip", title: "Keyboard excerpt", description: "Show the keyboard strip in explanations when available." },
];

function assessmentStagesForMode(mode: TrainingMode): AssessmentStage[] {
  if (mode === "scale_degree") {
    return [
      { mode, level: 1, shortLabel: "L1", title: "Core tonic map", description: "Stable 1-5 scale-degree hearing around tonic.", overrides: { degreeLevel: 1, tonalMode: "major" } },
      { mode, level: 2, shortLabel: "L2", title: "Upper extensions", description: "Adds 6 and 7 so the user has to hear true scale pull.", overrides: { degreeLevel: 2, tonalMode: "major" } },
      { mode, level: 3, shortLabel: "L3", title: "Chromatic colors", description: "Tests altered colors and less stable scale-degree identities.", overrides: { degreeLevel: 3, tonalMode: "major" } },
    ];
  }
  if (mode === "functional_interval") {
    return [
      { mode, level: 1, shortLabel: "L1", title: "Step motion", description: "Adjacent scale-degree movement in context.", overrides: { intervalLevel: 1, intervalPlaybackVariant: "scale_context", tonalMode: "major" } },
      { mode, level: 2, shortLabel: "L2", title: "Skips", description: "Adds 3rds and wider movement with a pause to compare endpoints.", overrides: { intervalLevel: 2, intervalPlaybackVariant: "sequential_pause", tonalMode: "major" } },
      { mode, level: 3, shortLabel: "L3", title: "Wide functional leaps", description: "Adds 4ths and 5ths with less stepwise support.", overrides: { intervalLevel: 3, intervalPlaybackVariant: "immediate_jump", tonalMode: "major" } },
      { mode, level: 4, shortLabel: "L4", title: "Compressed pressure", description: "Adds the hardest movement set with harmonic-stack playback.", overrides: { intervalLevel: 4, intervalPlaybackVariant: "harmonic_stack", tonalMode: "major" } },
    ];
  }
  if (mode === "functional_harmony") {
    return [
      { mode, level: 1, shortLabel: "L1", title: "Quality anchors", description: "Quality and cadence hearing with simpler harmonic motion.", overrides: { harmonyLevel: 1, harmonyPlaybackVariant: "block", tonalMode: "major" } },
      { mode, level: 2, shortLabel: "L2", title: "Function paths", description: "Roman paths, cadence type, and changed-chord recognition.", overrides: { harmonyLevel: 2, harmonyPlaybackVariant: "mixed", tonalMode: "major" } },
    ];
  }
  if (mode === "timing_grid") {
    return [
      { mode, level: 1, shortLabel: "L1", title: "Pulse lock", description: "Meter and basic pulse recognition.", overrides: { timingLevel: 1 } },
      { mode, level: 2, shortLabel: "L2", title: "Subdivision control", description: "Separates straight subdivisions and basic syncopation.", overrides: { timingLevel: 2 } },
      { mode, level: 3, shortLabel: "L3", title: "Rhythmic detail", description: "More complex rhythmic detail and syncopation pressure.", overrides: { timingLevel: 3 } },
    ];
  }
  return [
    { mode, level: 1, shortLabel: "L1", title: "Short contour", description: "Small phrase shapes and short memory spans.", overrides: { phraseLevel: 1, dictationInputMode: "multiple_choice" } },
    { mode, level: 2, shortLabel: "L2", title: "Phrase memory", description: "Longer recall with clearer internal grouping.", overrides: { phraseLevel: 2, dictationInputMode: "multiple_choice" } },
    { mode, level: 3, shortLabel: "L3", title: "Dense recall", description: "Harder phrase retention and recognition.", overrides: { phraseLevel: 3, dictationInputMode: "multiple_choice" } },
  ];
}

function buildConfig(modePool: TrainingMode[], overrides: AssessmentConfigOverrides = {}): GeneratorConfig {
  return {
    sessionType: "free",
    modePool,
    intervalLevel: overrides.intervalLevel ?? 1,
    degreeLevel: overrides.degreeLevel ?? 1,
    harmonyLevel: overrides.harmonyLevel ?? 1,
    timingLevel: overrides.timingLevel ?? 1,
    phraseLevel: overrides.phraseLevel ?? 1,
    dictationInputMode: overrides.dictationInputMode ?? "multiple_choice",
    tonalMode: overrides.tonalMode ?? "major",
    intervalPlaybackVariant: overrides.intervalPlaybackVariant ?? "scale_context",
    harmonyPlaybackVariant: overrides.harmonyPlaybackVariant ?? "block",
    randomTonicEvery: 2,
    singingQuota: 0,
    predictiveResolutionChance: 0.2,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatAccuracy(correct: number, attempts: number): string {
  if (attempts === 0) return "Not tested";
  return `${correct}/${attempts} (${formatPercent(correct / attempts)})`;
}

function modeAttempts(mode: TrainingMode) {
  const progress = getProgress();
  const buckets = Object.values(progress.adaptive).filter((bucket) => bucket.mode === mode);
  const attempts = buckets.reduce((sum, bucket) => sum + bucket.attempts, 0);
  const weightedMastery = attempts > 0
    ? buckets.reduce((sum, bucket) => sum + bucket.mastery * bucket.attempts, 0) / attempts
    : 0;
  return { attempts, weightedMastery };
}

function bootstrapStageIndex(mode: TrainingMode): number {
  const stages = assessmentStagesForMode(mode);
  const { attempts, weightedMastery } = modeAttempts(mode);
  if (attempts < 6) return 0;
  const maxUnlockedByVolume = attempts >= 24 ? stages.length - 1 : attempts >= 14 ? Math.min(stages.length - 1, 2) : Math.min(stages.length - 1, 1);
  const scaled = Math.round(weightedMastery * maxUnlockedByVolume);
  return Math.max(0, Math.min(maxUnlockedByVolume, scaled));
}

function createInitialPlacements(modes: TrainingMode[]): Record<TrainingMode, PlacementState> {
  return Object.fromEntries(modes.map((mode) => {
    const startStageIndex = bootstrapStageIndex(mode);
    return [mode, {
      mode,
      startStageIndex,
      currentStageIndex: startStageIndex,
      recommendedStageIndex: Math.max(0, startStageIndex - 1),
      complete: false,
      totalAttempts: 0,
      totalCorrect: 0,
      stageStats: assessmentStagesForMode(mode).map(() => ({ attempts: 0, correct: 0 })),
    }];
  })) as Record<TrainingMode, PlacementState>;
}

function isAssessmentQuestionCompatible(question: TrainingQuestion): boolean {
  if (question.metadata.timing?.supportsTapPad) return false;
  if (question.metadata.phrase && question.metadata.phrase.inputMode !== "multiple_choice") return false;
  return question.answerChoices.length > 0 && !question.answerChoices.includes("tap_capture");
}

function generateAssessmentQuestion(mode: TrainingMode, stage: AssessmentStage, octave: number): TrainingQuestion {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const question = generateSessionQuestions({
      config: buildConfig([mode], stage.overrides),
      questionCount: 1,
      startTonic: randomNoteName(),
      tonicOctave: octave,
    })[0];
    if (question && isAssessmentQuestionCompatible(question)) return question;
  }
  return generateSessionQuestions({
    config: buildConfig([mode], { ...stage.overrides, dictationInputMode: "multiple_choice", timingLevel: 1, phraseLevel: 1 }),
    questionCount: 1,
    startTonic: randomNoteName(),
    tonicOctave: octave,
  })[0];
}

function buildPrompt(mode: TrainingMode, stageIndex: number, octave: number, ordinal: number): AssessmentPrompt {
  return { question: generateAssessmentQuestion(mode, assessmentStagesForMode(mode)[stageIndex], octave), mode, stageIndex, ordinal };
}

function minimumQuestionsLeft(placements: Record<TrainingMode, PlacementState>): number {
  return Object.values(placements).reduce((sum, placement) => {
    if (placement.complete) return sum;
    const currentStats = placement.stageStats[placement.currentStageIndex];
    const currentStageNeeds = currentStats.attempts < 2 ? 2 - currentStats.attempts : currentStats.correct === 1 && currentStats.attempts === 2 ? 1 : 0;
    return sum + currentStageNeeds + Math.max(0, assessmentStagesForMode(placement.mode).length - placement.currentStageIndex - 1) * 2;
  }, 0);
}

function chooseNextMode(placements: Record<TrainingMode, PlacementState>, modeOrder: TrainingMode[], currentMode: TrainingMode, stayOnCurrent: boolean) {
  if (stayOnCurrent && !placements[currentMode].complete) return currentMode;
  const startIndex = modeOrder.indexOf(currentMode);
  for (let offset = 1; offset <= modeOrder.length; offset += 1) {
    const mode = modeOrder[(startIndex + offset) % modeOrder.length];
    if (!placements[mode].complete) return mode;
  }
  return null;
}

function createModeSummaries(modes: TrainingMode[], placements: Record<TrainingMode, PlacementState>): ModeSummary[] {
  return modes.map((mode) => {
    const placement = placements[mode];
    const stages = assessmentStagesForMode(mode);
    return {
      mode,
      attempts: placement.totalAttempts,
      correct: placement.totalCorrect,
      accuracy: placement.totalAttempts > 0 ? placement.totalCorrect / placement.totalAttempts : 0,
      recommendedStage: stages[placement.recommendedStageIndex],
      stageBreakdown: stages.map((stage, index) => {
        const stat = placement.stageStats[index];
        return { stage, attempts: stat.attempts, correct: stat.correct, accuracy: stat.attempts > 0 ? stat.correct / stat.attempts : null };
      }),
      startedHigher: placement.startStageIndex > 0,
    };
  });
}

export default function CustomPath() {
  const navigate = useNavigate();
  const availableModes = useMemo(() => sanitizeTrainingModePool(getEnabledTrainingModes()), []);
  const [settings, setSettings] = useState(getSettings());
  const [step, setStep] = useState<WizardStep>("assessment");
  const [placements, setPlacements] = useState<Record<TrainingMode, PlacementState>>(() => createInitialPlacements(availableModes));
  const [currentPrompt, setCurrentPrompt] = useState<AssessmentPrompt | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [assessmentAttempts, setAssessmentAttempts] = useState<AssessmentAttempt[]>([]);
  const [assessmentRunning, setAssessmentRunning] = useState(false);
  const [selectedModes, setSelectedModes] = useState<TrainingMode[]>([]);
  const [presetName, setPresetName] = useState(`Custom Path ${getTrainingSettings().freePracticePresets.length + 1}`);
  const [tonicMode, setTonicMode] = useState<"random" | "fixed">("random");
  const [fixedTonic, setFixedTonic] = useState<NoteName>(getSettings().keyRoot);
  const [degreeLevel, setDegreeLevel] = useState<1 | 2 | 3>(1);
  const [intervalLevel, setIntervalLevel] = useState<1 | 2 | 3 | 4>(1);
  const [harmonyLevel, setHarmonyLevel] = useState<1 | 2>(1);
  const [timingLevel, setTimingLevel] = useState<1 | 2 | 3>(1);
  const [phraseLevel, setPhraseLevel] = useState<1 | 2 | 3>(1);
  const [dictationInputMode, setDictationInputMode] = useState<DictationInputMode>("multiple_choice");
  const [tonalMode, setTonalMode] = useState<TonalMode>("major");
  const [intervalVariant, setIntervalVariant] = useState<IntervalPlaybackVariant>("scale_context");
  const [harmonyVariant, setHarmonyVariant] = useState<HarmonyPlaybackVariant>("block");
  const [toggles, setToggles] = useState<TrainingUserToggles>({ ...DEFAULT_TRAINING_TOGGLES, showExplainWhy: true });
  const [savedPresetId, setSavedPresetId] = useState<string | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);
  const currentQuestion = currentPrompt?.question ?? null;
  const currentStage = currentPrompt ? assessmentStagesForMode(currentPrompt.mode)[currentPrompt.stageIndex] : null;
  const completedModeCount = useMemo(() => Object.values(placements).filter((placement) => placement.complete).length, [placements]);
  const estimatedRemaining = useMemo(() => minimumQuestionsLeft(placements), [placements]);
  const modeSummaries = useMemo(() => createModeSummaries(availableModes, placements), [availableModes, placements]);
  const weakestAreas = useMemo(() => getWeakestAreas({ limit: 8, modePool: availableModes }), [assessmentAttempts.length, availableModes]);

  const recommendedModes = useMemo(() => {
    const recommended = new Set<TrainingMode>();
    for (const summary of modeSummaries) {
      const hasWeakArea = weakestAreas.some((area) => area.mode === summary.mode);
      const notAtTopLevel = summary.recommendedStage.level < assessmentStagesForMode(summary.mode).at(-1)!.level;
      if (summary.accuracy < PASSING_ACCURACY || hasWeakArea || notAtTopLevel) recommended.add(summary.mode);
    }
    if (recommended.size === 0 && modeSummaries.length > 0) {
      const weakestMode = [...modeSummaries].sort((a, b) => a.accuracy - b.accuracy)[0];
      if (weakestMode) recommended.add(weakestMode.mode);
    }
    return availableModes.filter((mode) => recommended.has(mode));
  }, [availableModes, modeSummaries, weakestAreas]);

  const recommendedSet = useMemo(() => new Set(recommendedModes), [recommendedModes]);
  const weakAreasByMode = useMemo(() => {
    const next = new Map<TrainingMode, string[]>();
    for (const area of weakestAreas) {
      const labels = next.get(area.mode) ?? [];
      labels.push(`${area.label} (${formatPercent(area.mastery)})`);
      next.set(area.mode, labels);
    }
    return next;
  }, [weakestAreas]);

  useEffect(() => {
    if (!assessmentRunning || !currentQuestion) return;
    startedAtRef.current = performance.now();
    void engine.play(currentQuestion.playbackPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }, [assessmentRunning, currentQuestion, settings.masterGain, settings.tempoBpm, settings.timbre]);

  useEffect(() => {
    if (step !== "assessment" || assessmentRunning || currentPrompt != null) return;
    const initialPlacements = createInitialPlacements(availableModes);
    const firstMode = availableModes[0];
    if (!firstMode) return;
    setPlacements(initialPlacements);
    setSelectedAnswer(null);
    setAssessmentAttempts([]);
    setSavedPresetId(null);
    setAssessmentRunning(true);
    setCurrentPrompt(buildPrompt(firstMode, initialPlacements[firstMode].currentStageIndex, settings.octave, 1));
  }, [assessmentRunning, availableModes, currentPrompt, settings.octave, step]);

  useEffect(() => {
    if (step !== "topics") return;
    setSelectedModes((current) => (current.length > 0 ? current : recommendedModes.length > 0 ? recommendedModes : [availableModes[0]]));
  }, [availableModes, recommendedModes, step]);

  useEffect(() => () => {
    engine.clearDrone();
    engine.stopAll();
  }, []);

  function applyPlacementDefaults(nextPlacements: Record<TrainingMode, PlacementState>) {
    if (nextPlacements.scale_degree) {
      const stage = assessmentStagesForMode("scale_degree")[nextPlacements.scale_degree.recommendedStageIndex];
      setDegreeLevel(stage.overrides.degreeLevel ?? 1);
    }
    if (nextPlacements.functional_interval) {
      const stage = assessmentStagesForMode("functional_interval")[nextPlacements.functional_interval.recommendedStageIndex];
      setIntervalLevel(stage.overrides.intervalLevel ?? 1);
      setIntervalVariant(stage.overrides.intervalPlaybackVariant ?? "scale_context");
    }
    if (nextPlacements.functional_harmony) {
      const stage = assessmentStagesForMode("functional_harmony")[nextPlacements.functional_harmony.recommendedStageIndex];
      setHarmonyLevel(stage.overrides.harmonyLevel ?? 1);
      setHarmonyVariant(stage.overrides.harmonyPlaybackVariant ?? "block");
    }
    if (nextPlacements.timing_grid) {
      const stage = assessmentStagesForMode("timing_grid")[nextPlacements.timing_grid.recommendedStageIndex];
      setTimingLevel(stage.overrides.timingLevel ?? 1);
    }
    if (nextPlacements.phrase_recall) {
      const stage = assessmentStagesForMode("phrase_recall")[nextPlacements.phrase_recall.recommendedStageIndex];
      setPhraseLevel(stage.overrides.phraseLevel ?? 1);
      setDictationInputMode(stage.overrides.dictationInputMode ?? "multiple_choice");
    }
  }

  function replayPrompt() {
    if (!currentQuestion) return;
    void engine.play(currentQuestion.playbackPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }

  function submitAssessmentAnswer(choice: string) {
    if (!currentPrompt || !currentQuestion || selectedAnswer !== null) return;
    const responseMs = Math.max(1, performance.now() - startedAtRef.current);
    const correct = choice === currentQuestion.correctAnswer;
    const stage = assessmentStagesForMode(currentPrompt.mode)[currentPrompt.stageIndex];
    setSelectedAnswer(choice);
    logTrainingAttempt({ question: currentQuestion, correct, responseMs });
    setAssessmentAttempts((current) => [...current, {
      question: currentQuestion,
      mode: currentPrompt.mode,
      stageIndex: currentPrompt.stageIndex,
      stageLabel: stage.shortLabel,
      selected: choice,
      correct,
      responseMs,
    }]);
  }

  function continueAssessment() {
    if (!currentPrompt || !currentQuestion || selectedAnswer == null) return;
    const correct = selectedAnswer === currentQuestion.correctAnswer;
    const nextPlacements = { ...placements };
    const currentPlacement = nextPlacements[currentPrompt.mode];
    const stageStats = [...currentPlacement.stageStats];
    const stat = { ...stageStats[currentPrompt.stageIndex] };
    stat.attempts += 1;
    stat.correct += correct ? 1 : 0;
    stageStats[currentPrompt.stageIndex] = stat;

    let complete = currentPlacement.complete;
    let recommendedStageIndex = currentPlacement.recommendedStageIndex;
    let currentStageIndex = currentPlacement.currentStageIndex;
    let stayOnCurrentStage = false;
    const stages = assessmentStagesForMode(currentPrompt.mode);

    if (stat.attempts >= 2) {
      const passedStage = stat.correct >= 2;
      const failedStage = stat.correct === 0 || (stat.attempts === 3 && stat.correct < 2);
      if (passedStage) {
        recommendedStageIndex = Math.max(recommendedStageIndex, currentPrompt.stageIndex);
        if (currentPrompt.stageIndex + 1 < stages.length) currentStageIndex = currentPrompt.stageIndex + 1;
        else {
          complete = true;
          currentStageIndex = currentPrompt.stageIndex;
        }
      } else if (failedStage) {
        recommendedStageIndex = Math.max(0, currentPrompt.stageIndex - 1);
        currentStageIndex = currentPrompt.stageIndex;
        complete = true;
      } else stayOnCurrentStage = true;
    } else stayOnCurrentStage = true;

    nextPlacements[currentPrompt.mode] = {
      ...currentPlacement,
      currentStageIndex,
      recommendedStageIndex,
      complete,
      totalAttempts: currentPlacement.totalAttempts + 1,
      totalCorrect: currentPlacement.totalCorrect + (correct ? 1 : 0),
      stageStats,
    };

    setPlacements(nextPlacements);
    setSelectedAnswer(null);

    if (availableModes.every((mode) => nextPlacements[mode].complete)) {
      setAssessmentRunning(false);
      setCurrentPrompt(null);
      applyPlacementDefaults(nextPlacements);
      setStep("results");
      return;
    }

    const nextMode = chooseNextMode(nextPlacements, availableModes, currentPrompt.mode, stayOnCurrentStage);
    if (!nextMode) {
      setAssessmentRunning(false);
      setCurrentPrompt(null);
      applyPlacementDefaults(nextPlacements);
      setStep("results");
      return;
    }

    setCurrentPrompt(buildPrompt(nextMode, nextPlacements[nextMode].currentStageIndex, settings.octave, assessmentAttempts.length + 2));
  }

  function toggleSelectedMode(mode: TrainingMode) {
    setSelectedModes((current) => {
      if (current.includes(mode)) return current.length === 1 ? current : current.filter((item) => item !== mode);
      return [...current, mode];
    });
  }

  function setToggle(key: keyof TrainingUserToggles, value: boolean) {
    setToggles((current) => {
      if (key === "requireMicForSinging") {
        return {
          ...current,
          requireMicForSinging: value,
          enforceSinging: value ? true : current.enforceSinging,
        };
      }

      if (key === "enforceSinging" && !value) {
        return {
          ...current,
          enforceSinging: false,
          requireMicForSinging: false,
        };
      }

      return { ...current, [key]: value };
    });
  }

  function savePreset() {
    const training = getTrainingSettings();
    const id = `preset_${Math.random().toString(36).slice(2, 9)}`;
    const preset: FreePracticePreset = {
      id,
      name: presetName.trim() || `Custom Path ${training.freePracticePresets.length + 1}`,
      modePool: sanitizeTrainingModePool(selectedModes),
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
    setTrainingSettings({ ...training, freePracticePresets: [...training.freePracticePresets, preset] });
    setSavedPresetId(id);
    setStep("saved");
  }

  function resetFlow() {
    const nextPlacements = createInitialPlacements(availableModes);
    const firstMode = availableModes[0];
    setStep("assessment");
    setPlacements(nextPlacements);
    setCurrentPrompt(firstMode ? buildPrompt(firstMode, nextPlacements[firstMode].currentStageIndex, settings.octave, 1) : null);
    setSelectedAnswer(null);
    setAssessmentAttempts([]);
    setAssessmentRunning(firstMode != null);
    setSelectedModes([]);
    setSavedPresetId(null);
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <h2 style={{ margin: 0 }}>Custom Path</h2>
          <div className="subtle">
            Step {step === "assessment" ? "1" : step === "results" ? "2" : step === "topics" ? "3" : "4"} of 4
          </div>
          <div className="chip-row">
            <div className="chip">Placed {completedModeCount}/{availableModes.length}</div>
            <div className="chip">Answered {assessmentAttempts.length}</div>
            {step === "assessment" && <div className="chip">At least {estimatedRemaining} left</div>}
          </div>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => navigate("/")}>Back home</button>
        </div>
      </div>

      {step === "assessment" && currentQuestion && currentStage && (
        <section className="panel question-card">
          <div className="kicker kicker--red">Adaptive assessment</div>
          <div className="prompt-title">{currentQuestion.prompt}</div>
          <div className="meta-strip">
            <div className="meta-pill">Topic <strong>{MODE_COPY[currentPrompt!.mode].title}</strong></div>
            <div className="meta-pill">Placement <strong>{currentStage.shortLabel}</strong></div>
            <div className="meta-pill">Stage <strong>{currentStage.title}</strong></div>
            <div className="meta-pill">Prompt <strong>{currentPrompt!.ordinal}</strong></div>
          </div>
          <div className="panel-copy">{currentStage.description}</div>
          <div className="answer-grid">
            {currentQuestion.answerChoices.map((choice) => (
              <button type="button" key={choice} onClick={() => submitAssessmentAnswer(choice)} disabled={selectedAnswer !== null}>
                {choice}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" onClick={replayPrompt}>Replay prompt</button>
            {selectedAnswer && <button type="button" onClick={continueAssessment}>Continue</button>}
          </div>
          {selectedAnswer && (
            <div className={selectedAnswer === currentQuestion.correctAnswer ? "answer-line answer-line--correct" : "answer-line answer-line--wrong"}>
              {selectedAnswer === currentQuestion.correctAnswer ? "Correct" : `Correct answer: ${currentQuestion.correctAnswer}`}
            </div>
          )}
        </section>
      )}

      {step === "results" && (
        <>
          <section className="panel panel--accent">
            <div className="panel-header">
              <div>
                <div className="kicker kicker--red">Results screen</div>
                <div className="panel-title">Placement and weak areas</div>
              </div>
              <div className="panel-copy">
                Each topic now has a placement level. The app used that plus your stored weak areas to decide what should be emphasized.
              </div>
            </div>
            <div className="custom-grid">
              {modeSummaries.map((summary) => (
                <article key={summary.mode} className={recommendedSet.has(summary.mode) ? "topic-card topic-card--recommended" : "topic-card"}>
                  <div className="topic-card__header">
                    <div>
                      <div className="topic-card__title">{MODE_COPY[summary.mode].title}</div>
                      <div className="topic-card__copy">{MODE_COPY[summary.mode].description}</div>
                    </div>
                    <div className="topic-card__metric">{summary.recommendedStage.shortLabel}</div>
                  </div>
                  <div className="chip-row">
                    <div className="chip">Placement {summary.recommendedStage.title}</div>
                    <div className="chip">{formatAccuracy(summary.correct, summary.attempts)}</div>
                    <div className="chip chip--quiet">{recommendedSet.has(summary.mode) ? "Needs work" : "Stable for now"}</div>
                  </div>
                  {summary.startedHigher && <div className="mini-stat">Started above level 1 from prior progress, then verified with this assessment.</div>}
                  <div className="list-stack">
                    {summary.stageBreakdown.filter((item) => item.attempts > 0).map((item) => (
                      <div key={`${summary.mode}_${item.stage.shortLabel}`} className="mini-stat">
                        {item.stage.shortLabel} {item.stage.title}: {formatAccuracy(item.correct, item.attempts)}
                      </div>
                    ))}
                  </div>
                  {(weakAreasByMode.get(summary.mode) ?? []).length > 0 && (
                    <div className="list-stack">
                      {(weakAreasByMode.get(summary.mode) ?? []).slice(0, 3).map((label) => (
                        <div key={`${summary.mode}_${label}`} className="mini-stat">{label}</div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
          <div className="button-row">
            <button type="button" onClick={resetFlow}>Re-run assessment</button>
            <button type="button" onClick={() => setStep("topics")}>Continue to topic selection</button>
          </div>
        </>
      )}

      {step === "topics" && (
        <>
          <section className="panel panel--blue">
            <div className="panel-header">
              <div>
                <div className="kicker kicker--blue">Topic selection</div>
                <div className="panel-title">Pick what you actually want to focus on</div>
              </div>
              <div className="panel-copy">
                Needs-work topics stay on top, but the rest of the available topics are still selectable underneath.
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="subtle">Needs work</div>
            <div className="custom-grid">
              {recommendedModes.map((mode) => {
                const summary = modeSummaries.find((item) => item.mode === mode);
                return (
                  <button
                    type="button"
                    key={mode}
                    className={selectedModes.includes(mode) ? "topic-card topic-card--selected topic-card--recommended" : "topic-card topic-card--recommended"}
                    onClick={() => toggleSelectedMode(mode)}
                  >
                    <div className="topic-card__header">
                      <div>
                        <div className="topic-card__title">{MODE_COPY[mode].title}</div>
                        <div className="topic-card__copy">{summary?.recommendedStage.title}</div>
                      </div>
                      <div className="topic-card__metric">{summary?.recommendedStage.shortLabel}</div>
                    </div>
                    <div className="chip-row">
                      <div className="chip">{selectedModes.includes(mode) ? "Included" : "Tap to include"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="panel">
            <div className="subtle">Other topics available</div>
            <div className="custom-grid">
              {availableModes.filter((mode) => !recommendedSet.has(mode)).map((mode) => {
                const summary = modeSummaries.find((item) => item.mode === mode);
                return (
                  <button
                    type="button"
                    key={mode}
                    className={selectedModes.includes(mode) ? "topic-card topic-card--selected" : "topic-card"}
                    onClick={() => toggleSelectedMode(mode)}
                  >
                    <div className="topic-card__header">
                      <div>
                        <div className="topic-card__title">{MODE_COPY[mode].title}</div>
                        <div className="topic-card__copy">{summary?.recommendedStage.title}</div>
                      </div>
                      <div className="topic-card__metric">{summary?.recommendedStage.shortLabel}</div>
                    </div>
                    <div className="chip-row">
                      <div className="chip">{selectedModes.includes(mode) ? "Included" : "Tap to include"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <div className="button-row">
            <button type="button" onClick={() => setStep("results")}>Back to results</button>
            <button type="button" onClick={() => setStep("settings")} disabled={selectedModes.length === 0}>Continue to settings</button>
          </div>
        </>
      )}

      {step === "settings" && (
        <>
          <section className="panel panel--accent">
            <div className="panel-header">
              <div>
                <div className="kicker kicker--red">Settings screen</div>
                <div className="panel-title">Save your custom preset</div>
              </div>
              <div className="panel-copy">
                The recommended levels found in the assessment are already loaded here. Change anything you want before saving.
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="control-grid">
              <label className="control-label">Preset name
                <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="My custom path" />
              </label>
              <label className="control-label">Tonic source
                <select value={tonicMode} onChange={(event) => setTonicMode(event.target.value as "random" | "fixed")}>
                  <option value="random">Randomize tonic</option>
                  <option value="fixed">Fixed tonic</option>
                </select>
              </label>
              {tonicMode === "fixed" && (
                <label className="control-label">Fixed tonic
                  <select value={fixedTonic} onChange={(event) => setFixedTonic(event.target.value as NoteName)}>
                    {NOTE_NAMES.map((note) => (
                      <option key={note} value={note}>{note}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="control-label">Tonal mode
                <select value={tonalMode} onChange={(event) => setTonalMode(event.target.value as TonalMode)}>
                  <option value="major">Major</option>
                  <option value="natural_minor">Natural minor</option>
                  <option value="harmonic_minor">Harmonic minor</option>
                  <option value="melodic_minor">Melodic minor</option>
                  <option value="modal">Modal</option>
                </select>
              </label>
            </div>
          </section>
          <section className="panel">
            <div className="subtle">Chosen topics</div>
            <div className="custom-grid">
              {selectedModes.includes("scale_degree") && (
                <div className="topic-card topic-card--static">
                  <div className="topic-card__title">Scale Degree settings</div>
                  <div className="topic-card__copy">Recommended from placement: {assessmentStagesForMode("scale_degree")[placements.scale_degree.recommendedStageIndex].title}</div>
                  <label className="control-label">Degree level
                    <select value={degreeLevel} onChange={(event) => setDegreeLevel(Number(event.target.value) as 1 | 2 | 3)}>
                      <option value={1}>1-5</option>
                      <option value={2}>+6/7</option>
                      <option value={3}>+b3/#4/b7</option>
                    </select>
                  </label>
                </div>
              )}
              {selectedModes.includes("functional_interval") && (
                <div className="topic-card topic-card--static">
                  <div className="topic-card__title">Functional Interval settings</div>
                  <div className="topic-card__copy">Recommended from placement: {assessmentStagesForMode("functional_interval")[placements.functional_interval.recommendedStageIndex].title}</div>
                  <label className="control-label">Interval level
                    <select value={intervalLevel} onChange={(event) => setIntervalLevel(Number(event.target.value) as 1 | 2 | 3 | 4)}>
                      <option value={1}>Level 1</option>
                      <option value={2}>Level 2</option>
                      <option value={3}>Level 3</option>
                      <option value={4}>Level 4</option>
                    </select>
                  </label>
                  <label className="control-label">Interval playback
                    <select value={intervalVariant} onChange={(event) => setIntervalVariant(event.target.value as IntervalPlaybackVariant)}>
                      <option value="scale_context">Scale-context</option>
                      <option value="sequential_pause">Sequential pause</option>
                      <option value="immediate_jump">Immediate jump</option>
                      <option value="harmonic_stack">Harmonic stack</option>
                    </select>
                  </label>
                </div>
              )}
              {selectedModes.includes("functional_harmony") && (
                <div className="topic-card topic-card--static">
                  <div className="topic-card__title">Functional Harmony settings</div>
                  <div className="topic-card__copy">Recommended from placement: {assessmentStagesForMode("functional_harmony")[placements.functional_harmony.recommendedStageIndex].title}</div>
                  <label className="control-label">Harmony level
                    <select value={harmonyLevel} onChange={(event) => setHarmonyLevel(Number(event.target.value) as 1 | 2)}>
                      <option value={1}>Level 1</option>
                      <option value={2}>Level 2</option>
                    </select>
                  </label>
                  <label className="control-label">Harmony playback
                    <select value={harmonyVariant} onChange={(event) => setHarmonyVariant(event.target.value as HarmonyPlaybackVariant)}>
                      <option value="block">Block</option>
                      <option value="arpeggiated">Arpeggiated</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </label>
                </div>
              )}
              {selectedModes.includes("timing_grid") && (
                <div className="topic-card topic-card--static">
                  <div className="topic-card__title">Timing Grid settings</div>
                  <div className="topic-card__copy">Recommended from placement: {assessmentStagesForMode("timing_grid")[placements.timing_grid.recommendedStageIndex].title}</div>
                  <label className="control-label">Timing level
                    <select value={timingLevel} onChange={(event) => setTimingLevel(Number(event.target.value) as 1 | 2 | 3)}>
                      <option value={1}>Level 1</option>
                      <option value={2}>Level 2</option>
                      <option value={3}>Level 3</option>
                    </select>
                  </label>
                </div>
              )}
              {selectedModes.includes("phrase_recall") && (
                <div className="topic-card topic-card--static">
                  <div className="topic-card__title">Phrase Recall settings</div>
                  <div className="topic-card__copy">Recommended from placement: {assessmentStagesForMode("phrase_recall")[placements.phrase_recall.recommendedStageIndex].title}</div>
                  <label className="control-label">Phrase level
                    <select value={phraseLevel} onChange={(event) => setPhraseLevel(Number(event.target.value) as 1 | 2 | 3)}>
                      <option value={1}>Level 1</option>
                      <option value={2}>Level 2</option>
                      <option value={3}>Level 3</option>
                    </select>
                  </label>
                  <label className="control-label">Input mode
                    <select value={dictationInputMode} onChange={(event) => setDictationInputMode(event.target.value as DictationInputMode)}>
                      <option value="multiple_choice">Multiple choice</option>
                      <option value="piano_grid">Piano grid</option>
                      <option value="staff_entry">Staff entry</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="subtle">Session aids</div>
            <div className="checkbox-grid">
              {SESSION_TOGGLE_COPY.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={toggles[item.key] ? "checkbox-chip checkbox-chip--stacked checkbox-chip--selected" : "checkbox-chip checkbox-chip--stacked"}
                  onClick={() => setToggle(item.key, !toggles[item.key])}
                >
                  <span className="checkbox-chip__body">
                    <span className="checkbox-chip__title">{item.title}</span>
                    <span className="checkbox-chip__copy">{item.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          <div className="button-row">
            <button type="button" onClick={() => setStep("topics")}>Back to topics</button>
            <button type="button" onClick={savePreset} disabled={selectedModes.length === 0}>Save preset</button>
          </div>
        </>
      )}

      {step === "saved" && (
        <section className="panel panel--blue">
          <div className="kicker kicker--blue">Preset ready</div>
          <div className="panel-title">{presetName.trim() || "Custom Path"}</div>
          <div className="panel-copy">
            Your custom preset has been saved with the assessed levels you selected. You can use it for any future session.
          </div>
          <div className="chip-row">
            {selectedModes.map((mode) => {
              const summary = modeSummaries.find((item) => item.mode === mode);
              return <div key={mode} className="chip">{MODE_COPY[mode].title} {summary?.recommendedStage.shortLabel}</div>;
            })}
          </div>
          <div className="button-row">
            <button type="button" onClick={() => navigate(savedPresetId ? `/practice?preset=${savedPresetId}` : "/practice")}>
              Open in practice
            </button>
            <button type="button" onClick={resetFlow}>Build another custom path</button>
          </div>
        </section>
      )}
    </div>
  );
}
