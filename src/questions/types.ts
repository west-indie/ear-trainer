import type { PlaybackPlan } from "../audio/PlaybackEngine";
import type { AnyItem } from "../bank/types";

export type Question = {
  id: string; // generated
  prompt: string;
  correctAnswer: string;
  answerChoices: string[];
  playbackPlan: PlaybackPlan;
  metadata: {
    itemId: string;
    itemKind: AnyItem["kind"];
    difficulty: number;
    tags?: string[];
  };
};