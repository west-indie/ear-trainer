import type { AnyItem } from "../bank/types";
import type { Question } from "./types";
import { buildTriad, rootMidiFromKey, transposeMidi } from "../audio/music";
import type { AppSettings } from "../store/settingsStore";
import { midiToFreq } from "../audio/music";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildQuestionFromItem(item: AnyItem, settings: AppSettings): Question {
  const tonic = rootMidiFromKey(settings.keyRoot, settings.octave);

  if (item.kind === "interval") {
    const root = tonic; // Phase 0: always from tonic
    const other = transposeMidi(root, item.semitones);

    // melodic up in two beats
    const playbackPlan = {
      kind: "sequence" as const,
      events: [
        { atBeats: 0, durationBeats: 1, freqHz: midiToFreq(root), gain: 0.9 },
        { atBeats: 1, durationBeats: 1, freqHz: midiToFreq(other), gain: 0.9 },
      ],
    };

    const choices = shuffle(["m2","M2","m3","M3","P4","Tritone","P5","m6","M6","m7","M7","Octave"])
      .slice(0, 3);
    const correct = item.label === "Octave" ? "Octave" : item.label;
    const answerChoices = shuffle(Array.from(new Set([correct, ...choices]))).slice(0, 4);

    return {
      id: `q_${uid()}`,
      prompt: "Identify the interval (melodic, ascending).",
      correctAnswer: correct,
      answerChoices,
      playbackPlan,
      metadata: {
        itemId: item.id,
        itemKind: item.kind,
        difficulty: item.difficulty,
        tags: item.tags,
      },
    };
  }

  if (item.kind === "degree") {
    const degreeToSemisMajor = [0, 2, 4, 5, 7, 9, 11]; // 1..7
    const semis = degreeToSemisMajor[item.degree - 1];
    const target = tonic + semis;

    // tonic then degree (simple)
    const playbackPlan = {
      kind: "sequence" as const,
      events: [
        { atBeats: 0, durationBeats: 1, freqHz: midiToFreq(tonic), gain: 0.9 },
        { atBeats: 1, durationBeats: 1, freqHz: midiToFreq(target), gain: 0.9 },
      ],
    };

    const all = ["1 (Do)","2 (Re)","3 (Mi)","4 (Fa)","5 (So)","6 (La)","7 (Ti)"];
    const correct = item.label;
    const choices = shuffle(all.filter((x) => x !== correct)).slice(0, 3);
    const answerChoices = shuffle([correct, ...choices]);

    return {
      id: `q_${uid()}`,
      prompt: `Which scale degree is this (in ${settings.keyRoot} major)?`,
      correctAnswer: correct,
      answerChoices,
      playbackPlan,
      metadata: {
        itemId: item.id,
        itemKind: item.kind,
        difficulty: item.difficulty,
        tags: item.tags,
      },
    };
  }

  // chord
  const midis = buildTriad(tonic, item.quality);
  const playbackPlan = { kind: "chord" as const, midis, durationBeats: 2 };

  const all = ["Major triad", "Minor triad", "Diminished triad", "Augmented triad"];
  const correct = item.label;
  const choices = shuffle(all.filter((x) => x !== correct)).slice(0, 3);

  return {
    id: `q_${uid()}`,
    prompt: "Identify the chord quality.",
    correctAnswer: correct,
    answerChoices: shuffle([correct, ...choices]),
    playbackPlan,
    metadata: {
      itemId: item.id,
      itemKind: item.kind,
      difficulty: item.difficulty,
      tags: item.tags,
    },
  };
}
