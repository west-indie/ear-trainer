import type { PlaybackPlan } from "../audio/PlaybackEngine";
import { midiToFreq, midiToNoteLabel } from "../audio/music";
import { degreeSemitone } from "./theory";
import type { TonalMode, TrainingMode } from "./types";

export type VoiceExerciseKind = "interval_echo" | "degree_match" | "motif_match";

export type VoiceExercise = {
  id: string;
  kind: VoiceExerciseKind;
  label: string;
  instructions: string;
  targetMidis: number[];
  targetLabels: string[];
  promptPlan: PlaybackPlan;
  droneMidi?: number;
  tonicMidi: number;
  progressMode: TrainingMode;
  progressItemId: string;
  adaptiveKeys: string[];
  contextKey: string;
};

export type VoicePitchSample = {
  atMs: number;
  midi: number;
  rms: number;
};

export type VoicePitchSegment = {
  startMs: number;
  endMs: number;
  durationMs: number;
  avgMidi: number;
};

export type VoiceAttemptResult = {
  correct: boolean;
  summary: string;
  matched: number;
  expected: number;
  centsOff: number[];
  scoredMidis: number[];
};

const MOTIF_PATTERNS = [
  ["1", "2", "3"],
  ["3", "2", "1"],
  ["1", "3", "2", "1"],
  ["5", "6", "5", "3"],
  ["1", "2", "4", "3"],
] as const;

const INTERVAL_DEGREES = ["2", "3", "4", "5", "6", "7"] as const;
const DEGREE_POOL = ["2", "3", "4", "5", "6", "7"] as const;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function noteEvent(midi: number, atBeats: number, durationBeats: number, gain = 0.84) {
  return {
    atBeats,
    durationBeats,
    freqHz: midiToFreq(midi),
    gain,
  };
}

function sequencePlan(midis: number[], withTonicLead = true): PlaybackPlan {
  const events = [];
  let beat = 0;
  if (withTonicLead && midis.length > 0) {
    events.push(noteEvent(midis[0], beat, 0.7, 0.74));
    beat += 0.9;
  }
  const start = withTonicLead ? 1 : 0;
  for (let i = start; i < midis.length; i++) {
    events.push(noteEvent(midis[i], beat, 0.62, 0.88));
    beat += 0.75;
  }
  return { kind: "sequence", events };
}

function tonalFamily(tonalMode: TonalMode): "major" | "minor" | "mixed" {
  if (tonalMode === "major") return "major";
  if (tonalMode.includes("minor")) return "minor";
  return "mixed";
}

