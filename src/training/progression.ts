import { midiToFreq } from "../audio/music";
import type { ScheduledEvent } from "../audio/scheduler";
import type {
  CadenceType,
  FunctionalRole,
  HarmonyPlaybackVariant,
  TonalMode,
  TrainingQuestionBase,
} from "./types";

export type ProgressionStage = 1 | 2 | 3;

export type ProgressionTemplate = {
  romanPath: string[];
  cadenceType: CadenceType;
  stage: ProgressionStage;
  tonalFamily: "major" | "minor";
};

const PROGRESSION_TEMPLATES: ProgressionTemplate[] = [
  { romanPath: ["I", "V"], cadenceType: "half", stage: 1, tonalFamily: "major" },
  { romanPath: ["I", "IV"], cadenceType: "half", stage: 1, tonalFamily: "major" },
  { romanPath: ["I", "IV", "V"], cadenceType: "half", stage: 2, tonalFamily: "major" },
  { romanPath: ["ii", "V", "I"], cadenceType: "authentic", stage: 2, tonalFamily: "major" },
  { romanPath: ["I", "IV", "I"], cadenceType: "plagal", stage: 2, tonalFamily: "major" },
  { romanPath: ["I", "ii", "V", "I"], cadenceType: "authentic", stage: 3, tonalFamily: "major" },
  { romanPath: ["I", "IV", "V", "I"], cadenceType: "authentic", stage: 3, tonalFamily: "major" },
  { romanPath: ["i", "iv", "V"], cadenceType: "half", stage: 2, tonalFamily: "minor" },
  { romanPath: ["i", "iv", "i"], cadenceType: "plagal", stage: 2, tonalFamily: "minor" },
  { romanPath: ["i", "iv", "V", "i"], cadenceType: "authentic", stage: 3, tonalFamily: "minor" },
];

function tonalFamily(tonalMode: TonalMode): "major" | "minor" {
  return tonalMode.includes("minor") ? "minor" : "major";
}

function maxStageForLevel(level: 1 | 2): ProgressionStage {
  return level === 1 ? 1 : 3;
}

function triadFromRoot(rootMidi: number, quality: "major" | "minor" | "diminished"): number[] {
  if (quality === "major") return [rootMidi, rootMidi + 4, rootMidi + 7];
  if (quality === "minor") return [rootMidi, rootMidi + 3, rootMidi + 7];
  return [rootMidi, rootMidi + 3, rootMidi + 6];
}

function normalizedRoman(roman: string): string {
  return roman.replace(/[0-9]/g, "");
}

function romanSpec(roman: string, mode: TonalMode): { rootOffset: number; quality: "major" | "minor" | "diminished" } {
  const normalized = normalizedRoman(roman);
  if (mode === "major") {
    const table: Record<string, { rootOffset: number; quality: "major" | "minor" | "diminished" }> = {
      I: { rootOffset: 0, quality: "major" },
      ii: { rootOffset: 2, quality: "minor" },
      iii: { rootOffset: 4, quality: "minor" },
      IV: { rootOffset: 5, quality: "major" },
      V: { rootOffset: 7, quality: "major" },
      vi: { rootOffset: 9, quality: "minor" },
      vii: { rootOffset: 11, quality: "diminished" },
    };
    return table[normalized] ?? table.I;
  }

  const table: Record<string, { rootOffset: number; quality: "major" | "minor" | "diminished" }> = {
    i: { rootOffset: 0, quality: "minor" },
    ii: { rootOffset: 2, quality: "diminished" },
    III: { rootOffset: 3, quality: "major" },
    iv: { rootOffset: 5, quality: "minor" },
    V: { rootOffset: 7, quality: "major" },
    VI: { rootOffset: 8, quality: "major" },
    VII: { rootOffset: 10, quality: "major" },
  };
  return table[normalized] ?? table.i;
}

export function progressionPool(tonalMode: TonalMode, level: 1 | 2): ProgressionTemplate[] {
  const family = tonalFamily(tonalMode);
  const maxStage = maxStageForLevel(level);
  return PROGRESSION_TEMPLATES.filter((template) => template.tonalFamily === family && template.stage <= maxStage);
}

export function progressionToLabel(romanPath: string[]): string {
  return romanPath.join(" - ");
}

