import { NOTE_NAMES, type NoteName } from "../audio/music";
import { getEnabledTrainingModes, sanitizeTrainingModePool } from "./featureFlags";
import { DEFAULT_TRAINING_TOGGLES, type FreePracticePreset } from "../store/trainingStore";
import type { TrainingMode } from "../training/types";

export type QuickplayTonicSourceLevel = 1 | 2 | 3;
export type QuickplaySetup = Omit<FreePracticePreset, "id" | "name"> & { tonicPool?: NoteName[] };

export type QuickplayOptions = {
  modePool: TrainingMode[];
  tonicSourceLevel: QuickplayTonicSourceLevel;
  fixedTonic: NoteName;
  fixedPoolRoot: NoteName;
  intervalLevel: 1 | 2 | 3 | 4;
  degreeLevel: 1 | 2 | 3;
};

export const QUICKPLAY_TOPIC_OPTIONS: Array<{ mode: TrainingMode; title: string }> = [
  { mode: "functional_interval", title: "Intervals" },
  { mode: "scale_degree", title: "Scale Degrees" },
  { mode: "functional_harmony", title: "Harmony" },
  { mode: "timing_grid", title: "Rhythm" },
  { mode: "phrase_recall", title: "Phrases" },
];

export const QUICKPLAY_INTERVAL_LEVEL_COPY: Record<1 | 2 | 3 | 4, string> = {
  1: "Level 1: seconds only.",
  2: "Level 2: add 3rds.",
  3: "Level 3: add 4ths and 5ths.",
  4: "Level 4: add octaves.",
};

export const QUICKPLAY_TONIC_SOURCE_COPY: Record<QuickplayTonicSourceLevel, string> = {
  1: "Level 1: fixed tonic for the whole run.",
  2: "Level 2: limited tonic pool that rotates inside one 3-key set.",
  3: "Level 3: fully randomized across all 12 tonics.",
};

const CIRCLE_OF_FIFTHS: NoteName[] = ["C", "G", "D", "A", "E", "B", "Gb", "Db", "Ab", "Eb", "Bb", "F"];

type QuickplayPresetDefinition = {
  id: string;
  name: string;
  settings: QuickplaySetup;
};

export const QUICKPLAY_DEFAULT_PRESET_ID = "quickplay_default";

const QUICKPLAY_PRESETS: Record<string, QuickplayPresetDefinition> = {
  default: {
    id: QUICKPLAY_DEFAULT_PRESET_ID,
    name: "Quickplay",
    settings: {
      modePool: sanitizeTrainingModePool(["scale_degree", "functional_interval"]),
      tonicMode: "random",
      fixedTonic: "C",
      tonicPool: undefined,
      intervalLevel: 1,
      degreeLevel: 1,
      harmonyLevel: 1,
      timingLevel: 1,
      phraseLevel: 1,
      dictationInputMode: "multiple_choice",
      tonalMode: "major",
      intervalPlaybackVariant: "scale_context",
      harmonyPlaybackVariant: "block",
      toggles: {
        ...DEFAULT_TRAINING_TOGGLES,
        showAnswerNoteNames: true,
        allowPromptReplay: true,
        droneEnabled: true,
        enforceSinging: true,
        requireMicForSinging: false,
        showExplainWhy: true,
        showIntervalNames: true,
        showSolfege: true,
        showScaleMap: true,
        showPianoStrip: true,
      },
    },
  },
};

export function getQuickplayPresetDefinition(presetId: string | null | undefined = "default") {
  return QUICKPLAY_PRESETS[presetId ?? "default"] ?? QUICKPLAY_PRESETS.default;
}

export function quickplayPoolOptions(): Array<{ value: NoteName; label: string }> {
  return CIRCLE_OF_FIFTHS.map((root) => ({
    value: root,
    label: buildQuickplayTonicPool(root).join(" / "),
  }));
}

export function buildQuickplayTonicPool(root: NoteName): NoteName[] {
  const idx = CIRCLE_OF_FIFTHS.indexOf(root);
  const previous = CIRCLE_OF_FIFTHS[(idx + CIRCLE_OF_FIFTHS.length - 1) % CIRCLE_OF_FIFTHS.length];
  const next = CIRCLE_OF_FIFTHS[(idx + 1) % CIRCLE_OF_FIFTHS.length];
  return [root, next, previous];
}

export function sanitizeQuickplayModePool(modePool: TrainingMode[]) {
  const next = sanitizeTrainingModePool(modePool);
  return next.length > 0 ? next : sanitizeTrainingModePool(getEnabledTrainingModes());
}

export function resolveQuickplayPreset(presetId: string | null | undefined, options: QuickplayOptions) {
  const preset = getQuickplayPresetDefinition(presetId);
  const sanitizedModePool = sanitizeQuickplayModePool(options.modePool);
  const tonicPool = options.tonicSourceLevel === 2 ? buildQuickplayTonicPool(options.fixedPoolRoot) : undefined;
  const tonicMode = options.tonicSourceLevel === 1 ? "fixed" : "random";
  const fixedTonic = options.tonicSourceLevel === 1 ? options.fixedTonic : (tonicPool?.[0] ?? NOTE_NAMES[0]);

  return {
    presetId: preset.id,
    settings: {
      ...preset.settings,
      modePool: sanitizedModePool,
      tonicMode,
      fixedTonic,
      tonicPool,
      intervalLevel: options.intervalLevel,
      degreeLevel: options.degreeLevel,
    } satisfies QuickplaySetup,
  };
}
