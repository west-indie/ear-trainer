import type { PlaybackPlan } from "../audio/PlaybackEngine";
import type { NoteName } from "../audio/music";

export type TrainingMode = "scale_degree" | "functional_interval" | "functional_harmony" | "timing_grid" | "phrase_recall";
export type SessionType = "guided" | "free";

export type IntervalPlaybackVariant = "sequential_pause" | "immediate_jump" | "harmonic_stack" | "scale_context";
export type HarmonyPlaybackVariant = "block" | "arpeggiated" | "mixed";
export type TimingSubdivision = "quarter" | "eighth" | "triplet" | "sixteenth";
export type MeterSignature = "2/4" | "3/4" | "4/4";
export type PhraseTag = "stepwise" | "triadic" | "chromatic";
export type DictationInputMode = "multiple_choice" | "piano_grid" | "staff_entry";
export type TonalMode = "major" | "natural_minor" | "harmonic_minor" | "melodic_minor" | "modal";
export type StabilityClass = "stable" | "moderately_unstable" | "strong_tendency";
export type FunctionalRole = "tonic" | "predominant" | "dominant" | "other";
export type CadenceType = "authentic" | "plagal" | "half";
export type HarmonyQuestionKind = "quality" | "roman_path" | "cadence_type" | "changed_chord";
export type TimingQuestionKind = "echo_pattern" | "meter_pick" | "subdivision_pick" | "offbeat_pick";

export type IntervalLevel = 1 | 2 | 3 | 4;
export type DegreeLevel = 1 | 2 | 3;
export type HarmonyLevel = 1 | 2;
export type TimingLevel = 1 | 2 | 3;
export type PhraseLevel = 1 | 2 | 3;

export type HarmonyQuality =
  | "major"
  | "minor"
  | "diminished"
  | "augmented"
  | "dominant7"
  | "major7"
  | "minor7"
  | "half_diminished7";

export type TrainingUserToggles = {
  showAnswerNoteNames: boolean;
  allowPromptReplay: boolean;
  showExplainWhy: boolean;
  showIntervalNames: boolean;
  showSemitoneCount: boolean;
  showSolfege: boolean;
  enforceSinging: boolean;
  requireMicForSinging: boolean;
  droneEnabled: boolean;
  allowKeyboardInput: boolean;
  showChordTones: boolean;
  showScaleMap: boolean;
  showPianoStrip: boolean;
};

export type GeneratorConfig = {
  sessionType: SessionType;
  modePool: TrainingMode[];
  tonicPool?: NoteName[];
  intervalLevel: IntervalLevel;
  degreeLevel: DegreeLevel;
  harmonyLevel: HarmonyLevel;
  timingLevel: TimingLevel;
  phraseLevel: PhraseLevel;
  dictationInputMode: DictationInputMode;
  tonalMode: TonalMode;
  intervalPlaybackVariant: IntervalPlaybackVariant;
  harmonyPlaybackVariant: HarmonyPlaybackVariant;
  randomTonicEvery: number;
  singingQuota: number;
  predictiveResolutionChance: number;
};

export type SessionFocusStrategy = "none" | "due" | "weak";

export type BriefFeedback = {
  title: string;
  subtitle?: string;
  note?: string;
  explanation: string;
};

export type TeachingCopy = {
  lines: [string, ...string[]];
  more?: string;
  tendencyHint?: string;
};

export type CompareAudio = {
  label: string;
  description: string;
  playbackPlan: PlaybackPlan;
};

export type VisualCueData = {
  activeDegree?: string;
  movement?: {
    from: string;
    to: string;
  };
  timelineMidis?: number[];
};

export type TrainingQuestionBase = {
  id: string;
  mode: TrainingMode;
  tonic: NoteName;
  tonicMidi: number;
  prompt: string;
  playbackPlan: PlaybackPlan;
  answerChoices: string[];
  correctAnswer: string;
  enforceSinging: boolean;
  revealAfterSinging: boolean;
  adaptiveFocusKey: string;
  feedback: BriefFeedback;
  teaching: TeachingCopy;
  compareAudio?: CompareAudio;
  metadata: {
    intervalName?: string;
    semitones?: number;
    solfege?: string;
    stability?: StabilityClass;
    functionLabel?: FunctionalRole;
    functionLabels?: FunctionalRole[];
    chordQuality?: HarmonyQuality;
    chordTones?: string[];
    harmonyQuestionKind?: HarmonyQuestionKind;
    romanPath?: string[];
    cadenceType?: CadenceType;
    changedChordIndex?: number;
    changedFromRoman?: string;
    changedToRoman?: string;
    pullSummary?: string;
    tonalMode?: TonalMode;
    visualCue?: VisualCueData;
    countInBeats?: number;
    timing?: {
      questionKind: TimingQuestionKind;
      meter: MeterSignature;
      subdivision: TimingSubdivision;
      quantizeStepBeats: number;
      bars: number;
      targetBeats: number[];
      patternLengthBeats: number;
      supportsTapPad: boolean;
      showErrorOverlay: boolean;
    };
    phrase?: {
      bars: number;
      tag: PhraseTag;
      inputMode: DictationInputMode;
      expectedDegrees: string[];
      measureGroups: string[][];
      measurePlaybackPlans?: PlaybackPlan[];
      replayWithCountIn?: PlaybackPlan;
    };
  };
};

export type PredictiveResolutionMeta = {
  isPredictiveResolution: true;
  unstableDegree: string;
  expectedResolution: string;
};

export type TrainingQuestion = TrainingQuestionBase & {
  predictiveResolution?: PredictiveResolutionMeta;
};

export type ReviewItem = {
  originalQuestion: TrainingQuestion;
};