export function cadenceLabel(cadence: CadenceType): string {
  if (cadence === "authentic") return "Authentic";
  if (cadence === "plagal") return "Plagal";
  return "Half";
}

export function functionFromRoman(roman: string): FunctionalRole {
  const normalized = normalizedRoman(roman);
  if (normalized === "I" || normalized === "i" || normalized === "vi" || normalized === "VI" || normalized === "iii" || normalized === "III") {
    return "tonic";
  }
  if (normalized === "ii" || normalized === "IV" || normalized === "iv") return "predominant";
  if (normalized === "V" || normalized === "vii" || normalized === "VII") return "dominant";
  return "other";
}

export function pullDescription(role: FunctionalRole): string {
  if (role === "tonic") return "rests and confirms the key center.";
  if (role === "predominant") return "moves away from rest and points toward dominant tension.";
  if (role === "dominant") return "creates strong pull back toward tonic.";
  return "adds color without a strong directional pull.";
}

export function progressionPullSummary(romanPath: string[]): string {
  return romanPath
    .map((roman) => {
      const role = functionFromRoman(roman);
      return `${roman}: ${role} (${pullDescription(role)})`;
    })
    .join(" ");
}

export function progressionChordMidis(tonicMidi: number, tonalMode: TonalMode, romanPath: string[]): number[][] {
  return romanPath.map((roman) => {
    const spec = romanSpec(roman, tonalMode);
    return triadFromRoot(tonicMidi + spec.rootOffset, spec.quality);
  });
}

export function buildProgressionPlayback(
  variant: HarmonyPlaybackVariant,
  tonicMidi: number,
  chordSequence: number[][]
): TrainingQuestionBase["playbackPlan"] {
  const events: ScheduledEvent[] = [];
  const tonicAnchor = [tonicMidi, tonicMidi + 4, tonicMidi + 7];
  events.push({ atBeats: 0, durationBeats: 0.8, freqsHz: tonicAnchor.map(midiToFreq), gain: 0.62 });

  chordSequence.forEach((chord, idx) => {
    const at = 0.95 + idx * 0.95;
    events.push({ atBeats: at, durationBeats: 0.35, freqHz: midiToFreq(tonicMidi - 12), gain: 0.4 });
    if (variant === "block") {
      events.push({ atBeats: at, durationBeats: 0.8, freqsHz: chord.map(midiToFreq), gain: 0.8 });
      return;
    }
    if (variant === "arpeggiated") {
      events.push({ atBeats: at, durationBeats: 0.24, freqHz: midiToFreq(chord[0]), gain: 0.82 });
      events.push({ atBeats: at + 0.24, durationBeats: 0.24, freqHz: midiToFreq(chord[1]), gain: 0.82 });
      events.push({ atBeats: at + 0.48, durationBeats: 0.24, freqHz: midiToFreq(chord[2]), gain: 0.84 });
      return;
    }
    events.push({ atBeats: at, durationBeats: 0.22, freqHz: midiToFreq(chord[0]), gain: 0.82 });
    events.push({ atBeats: at + 0.24, durationBeats: 0.52, freqsHz: chord.map(midiToFreq), gain: 0.78 });
  });

  return { kind: "sequence", events };
}

function romanVocabularyForMode(tonalMode: TonalMode): string[] {
  if (tonalMode === "major") return ["I", "ii", "iii", "IV", "V", "vi", "vii"];
  return ["i", "ii", "III", "iv", "V", "VI", "VII"];
}

export function changedChordVariant(input: {
  tonalMode: TonalMode;
  romanPath: string[];
}): { changedPath: string[]; index: number; from: string; to: string } | null {
  const { tonalMode, romanPath } = input;
  if (romanPath.length < 2) return null;
  const index = 1 + Math.floor(Math.random() * (romanPath.length - 1));
  const from = romanPath[index];
  const alternatives = romanVocabularyForMode(tonalMode).filter((roman) => roman !== from);
  if (alternatives.length === 0) return null;
  const to = alternatives[Math.floor(Math.random() * alternatives.length)];
  const changedPath = [...romanPath];
  changedPath[index] = to;
  return { changedPath, index, from, to };
}

export function stageChoiceCount(stage: ProgressionStage): 2 | 3 | 4 {
  if (stage === 1) return 2;
  if (stage === 2) return 3;
  return 4;
}
