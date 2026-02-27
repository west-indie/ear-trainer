import type { NoteName } from "../audio/music";
import type { AuthoredDrill } from "../store/contentStore";
import { getReviewFocus, recordAttempt, type ReviewStrategy } from "../store/progressStore";
import { generateTrainingQuestion } from "./generator";
import type { GeneratorConfig, TrainingMode, TrainingQuestion } from "./types";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function modeWeight(mode: TrainingMode): number {
  if (mode === "scale_degree") return 4;
  if (mode === "functional_interval") return 4;
  if (mode === "functional_harmony") return 2;
  if (mode === "timing_grid") return 3;
  return 2.8;
}

function distributeModes(questionCount: number, modePool: TrainingMode[]): TrainingMode[] {
  const available: TrainingMode[] = modePool.length > 0 ? modePool : ["scale_degree", "functional_interval", "functional_harmony"];
  const weighted: TrainingMode[] = available.flatMap((mode) =>
    Array.from({ length: Math.max(1, Math.round(modeWeight(mode))) }, () => mode)
  );
  const out: TrainingMode[] = Array.from({ length: questionCount }, () => weighted[Math.floor(Math.random() * weighted.length)]);
  return shuffle(out);
}

export function generateSessionQuestions(input: {
  config: GeneratorConfig;
  questionCount: number;
  startTonic: NoteName;
  tonicOctave: number;
  reviewStrategy?: ReviewStrategy;
}): TrainingQuestion[] {
  const { config, questionCount, startTonic, tonicOctave, reviewStrategy } = input;
  const questionModes = config.sessionType === "guided" ? distributeModes(questionCount, config.modePool) : [];
  const singingCountTarget = Math.ceil(questionCount * config.singingQuota);
  const focusQueue =
    reviewStrategy == null
      ? []
      : getReviewFocus({
        strategy: reviewStrategy,
        limit: questionCount,
        modePool: config.modePool,
        tonalGroup: config.tonalMode === "major" ? "major" : config.tonalMode.includes("minor") ? "minor" : "mixed",
      });

  let tonic = startTonic;
  const out: TrainingQuestion[] = [];
  for (let i = 0; i < questionCount; i++) {
    const shouldForceSinging = i < singingCountTarget ? true : config.sessionType === "free" && config.singingQuota > 0;
    const focus = focusQueue[i];
    const q = generateTrainingQuestion({
      config,
      questionIndex: i,
      previousTonic: tonic,
      tonicOctave,
      shouldForceSinging,
      forcedMode: focus?.mode ?? questionModes[i],
      forcedAdaptiveKey: focus?.key,
      adaptiveContextKey: focus?.context,
    });
    tonic = q.tonic;
    out.push(q);
  }
  return out;
}

function tonalFamily(tonalMode: TrainingQuestion["metadata"]["tonalMode"]): "major" | "minor" | "mixed" {
  if (tonalMode === "major") return "major";
  if (tonalMode != null && tonalMode.includes("minor")) return "minor";
  return "mixed";
}

function hearingContext(question: TrainingQuestion): "melodic" | "harmonic" {
  if (question.mode === "functional_harmony") return "harmonic";
  if (question.mode === "timing_grid") return "melodic";
  if (question.mode === "functional_interval" && question.playbackPlan.kind === "chord") return "harmonic";
  return "melodic";
}

export function logTrainingAttempt(input: {
  question: TrainingQuestion;
  correct: boolean;
  responseMs: number;
}) {
  const q = input.question;
  const adaptiveKeys = [q.adaptiveFocusKey];
  if (q.mode === "functional_harmony" && q.metadata.functionLabel) {
    adaptiveKeys.push(`function:${q.metadata.functionLabel}`);
  }
  const contextKey = `${q.mode}:${hearingContext(q)}:${tonalFamily(q.metadata.tonalMode)}`;
  recordAttempt({
    itemId: q.id,
    mode: q.mode,
    correct: input.correct,
    responseMs: input.responseMs,
    contextKey,
    adaptiveKeys,
  });
}

export function generateFocusedSet(input: {
  config: GeneratorConfig;
  sourceQuestion: TrainingQuestion;
  startTonic: NoteName;
  tonicOctave: number;
  questionCount?: number;
}): TrainingQuestion[] {
  const count = Math.max(1, input.questionCount ?? 5);
  const out: TrainingQuestion[] = [];
  let tonic = input.startTonic;
  for (let i = 0; i < count; i++) {
    const q = generateTrainingQuestion({
      config: input.config,
      questionIndex: i,
      previousTonic: tonic,
      tonicOctave: input.tonicOctave,
      shouldForceSinging: false,
      forcedMode: input.sourceQuestion.mode,
      forcedAdaptiveKey: input.sourceQuestion.adaptiveFocusKey,
    });
    tonic = q.tonic;
    out.push(q);
  }
  return out;
}

export function generateAuthoredSession(input: {
  config: GeneratorConfig;
  drills: AuthoredDrill[];
  startTonic: NoteName;
  tonicOctave: number;
}): TrainingQuestion[] {
  let tonic = input.startTonic;
  return input.drills.map((drill, index) => {
    const question = generateTrainingQuestion({
      config: input.config,
      questionIndex: index,
      previousTonic: tonic,
      tonicOctave: input.tonicOctave,
      shouldForceSinging: false,
      forcedMode: drill.mode,
      forcedAdaptiveKey: drill.adaptiveKey,
    });
    tonic = question.tonic;
    return question;
  });
}
