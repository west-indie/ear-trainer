import type { NoteName } from "../audio/music";
import { readLocal, writeLocal } from "./storage";
import { getEnabledTrainingModes, sanitizeTrainingModePool } from "../config/featureFlags";
import type {
  DegreeLevel,
  DictationInputMode,
  GeneratorConfig,
  HarmonyLevel,
  HarmonyPlaybackVariant,
  IntervalLevel,
  IntervalPlaybackVariant,
  PhraseLevel,
  TimingLevel,
  TrainingMode,
  TrainingUserToggles,
  TonalMode,
} from "../training/types";

export type FreePracticePreset = {
  id: string;
  name: string;
  modePool: TrainingMode[];
  tonicMode: "random" | "fixed";
  fixedTonic: NoteName;
  intervalLevel: IntervalLevel;
  degreeLevel: DegreeLevel;
  harmonyLevel: HarmonyLevel;
  timingLevel: TimingLevel;
  phraseLevel: PhraseLevel;
  dictationInputMode: DictationInputMode;
  tonalMode: TonalMode;
  intervalPlaybackVariant: IntervalPlaybackVariant;
  harmonyPlaybackVariant: HarmonyPlaybackVariant;
  toggles: TrainingUserToggles;
};

export type TrainingSettingsState = {
  freePracticePresets: FreePracticePreset[];
  freePracticeToggles: TrainingUserToggles;
};

const KEY = "et_training_settings_v1";

export const DEFAULT_TRAINING_TOGGLES: TrainingUserToggles = {
  showAnswerNoteNames: false,
  allowPromptReplay: false,
  showExplainWhy: true,
  showIntervalNames: true,
  showSemitoneCount: false,
  showSolfege: false,
  enforceSinging: false,
  requireMicForSinging: false,
  droneEnabled: false,
  allowKeyboardInput: false,
  showChordTones: false,
  showScaleMap: false,
  showPianoStrip: false,
};

export const DEFAULT_TRAINING_SETTINGS: TrainingSettingsState = {
  freePracticePresets: [],
  freePracticeToggles: DEFAULT_TRAINING_TOGGLES,
};

export function getTrainingSettings(): TrainingSettingsState {
  const raw = readLocal<TrainingSettingsState>(KEY, DEFAULT_TRAINING_SETTINGS);
  const normalizedPresets = (raw.freePracticePresets ?? []).map((preset, i) => ({
    id: preset.id ?? `preset_${i}`,
    name: preset.name ?? `Preset ${i + 1}`,
    modePool: sanitizeTrainingModePool(preset.modePool),
    tonicMode: preset.tonicMode ?? "random",
    fixedTonic: preset.fixedTonic ?? "C",
    intervalLevel: preset.intervalLevel ?? 1,
    degreeLevel: preset.degreeLevel ?? 1,
    harmonyLevel: preset.harmonyLevel ?? 1,
    timingLevel: preset.timingLevel ?? 1,
    phraseLevel: preset.phraseLevel ?? 1,
    dictationInputMode: preset.dictationInputMode ?? "multiple_choice",
    tonalMode: preset.tonalMode ?? "major",
    intervalPlaybackVariant: preset.intervalPlaybackVariant ?? "scale_context",
    harmonyPlaybackVariant: preset.harmonyPlaybackVariant ?? "block",
    toggles: { ...DEFAULT_TRAINING_TOGGLES, ...(preset.toggles ?? {}) },
  }));
  return {
    freePracticePresets: normalizedPresets,
    freePracticeToggles: { ...DEFAULT_TRAINING_TOGGLES, ...(raw.freePracticeToggles ?? {}) },
  };
}

export function setTrainingSettings(next: TrainingSettingsState) {
  writeLocal(KEY, next);
}

export function makeGuidedConfig(modePool?: TrainingMode[]): GeneratorConfig {
  return {
    sessionType: "guided",
    modePool: sanitizeTrainingModePool(modePool ?? getEnabledTrainingModes()),
    intervalLevel: 1,
    degreeLevel: 1,
    harmonyLevel: 1,
    timingLevel: 1,
    phraseLevel: 1,
    dictationInputMode: "multiple_choice",
    tonalMode: "major",
    intervalPlaybackVariant: "scale_context",
    harmonyPlaybackVariant: "block",
    randomTonicEvery: 3,
    singingQuota: 0.5,
    predictiveResolutionChance: 0.25,
  };
}
