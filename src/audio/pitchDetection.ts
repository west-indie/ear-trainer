import { freqToMidi, midiToNoteLabel } from "./music";

export type PitchFrame = {
  freqHz: number | null;
  midi: number | null;
  cents: number | null;
  clarity: number;
  rms: number;
  isSignal: boolean;
  noteLabel: string | null;
};

export function rmsLevel(buffer: Float32Array<ArrayBufferLike>): number {
  let total = 0;
  for (let i = 0; i < buffer.length; i++) {
    total += buffer[i] * buffer[i];
  }
  return Math.sqrt(total / buffer.length);
}

export function estimatePitchHz(
  buffer: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  minHz = 80,
  maxHz = 1200
): { freqHz: number; clarity: number } | null {
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);

  let bestLag = -1;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = buffer.length - lag;
    for (let i = 0; i < limit; i++) {
      const a = buffer[i];
      const b = buffer[i + lag];
      correlation += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denom = Math.sqrt(energyA * energyB);
    if (denom <= 0) continue;
    const score = correlation / denom;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore < 0.82) return null;

  return {
    freqHz: sampleRate / bestLag,
    clarity: bestScore,
  };
}

export function analyzePitchFrame(
  buffer: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  noiseGate: number
): PitchFrame {
  const rms = rmsLevel(buffer);
  const isSignal = rms >= noiseGate;
  if (!isSignal) {
    return {
      freqHz: null,
      midi: null,
      cents: null,
      clarity: 0,
      rms,
      isSignal: false,
      noteLabel: null,
    };
  }

  const estimate = estimatePitchHz(buffer, sampleRate);
  if (!estimate) {
    return {
      freqHz: null,
      midi: null,
      cents: null,
      clarity: 0,
      rms,
      isSignal: true,
      noteLabel: null,
    };
  }

  const midi = freqToMidi(estimate.freqHz);
  const rounded = Math.round(midi);
  const cents = (midi - rounded) * 100;

  return {
    freqHz: estimate.freqHz,
    midi,
    cents,
    clarity: estimate.clarity,
    rms,
    isSignal: true,
    noteLabel: midiToNoteLabel(rounded),
  };
}
