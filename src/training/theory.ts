import { NOTE_NAMES, type NoteName, rootMidiFromKey } from "../audio/music";
import type { FunctionalRole, HarmonyQuality, StabilityClass, TonalMode } from "./types";

export const SOLFEGE_MAJOR = ["Do", "Re", "Mi", "Fa", "So", "La", "Ti"] as const;
export const DEGREE_LABELS = ["1", "2", "3", "4", "5", "6", "7"] as const;

const DEGREE_SEMITONES_BY_MODE: Record<TonalMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  modal: [0, 2, 4, 5, 7, 9, 10],
};

const STABILITY_BY_DEGREE_MAJOR: Record<string, StabilityClass> = {
  "1": "stable",
  "2": "moderately_unstable",
  "3": "stable",
  "4": "strong_tendency",
  "5": "stable",
  "6": "moderately_unstable",
  "7": "strong_tendency",
  b3: "moderately_unstable",
  "#4": "strong_tendency",
  b7: "moderately_unstable",
};

const STABILITY_EXPLANATIONS: Record<string, string> = {
  "1": "1 is stable because it is the tonal center.",
  "2": "2 is unstable because it leans toward 1 or 3.",
  "3": "3 is stable because it supports tonic color.",
  "4": "4 is unstable because it forms tension against tonic.",
  "5": "5 is stable because it reinforces tonic support.",
  "6": "6 is moderately unstable because it tends to move to 5 or 7.",
  "7": "7 is unstable because it resolves to 1.",
  b3: "b3 is unstable in major context because it colors toward minor.",
  "#4": "#4 is unstable because it intensifies pull to 5.",
  b7: "b7 is moderately unstable because it tends toward 6 or 1.",
};

const INTERVAL_NAME_BY_SEMITONE: Record<number, string> = {
  1: "m2",
  2: "M2",
  3: "m3",
  4: "M3",
  5: "P4",
  7: "P5",
  12: "P8",
};

const MOVEMENT_NOTE_BY_DEGREE: Partial<Record<string, string>> = {
  "7->1": "Leading tone resolves to tonic.",
  "4->3": "Subdominant tension resolves downward.",
  "2->1": "Supertonic relaxes to tonic.",
};

const HARMONY_FUNCTION_BY_QUALITY: Record<HarmonyQuality, FunctionalRole> = {
  major: "tonic",
  minor: "predominant",
  diminished: "dominant",
  augmented: "dominant",
  dominant7: "dominant",
  major7: "tonic",
  minor7: "predominant",
  half_diminished7: "dominant",
};

export function randomNoteName(exclude?: NoteName, sourcePool: readonly NoteName[] = NOTE_NAMES): NoteName {
  const pool = exclude ? sourcePool.filter((n) => n !== exclude) : [...sourcePool];
  return pool[Math.floor(Math.random() * pool.length)] as NoteName;
}

export function degreeSemitone(degreeLabel: string, tonalMode: TonalMode): number {
  if (degreeLabel === "b3") return 3;
  if (degreeLabel === "#4") return 6;
  if (degreeLabel === "b7") return 10;
  const idx = DEGREE_LABELS.indexOf(degreeLabel as (typeof DEGREE_LABELS)[number]);
  if (idx < 0) return 0;
  return DEGREE_SEMITONES_BY_MODE[tonalMode][idx];
}

export function degreeMidi(tonic: NoteName, octave: number, degreeLabel: string, tonalMode: TonalMode): number {
  return rootMidiFromKey(tonic, octave) + degreeSemitone(degreeLabel, tonalMode);
}

export function degreeSolfege(degreeLabel: string): string {
  const idx = DEGREE_LABELS.indexOf(degreeLabel as (typeof DEGREE_LABELS)[number]);
  return idx >= 0 ? SOLFEGE_MAJOR[idx] : degreeLabel;
}

export function stabilityForDegree(degreeLabel: string): StabilityClass {
  return STABILITY_BY_DEGREE_MAJOR[degreeLabel] ?? "moderately_unstable";
}

export function stabilityExplanation(degreeLabel: string): string {
  return STABILITY_EXPLANATIONS[degreeLabel] ?? `${degreeLabel} carries tension relative to tonic.`;
}

export function intervalNameFromSemitones(semitones: number): string {
  return INTERVAL_NAME_BY_SEMITONE[semitones] ?? `${semitones} semitones`;
}

export function movementLabel(fromDegree: string, toDegree: string): string {
  return `${fromDegree}->${toDegree}`;
}

export function movementExplanation(fromDegree: string, toDegree: string): string {
  return MOVEMENT_NOTE_BY_DEGREE[movementLabel(fromDegree, toDegree)] ?? "Hear this as motion relative to tonic.";
}

export function harmonyFunctionFromQuality(quality: HarmonyQuality): FunctionalRole {
  return HARMONY_FUNCTION_BY_QUALITY[quality];
}

export function qualityLabel(quality: HarmonyQuality): string {
  switch (quality) {
    case "major":
      return "Major";
    case "minor":
      return "Minor";
    case "diminished":
      return "Diminished";
    case "augmented":
      return "Augmented";
    case "dominant7":
      return "Dominant 7";
    case "major7":
      return "Major 7";
    case "minor7":
      return "Minor 7";
    case "half_diminished7":
      return "Half-diminished 7";
    default:
      return quality;
  }
}

export function harmonyQualitySet(level: 1 | 2): HarmonyQuality[] {
  if (level === 1) return ["major", "minor", "diminished", "augmented"];
  return ["major", "minor", "diminished", "augmented", "dominant7", "major7", "minor7", "half_diminished7"];
}
