import { midiToFreq } from "../audio/music";
import type { NoteName } from "../audio/music";
import type { PlaybackPlan } from "../audio/PlaybackEngine";
import type { DictationInputMode, PhraseLevel, PhraseTag, TonalMode } from "./types";
import { degreeMidi } from "./theory";

const DEGREE_POOL = ["1", "2", "3", "4", "5", "6", "7"] as const;
const TRIADIC_POOL = ["1", "3", "5", "6"] as const;
const CHROMATIC_POOL = ["1", "2", "b3", "3", "4", "#4", "5", "6", "b7", "7"] as const;

export type PhrasePattern = {
  bars: number;
  tag: PhraseTag;
  degrees: string[];
  measureGroups: string[][];
  answerChoices: string[];
  correctAnswer: string;
  playbackPlan: PlaybackPlan;
  replayWithCountIn: PlaybackPlan;
  measurePlaybackPlans: PlaybackPlan[];
  inputMode: DictationInputMode;
};

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function formatMeasures(groups: string[][]): string {
  return groups.map((m) => m.join(" ")).join(" | ");
}

function mutateDegrees(base: string[], tonalMode: TonalMode): string[] {
  const next = [...base];
  const idx = Math.floor(Math.random() * next.length);
  const pool = tonalMode === "major" ? DEGREE_POOL : CHROMATIC_POOL;
  let replacement = pick(pool);
  while (replacement === next[idx]) {
    replacement = pick(pool);
  }
  next[idx] = replacement;
  return next;
}

function eventsForDegrees(input: { degrees: string[]; tonic: NoteName; octave: number; tonalMode: TonalMode; startBeat: number }): PlaybackPlan {
  const events = input.degrees.map((degree, i) => ({
    atBeats: input.startBeat + i,
    durationBeats: 0.8,
    freqHz: midiToFreq(degreeMidi(input.tonic, input.octave, degree, input.tonalMode)),
    gain: 0.88,
  }));
  return { kind: "sequence", events };
}

function countInEvents(beats: number): NonNullable<Extract<PlaybackPlan, { kind: "sequence" }>["events"]> {
  return Array.from({ length: beats }, (_, i) => ({
    atBeats: i,
    durationBeats: 0.18,
    freqHz: midiToFreq(i % 4 === 0 ? 102 : 96),
    gain: i % 4 === 0 ? 0.62 : 0.48,
  }));
}

function chooseInputMode(level: PhraseLevel, preferred: DictationInputMode): DictationInputMode {
  if (level === 1) return "multiple_choice";
  if (preferred === "multiple_choice") return Math.random() < 0.5 ? "multiple_choice" : "piano_grid";
  return preferred;
}

function generateBaseDegrees(level: PhraseLevel, tag: PhraseTag, bars: number): string[] {
  const notesPerBar = 4;
  const totalNotes = bars * notesPerBar;
  if (tag === "stepwise") {
    const out: string[] = ["1"];
    while (out.length < totalNotes) {
      const prev = out[out.length - 1];
      const idx = DEGREE_POOL.indexOf(prev as (typeof DEGREE_POOL)[number]);
      const step = Math.random() < 0.5 ? -1 : 1;
      const nextIdx = Math.max(0, Math.min(DEGREE_POOL.length - 1, idx + step));
      out.push(DEGREE_POOL[nextIdx]);
    }
    return out;
  }
  if (tag === "triadic") {
    const out: string[] = [];
    while (out.length < totalNotes) out.push(pick(TRIADIC_POOL));
    return out;
  }
  const out: string[] = [];
  const source = level >= 3 ? CHROMATIC_POOL : DEGREE_POOL;
  while (out.length < totalNotes) out.push(pick(source));
  return out;
}

export function makePhrasePattern(input: {
  level: PhraseLevel;
  preferredInputMode: DictationInputMode;
  tonic: NoteName;
  octave: number;
  tonalMode: TonalMode;
}): PhrasePattern {
  const bars = input.level === 1 ? 2 : Math.min(4, 2 + input.level - 1);
  const tag = pick<PhraseTag>(input.level === 1 ? ["stepwise"] : input.level === 2 ? ["stepwise", "triadic"] : ["stepwise", "triadic", "chromatic"]);
  const degrees = generateBaseDegrees(input.level, tag, bars);
  const notesPerBar = 4;
  const measureGroups = Array.from({ length: bars }, (_, idx) => degrees.slice(idx * notesPerBar, idx * notesPerBar + notesPerBar));
  const correctAnswer = formatMeasures(measureGroups);
  const wrong = Array.from({ length: 3 }, () => mutateDegrees(degrees, input.tonalMode));
  const answerChoices = shuffle([correctAnswer, ...wrong.map((line) => formatMeasures(
    Array.from({ length: bars }, (_, idx) => line.slice(idx * notesPerBar, idx * notesPerBar + notesPerBar))
  ))]).slice(0, 4);

  const body = eventsForDegrees({
    degrees,
    tonic: input.tonic,
    octave: input.octave,
    tonalMode: input.tonalMode,
    startBeat: 0,
  });
  const replay = eventsForDegrees({
    degrees,
    tonic: input.tonic,
    octave: input.octave,
    tonalMode: input.tonalMode,
    startBeat: 4,
  });
  const replayWithCountIn: PlaybackPlan = {
    kind: "sequence",
    events: [...countInEvents(4), ...(replay.kind === "sequence" ? replay.events : [])],
  };

  const measurePlaybackPlans = measureGroups.map((measure) =>
    eventsForDegrees({
      degrees: measure,
      tonic: input.tonic,
      octave: input.octave,
      tonalMode: input.tonalMode,
      startBeat: 0,
    })
  );

  return {
    bars,
    tag,
    degrees,
    measureGroups,
    answerChoices,
    correctAnswer,
    playbackPlan: body,
    replayWithCountIn,
    measurePlaybackPlans,
    inputMode: chooseInputMode(input.level, input.preferredInputMode),
  };
}