function nearestTargetMidi(detectedMidi: number, targetMidi: number): number {
  let best = targetMidi;
  let bestDistance = Math.abs(detectedMidi - targetMidi);
  for (const shift of [-24, -12, 12, 24]) {
    const candidate = targetMidi + shift;
    const distance = Math.abs(detectedMidi - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function centsOffTarget(detectedMidi: number, targetMidi: number): number {
  return (detectedMidi - nearestTargetMidi(detectedMidi, targetMidi)) * 100;
}

export function buildVoiceExercise(input: {
  kind: VoiceExerciseKind;
  tonicMidi: number;
  tonalMode: TonalMode;
}): VoiceExercise {
  const { kind, tonicMidi, tonalMode } = input;

  if (kind === "interval_echo") {
    const degree = pick(INTERVAL_DEGREES);
    const targetMidi = tonicMidi + degreeSemitone(degree, tonalMode);
    return {
      id: `voice_${uid()}`,
      kind,
      label: `Echo ${degree}`,
      instructions: `Hear tonic to ${degree}, then sing the target note back.`,
      targetMidis: [targetMidi],
      targetLabels: [degree],
      promptPlan: sequencePlan([tonicMidi, targetMidi]),
      tonicMidi,
      progressMode: "functional_interval",
      progressItemId: `voice:functional_interval:1->${degree}`,
      adaptiveKeys: [`movement:1->${degree}`],
      contextKey: `voice:functional_interval:${tonalFamily(tonalMode)}`,
    };
  }

  if (kind === "degree_match") {
    const degree = pick(DEGREE_POOL);
    const targetMidi = tonicMidi + degreeSemitone(degree, tonalMode);
    return {
      id: `voice_${uid()}`,
      kind,
      label: `Hold ${degree} over the drone`,
      instructions: `Keep the tonic drone in your ear and hold degree ${degree} until the tuner settles.`,
      targetMidis: [targetMidi],
      targetLabels: [degree],
      promptPlan: {
        kind: "sequence",
        events: [noteEvent(tonicMidi, 0, 0.8, 0.72)],
      },
      droneMidi: tonicMidi,
      tonicMidi,
      progressMode: "scale_degree",
      progressItemId: `voice:scale_degree:${degree}`,
      adaptiveKeys: [`degree:${degree}`],
      contextKey: `voice:scale_degree:${tonalFamily(tonalMode)}`,
    };
  }

  const pattern = pick(MOTIF_PATTERNS);
  const targetMidis = pattern.map((degree) => tonicMidi + degreeSemitone(degree, tonalMode));
  return {
    id: `voice_${uid()}`,
    kind,
    label: `Echo motif ${pattern.join("-")}`,
    instructions: "Listen once, then sing the full response in the same order.",
    targetMidis,
    targetLabels: [...pattern],
    promptPlan: sequencePlan([tonicMidi, ...targetMidis]),
    tonicMidi,
    progressMode: "phrase_recall",
    progressItemId: `voice:phrase_recall:${pattern.join("-")}`,
    adaptiveKeys: [`phrase:voice_${pattern.join("-")}`],
    contextKey: `voice:phrase_recall:${tonalFamily(tonalMode)}`,
  };
}

export function extractPitchSegments(samples: VoicePitchSample[]): VoicePitchSegment[] {
  if (samples.length === 0) return [];
  const segments: VoicePitchSegment[] = [];
  let startIndex = 0;

  for (let i = 1; i <= samples.length; i++) {
    const current = samples[i];
    const previous = samples[i - 1];
    const ended =
      i === samples.length
      || current.atMs - previous.atMs > 220
      || Math.abs(current.midi - previous.midi) > 1.35;

    if (!ended) continue;

    const chunk = samples.slice(startIndex, i);
    const startMs = chunk[0].atMs;
    const endMs = chunk[chunk.length - 1].atMs;
    const durationMs = endMs - startMs;
    if (durationMs >= 180) {
      const avgMidi = chunk.reduce((sum, sample) => sum + sample.midi, 0) / chunk.length;
      segments.push({ startMs, endMs, durationMs, avgMidi });
    }
    startIndex = i;
  }

  return segments;
}

export function calibrateTonicFromSamples(samples: VoicePitchSample[]): number | null {
  const segments = extractPitchSegments(samples);
  if (segments.length === 0) return null;
  const best = [...segments].sort((a, b) => b.durationMs - a.durationMs)[0];
  return Math.round(best.avgMidi);
}

function summarizeSingle(targetMidi: number, segments: VoicePitchSegment[], toleranceCents: number): VoiceAttemptResult {
  if (segments.length === 0) {
    return {
      correct: false,
      summary: `No stable pitch detected near ${midiToNoteLabel(targetMidi)}.`,
      matched: 0,
      expected: 1,
      centsOff: [],
      scoredMidis: [],
    };
  }

  const best = [...segments].sort((a, b) => b.durationMs - a.durationMs)[0];
  const cents = centsOffTarget(best.avgMidi, targetMidi);
  const correct = Math.abs(cents) <= toleranceCents;
  const direction = cents > 0 ? "sharp" : "flat";

  return {
    correct,
    summary: correct
      ? `Stable and centered on ${midiToNoteLabel(targetMidi)}.`
      : `${midiToNoteLabel(targetMidi)} was ${Math.round(Math.abs(cents))} cents ${direction}.`,
    matched: correct ? 1 : 0,
    expected: 1,
    centsOff: [cents],
    scoredMidis: [best.avgMidi],
  };
}

function scoreSequenceWindow(targetMidis: number[], segments: VoicePitchSegment[]): number {
  let total = 0;
  for (let i = 0; i < targetMidis.length; i++) {
    total += Math.abs(centsOffTarget(segments[i].avgMidi, targetMidis[i]));
  }
  return total;
}

export function evaluateVoiceAttempt(input: {
  exercise: VoiceExercise;
  samples: VoicePitchSample[];
  toleranceCents: number;
}): VoiceAttemptResult {
  const { exercise, samples, toleranceCents } = input;
  const segments = extractPitchSegments(samples);

  if (exercise.targetMidis.length === 1) {
    return summarizeSingle(exercise.targetMidis[0], segments, toleranceCents);
  }

  if (segments.length < exercise.targetMidis.length) {
    return {
      correct: false,
      summary: `Captured ${segments.length} stable notes out of ${exercise.targetMidis.length}.`,
      matched: 0,
      expected: exercise.targetMidis.length,
      centsOff: [],
      scoredMidis: segments.map((segment) => segment.avgMidi),
    };
  }

  let bestStart = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= segments.length - exercise.targetMidis.length; start++) {
    const window = segments.slice(start, start + exercise.targetMidis.length);
    const score = scoreSequenceWindow(exercise.targetMidis, window);
    if (score < bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const chosen = segments.slice(bestStart, bestStart + exercise.targetMidis.length);
  const centsOff = chosen.map((segment, index) => centsOffTarget(segment.avgMidi, exercise.targetMidis[index]));
  const matched = centsOff.filter((cents) => Math.abs(cents) <= toleranceCents).length;
  const correct = matched === exercise.targetMidis.length;

  return {
    correct,
    summary: correct
      ? "Contour and pitch centers matched the response."
      : `Matched ${matched}/${exercise.targetMidis.length} notes inside tolerance.`,
    matched,
    expected: exercise.targetMidis.length,
    centsOff,
    scoredMidis: chosen.map((segment) => segment.avgMidi),
  };
}
