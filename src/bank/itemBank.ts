import type { AnyItem } from "./types";

export const ItemBank: AnyItem[] = [
  // Intervals
  { kind: "interval", id: "int_m2", label: "m2", semitones: 1, difficulty: 2, tags: ["interval"] },
  { kind: "interval", id: "int_M2", label: "M2", semitones: 2, difficulty: 1, tags: ["interval"] },
  { kind: "interval", id: "int_m3", label: "m3", semitones: 3, difficulty: 2, tags: ["interval"] },
  { kind: "interval", id: "int_M3", label: "M3", semitones: 4, difficulty: 1, tags: ["interval"] },
  { kind: "interval", id: "int_P4", label: "P4", semitones: 5, difficulty: 2, tags: ["interval"] },
  { kind: "interval", id: "int_TT", label: "Tritone", semitones: 6, difficulty: 4, tags: ["interval"] },
  { kind: "interval", id: "int_P5", label: "P5", semitones: 7, difficulty: 2, tags: ["interval"] },
  { kind: "interval", id: "int_m6", label: "m6", semitones: 8, difficulty: 3, tags: ["interval"] },
  { kind: "interval", id: "int_M6", label: "M6", semitones: 9, difficulty: 3, tags: ["interval"] },
  { kind: "interval", id: "int_m7", label: "m7", semitones: 10, difficulty: 4, tags: ["interval"] },
  { kind: "interval", id: "int_M7", label: "M7", semitones: 11, difficulty: 4, tags: ["interval"] },
  { kind: "interval", id: "int_P8", label: "Octave", semitones: 12, difficulty: 2, tags: ["interval"] },

  // Scale degrees (relative to key tonic; Phase 0 keeps it simple)
  { kind: "degree", id: "deg_1", label: "1 (Do)", degree: 1, difficulty: 1, tags: ["degree"] },
  { kind: "degree", id: "deg_3", label: "3 (Mi)", degree: 3, difficulty: 2, tags: ["degree"] },
  { kind: "degree", id: "deg_5", label: "5 (So)", degree: 5, difficulty: 1, tags: ["degree"] },
  { kind: "degree", id: "deg_7", label: "7 (Ti)", degree: 7, difficulty: 4, tags: ["degree"] },

  // Chords (triads)
  { kind: "chord", id: "triad_maj", label: "Major triad", quality: "maj", difficulty: 1, tags: ["chord"] },
  { kind: "chord", id: "triad_min", label: "Minor triad", quality: "min", difficulty: 2, tags: ["chord"] },
  { kind: "chord", id: "triad_dim", label: "Diminished triad", quality: "dim", difficulty: 4, tags: ["chord"] },
  { kind: "chord", id: "triad_aug", label: "Augmented triad", quality: "aug", difficulty: 4, tags: ["chord"] },
];