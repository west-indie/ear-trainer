import type { TrainingMode } from "../training/types";
import type { VoiceExerciseKind } from "../training/voice";

export const featureFlags = {
  trainingModes: {
    scale_degree: true,
    functional_interval: true,
    functional_harmony: false,
    timing_grid: false,
    phrase_recall: false,
  },
  voiceExercises: {
    interval_echo: true,
    degree_match: true,
    motif_match: false,
  },
} as const;

export function getEnabledTrainingModes(): TrainingMode[] {
  return (Object.entries(featureFlags.trainingModes) as Array<[TrainingMode, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([mode]) => mode);
}

export function isTrainingModeEnabled(mode: TrainingMode): boolean {
  return featureFlags.trainingModes[mode];
}

export function sanitizeTrainingModePool(modePool?: TrainingMode[]): TrainingMode[] {
  const enabled = getEnabledTrainingModes();
  const filtered = (modePool ?? []).filter(isTrainingModeEnabled);
  return filtered.length > 0 ? filtered : [enabled[0] ?? "scale_degree"];
}

export function getEnabledVoiceExercises(): VoiceExerciseKind[] {
  return (Object.entries(featureFlags.voiceExercises) as Array<[VoiceExerciseKind, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([kind]) => kind);
}

export function isVoiceExerciseEnabled(kind: VoiceExerciseKind): boolean {
  return featureFlags.voiceExercises[kind];
}

export function sanitizeVoiceExerciseKind(kind?: VoiceExerciseKind): VoiceExerciseKind {
  if (kind && isVoiceExerciseEnabled(kind)) return kind;
  return getEnabledVoiceExercises()[0] ?? "interval_echo";
}
