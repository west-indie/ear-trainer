export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type CommonItemFields = {
  id: string;
  label: string;
  difficulty: Difficulty;
  tags?: string[];
  constraints?: {
    maxSemitones?: number;
    allowHarmonic?: boolean;
    allowMelodic?: boolean;
  };
};

export type IntervalItem = CommonItemFields & {
  kind: "interval";
  semitones: number; // e.g. 0..12
};

export type DegreeItem = CommonItemFields & {
  kind: "degree";
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  qualityHint?: "major" | "minor"; // for future
};

export type ChordItem = CommonItemFields & {
  kind: "chord";
  quality: "maj" | "min" | "dim" | "aug";
  inversion?: 0 | 1 | 2;
};

export type AnyItem = IntervalItem | DegreeItem | ChordItem;