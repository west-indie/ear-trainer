import { midiToFreq } from "../audio/music";
import type { PlaybackPlan } from "../audio/PlaybackEngine";
import type { MeterSignature, TimingLevel, TimingQuestionKind, TimingSubdivision } from "./types";

export type TimingPattern = {
  meter: MeterSignature;
  subdivision: TimingSubdivision;
  bars: number;
  questionKind: TimingQuestionKind;
  targetBeats: number[];
  patternLengthBeats: number;
  quantizeStepBeats: number;
  promptPlan: PlaybackPlan;
  replayWithCountIn: PlaybackPlan;
};

export type TapHitError = {
  targetBeat: number;
  tappedBeat: number | null;
  deltaMs: number | null;
};

export type TapAssessment = {
  matched: number;
  expected: number;
  accuracy: number;
  errors: TapHitError[];
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function stepBeats(subdivision: TimingSubdivision): number {
  if (subdivision === "quarter") return 1;
  if (subdivision === "eighth") return 0.5;
  if (subdivision === "triplet") return 1 / 3;
  return 0.25;
}

function beatsPerBar(meter: MeterSignature): number {
  if (meter === "2/4") return 2;
  if (meter === "3/4") return 3;
  return 4;
}

function snapBeat(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function makeClick(freq: number, atBeats: number, durationBeats: number, gain: number) {
  return { atBeats, durationBeats, freqHz: midiToFreq(freq), gain };
}

function makePromptPlan(targetBeats: number[], meter: MeterSignature, countInBeats: number): PlaybackPlan {
  const bar = beatsPerBar(meter);
  const countIn = Array.from({ length: countInBeats }, (_, i) =>
    makeClick((i % bar) === 0 ? 102 : 96, i, 0.18, (i % bar) === 0 ? 0.62 : 0.5));
  const pattern = targetBeats.map((beat) => makeClick(84, countInBeats + beat, 0.12, 0.9));
  return { kind: "sequence", events: [...countIn, ...pattern] };
}

function generateTargetBeats(meter: MeterSignature, subdivision: TimingSubdivision, bars: number, includeSyncopation: boolean): number[] {
  const bar = beatsPerBar(meter);
  const step = stepBeats(subdivision);
  const total = bar * bars;
  const slots = Math.max(1, Math.round(total / step));
  const minHits = Math.max(4, Math.round(slots * 0.35));
  const maxHits = Math.max(minHits + 1, Math.round(slots * 0.6));
  const targetCount = Math.floor(Math.random() * (maxHits - minHits + 1)) + minHits;
  const base = new Set<number>([0]);

  while (base.size < targetCount) {
    const slot = Math.floor(Math.random() * slots);
    const beat = slot * step;
    const isStrongBeat = Math.abs(beat % 1) < 0.0001;
    if (!includeSyncopation && !isStrongBeat && Math.random() < 0.7) continue;
    base.add(snapBeat(beat, step));
  }

  return [...base].sort((a, b) => a - b);
}

export function makeTimingPattern(level: TimingLevel): TimingPattern {
  const meterPool: MeterSignature[] = level === 1 ? ["2/4", "4/4"] : ["2/4", "3/4", "4/4"];
  const subdivisionPool: TimingSubdivision[] =
    level === 1 ? ["quarter", "eighth"] : level === 2 ? ["eighth", "triplet"] : ["eighth", "triplet", "sixteenth"];
  const questionKind = pick<TimingQuestionKind>(
    level === 1
      ? ["echo_pattern", "meter_pick"]
      : level === 2
        ? ["echo_pattern", "meter_pick", "subdivision_pick"]
        : ["echo_pattern", "meter_pick", "subdivision_pick", "offbeat_pick"]
  );
  const meter = pick(meterPool);
  const subdivision = pick(subdivisionPool);
  const bars = level >= 2 ? 2 : 1;
  const patternLengthBeats = beatsPerBar(meter) * bars;
  const targetBeats = generateTargetBeats(meter, subdivision, bars, level >= 2);
  const countInBeats = beatsPerBar(meter);
  const replayWithCountIn = makePromptPlan(targetBeats, meter, countInBeats);
  const promptPlan = makePromptPlan(targetBeats, meter, 0);

  return {
    meter,
    subdivision,
    bars,
    questionKind,
    targetBeats,
    patternLengthBeats,
    quantizeStepBeats: stepBeats(subdivision),
    promptPlan,
    replayWithCountIn,
  };
}

export function quantizeTapBeats(rawBeats: number[], quantizeStepBeats: number, patternLengthBeats: number): number[] {
  const unique = new Set<number>();
  for (const beat of rawBeats) {
    const snapped = snapBeat(beat, quantizeStepBeats);
    if (snapped < 0 || snapped > patternLengthBeats + quantizeStepBeats) continue;
    unique.add(snapped);
  }
  return [...unique].sort((a, b) => a - b);
}

export function assessTapPattern(input: {
  taps: number[];
  target: number[];
  bpm: number;
  toleranceBeats?: number;
}): TapAssessment {
  const tolerance = input.toleranceBeats ?? 0.22;
  const errors: TapHitError[] = [];
  const used = new Set<number>();
  let matched = 0;

  for (const targetBeat of input.target) {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < input.taps.length; i++) {
      if (used.has(i)) continue;
      const delta = Math.abs(input.taps[i] - targetBeat);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestDelta <= tolerance) {
      used.add(bestIndex);
      matched += 1;
      errors.push({
        targetBeat,
        tappedBeat: input.taps[bestIndex],
        deltaMs: ((input.taps[bestIndex] - targetBeat) * 60_000) / input.bpm,
      });
    } else {
      errors.push({
        targetBeat,
        tappedBeat: null,
        deltaMs: null,
      });
    }
  }

  const expected = input.target.length;
  return {
    matched,
    expected,
    accuracy: expected > 0 ? matched / expected : 0,
    errors,
  };
}
