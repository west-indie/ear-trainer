import { readLocal, writeLocal } from "./storage";
import { sanitizeVoiceExerciseKind } from "../config/featureFlags";
import type { VoiceExerciseKind } from "../training/voice";

export type VoiceSettings = {
  toleranceCents: number;
  noiseGate: number;
  holdDurationMs: number;
  exerciseKind: VoiceExerciseKind;
};

const KEY = "et_voice_settings_v1";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  toleranceCents: 25,
  noiseGate: 0.018,
  holdDurationMs: 900,
  exerciseKind: "interval_echo",
};

export function getVoiceSettings(): VoiceSettings {
  const stored = readLocal<VoiceSettings>(KEY, DEFAULT_VOICE_SETTINGS);
  return {
    ...stored,
    exerciseKind: sanitizeVoiceExerciseKind(stored.exerciseKind),
  };
}

export function setVoiceSettings(next: VoiceSettings) {
  writeLocal(KEY, next);
}
