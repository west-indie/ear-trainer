import { midiToFreq, rootMidiFromKey, type NoteName } from "../audio/music";
import { findAuthoredDrill } from "../store/contentStore";
import { adaptiveWeightForKey } from "../store/progressStore";
import type { GeneratorConfig, HarmonyQuality, TrainingMode, TrainingQuestion, TrainingQuestionBase } from "./types";
import { makePhrasePattern } from "./phrase";
import {
  buildProgressionPlayback,
  cadenceLabel,
  changedChordVariant,
  functionFromRoman,
  progressionChordMidis,
  progressionPool,
  progressionPullSummary,
  progressionToLabel,
  pullDescription,
  stageChoiceCount,
  type ProgressionTemplate,
} from "./progression";
import {
  DEGREE_LABELS,
  degreeMidi,
  degreeSemitone,
  degreeSolfege,
  harmonyFunctionFromQuality,
  harmonyQualitySet,
  intervalNameFromSemitones,
  movementExplanation,
  movementLabel,
  qualityLabel,
  randomNoteName,
  stabilityExplanation,
  stabilityForDegree,
} from "./theory";
import { makeTimingPattern } from "./timing";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function pickWeighted<T>(items: T[], weightFor: (item: T) => number): T {
  const weighted = items.map((item) => ({ item, weight: Math.max(0.01, weightFor(item)) }));
  const total = weighted.reduce((sum, it) => sum + it.weight, 0);
  let cursor = Math.random() * total;
  for (const it of weighted) {
    cursor -= it.weight;
    if (cursor <= 0) return it.item;
  }
  return weighted[weighted.length - 1].item;
}

function pickMatchingOrWeighted<T>(items: T[], matches: (item: T) => boolean, weightFor: (item: T) => number): T {
  const direct = items.find(matches);
  if (direct) return direct;
  return pickWeighted(items, weightFor);
}

function sampleDistinct<T>(arr: T[], count: number, exclude: T): T[] {
  const pool = arr.filter((x) => x !== exclude);
  const out: T[] = [];
  while (pool.length > 0 && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function modeByMix(pool: TrainingMode[]): TrainingMode {
  const seededPool: TrainingMode[] = pool.length > 0 ? pool : ["scale_degree", "functional_interval", "functional_harmony"];
  return pickWeighted(seededPool, (mode) => {
    if (mode === "scale_degree") return 4;
    if (mode === "functional_interval") return 4;
    if (mode === "functional_harmony") return 2;
    if (mode === "timing_grid") return 3;
    return 2.8;
  });
}

function degreePool(level: 1 | 2 | 3): string[] {
  if (level === 1) return ["1", "2", "3", "4", "5"];
  if (level === 2) return [...DEGREE_LABELS];
  return [...DEGREE_LABELS, "b3", "#4", "b7"];
}

function intervalMovementPool(level: 1 | 2 | 3 | 4): Array<[string, string]> {
  if (level === 1) {
    return [
      ["1", "2"],
      ["2", "1"],
      ["2", "3"],
      ["3", "2"],
      ["3", "4"],
      ["4", "3"],
      ["4", "5"],
      ["5", "4"],
    ];
  }
  if (level === 2) {
    return [
      ...intervalMovementPool(1),
      ["1", "3"],
      ["3", "1"],
      ["2", "4"],
      ["4", "2"],
      ["3", "5"],
      ["5", "3"],
    ];
  }
  if (level === 3) {
    return [
      ...intervalMovementPool(2),
      ["1", "4"],
      ["4", "1"],
      ["1", "5"],
      ["5", "1"],
      ["2", "5"],
      ["5", "2"],
    ];
  }
  return [...intervalMovementPool(3), ["1", "1"]];
}

function movementDirection(
  movement: [string, string],
  tonalMode: GeneratorConfig["tonalMode"]
): "ascending" | "descending" {
  const [fromDegree, toDegree] = movement;
  const fromSemitones = degreeSemitone(fromDegree, tonalMode);
  const toSemitones = degreeSemitone(toDegree, tonalMode);
  if (toSemitones < fromSemitones) return "descending";
  return "ascending";
}

function buildBalancedMovementChoices(
  correctMovement: [string, string],
  pool: Array<[string, string]>,
  tonalMode: GeneratorConfig["tonalMode"]
): string[] {
  const correctLabel = `${correctMovement[0]}->${correctMovement[1]}`;
  const correctDirection = movementDirection(correctMovement, tonalMode);
  // The final 4 choices should always contain 2 ascending and 2 descending
  // movements. The correct answer occupies one slot in its own direction.
  const sameDirectionDistractorCount = 1;
  const oppositeDirectionDistractorCount = 2;

  const sameDirectionPool = pool
    .filter((movement) => `${movement[0]}->${movement[1]}` !== correctLabel)
    .filter((movement) => movementDirection(movement, tonalMode) === correctDirection)
    .map(([fromDegree, toDegree]) => `${fromDegree}->${toDegree}`);

  const oppositeDirectionPool = pool
    .filter((movement) => movementDirection(movement, tonalMode) !== correctDirection)
    .map(([fromDegree, toDegree]) => `${fromDegree}->${toDegree}`);

  const choices = [
    correctLabel,
    ...sampleDistinct(sameDirectionPool, sameDirectionDistractorCount, correctLabel),
    ...sampleDistinct(oppositeDirectionPool, oppositeDirectionDistractorCount, correctLabel),
  ];

  return choices.sort(() => Math.random() - 0.5);
}

function buildIntervalPlayback(
  variant: "sequential_pause" | "immediate_jump" | "harmonic_stack" | "scale_context",
  tonicMidi: number,
  fromMidi: number,
  toMidi: number
): TrainingQuestionBase["playbackPlan"] {
  if (variant === "harmonic_stack") {
    return { kind: "chord", midis: [fromMidi, toMidi], durationBeats: 1.6, gain: 0.82 };
  }

  if (variant === "immediate_jump") {
    return {
      kind: "sequence",
      events: [
        { atBeats: 0, durationBeats: 0.5, freqHz: midiToFreq(fromMidi), gain: 0.88 },
        { atBeats: 0.55, durationBeats: 0.75, freqHz: midiToFreq(toMidi), gain: 0.9 },
      ],
    };
  }

  if (variant === "sequential_pause") {
    return {
      kind: "sequence",
      events: [
        { atBeats: 0, durationBeats: 0.65, freqHz: midiToFreq(fromMidi), gain: 0.88 },
        { atBeats: 1.2, durationBeats: 0.75, freqHz: midiToFreq(toMidi), gain: 0.9 },
      ],
    };
  }

  return {
    kind: "sequence",
    events: [
      { atBeats: 0, durationBeats: 0.7, freqHz: midiToFreq(tonicMidi), gain: 0.75 },
      { atBeats: 0.85, durationBeats: 0.5, freqHz: midiToFreq(fromMidi), gain: 0.86 },
      { atBeats: 1.45, durationBeats: 0.5, freqHz: midiToFreq(toMidi), gain: 0.9 },
    ],
  };
}

function buildHarmonyChord(tonicMidi: number, quality: ReturnType<typeof harmonyQualitySet>[number]): number[] {
  if (quality === "major") return [tonicMidi, tonicMidi + 4, tonicMidi + 7];
  if (quality === "minor") return [tonicMidi, tonicMidi + 3, tonicMidi + 7];
  if (quality === "diminished") return [tonicMidi, tonicMidi + 3, tonicMidi + 6];
  if (quality === "augmented") return [tonicMidi, tonicMidi + 4, tonicMidi + 8];
  if (quality === "dominant7") return [tonicMidi, tonicMidi + 4, tonicMidi + 7, tonicMidi + 10];
  if (quality === "major7") return [tonicMidi, tonicMidi + 4, tonicMidi + 7, tonicMidi + 11];
  if (quality === "minor7") return [tonicMidi, tonicMidi + 3, tonicMidi + 7, tonicMidi + 10];
  return [tonicMidi, tonicMidi + 3, tonicMidi + 6, tonicMidi + 10];
}

function buildHarmonyPlayback(
  variant: "block" | "arpeggiated" | "mixed",
  tonicMidi: number,
  chordMidis: number[]
): TrainingQuestionBase["playbackPlan"] {
  const tonicTriad = [tonicMidi, tonicMidi + 4, tonicMidi + 7];
  if (variant === "block") {
    return {
      kind: "sequence",
      events: [
        { atBeats: 0, durationBeats: 1, freqsHz: tonicTriad.map(midiToFreq), gain: 0.68 },
        { atBeats: 1.2, durationBeats: 1.2, freqsHz: chordMidis.map(midiToFreq), gain: 0.78 },
      ],
    };
  }

  if (variant === "arpeggiated") {
    const chordEvents = chordMidis.map((midi, index) => ({
      atBeats: 1.05 + index * 0.45,
      durationBeats: 0.35,
      freqHz: midiToFreq(midi),
      gain: 0.82,
    }));
    return {
      kind: "sequence",
      events: [
        { atBeats: 0, durationBeats: 0.8, freqsHz: tonicTriad.map(midiToFreq), gain: 0.66 },
        ...chordEvents,
      ],
    };
  }

  return {
    kind: "sequence",
    events: [
      { atBeats: 0, durationBeats: 0.8, freqsHz: tonicTriad.map(midiToFreq), gain: 0.66 },
      { atBeats: 1, durationBeats: 0.35, freqHz: midiToFreq(chordMidis[0]), gain: 0.8 },
      { atBeats: 1.45, durationBeats: 0.35, freqHz: midiToFreq(chordMidis[1]), gain: 0.8 },
      { atBeats: 1.9, durationBeats: 0.35, freqHz: midiToFreq(chordMidis[2]), gain: 0.8 },
      { atBeats: 2.4, durationBeats: 0.95, freqsHz: chordMidis.map(midiToFreq), gain: 0.78 },
    ],
  };
}

function nearestDegreeNeighbor(target: string, pool: string[], tonalMode: GeneratorConfig["tonalMode"]): string | null {
  const candidates = pool.filter((degree) => degree !== target);
  if (candidates.length === 0) return null;
  const targetSemitone = degreeSemitone(target, tonalMode);
  return candidates
    .map((degree) => ({ degree, distance: Math.abs(targetSemitone - degreeSemitone(degree, tonalMode)) }))
    .sort((a, b) => a.distance - b.distance)[0]?.degree ?? null;
}

function nearestQualityNeighbor(quality: HarmonyQuality): HarmonyQuality {
  const map: Record<HarmonyQuality, HarmonyQuality> = {
    major: "minor",
    minor: "major",
    diminished: "minor",
    augmented: "major",
    dominant7: "major7",
    major7: "dominant7",
    minor7: "dominant7",
    half_diminished7: "diminished",
  };
  return map[quality];
}

function progressionTemplateKey(romanPath: string[]): string {
  return progressionToLabel(romanPath);
}

function pickProgressionTemplate(input: {
  config: GeneratorConfig;
  forcedAdaptiveKey?: string;
  adaptiveContextKey?: string;
}): ProgressionTemplate {
  const pool = progressionPool(input.config.tonalMode, input.config.harmonyLevel);
  const forcedPath = input.forcedAdaptiveKey?.startsWith("progression:")
    ? input.forcedAdaptiveKey.slice("progression:".length)
    : null;
  return pickMatchingOrWeighted(
    pool,
    (template) => progressionTemplateKey(template.romanPath) === forcedPath,
    (template) => adaptiveWeightForKey(`progression:${progressionTemplateKey(template.romanPath)}`, { contextKey: input.adaptiveContextKey })
  );
}

function progressionQuestionKindForStage(stage: 1 | 2 | 3): "roman_path" | "cadence_type" | "changed_chord" {
  if (stage === 1) return Math.random() < 0.75 ? "roman_path" : "cadence_type";
  if (stage === 2) return Math.random() < 0.55 ? "roman_path" : "cadence_type";
  return pickWeighted(["roman_path", "cadence_type", "changed_chord"] as const, (kind) => (kind === "changed_chord" ? 1.4 : 1));
}

function cadenceChoices(cadenceType: "authentic" | "plagal" | "half", stage: 1 | 2 | 3): string[] {
  const pool = ["Authentic", "Plagal", "Half"];
  const correct = cadenceLabel(cadenceType);
  const count = stage === 1 ? 2 : stage === 2 ? 3 : 3;
  return [correct, ...sampleDistinct(pool, count - 1, correct)].sort(() => Math.random() - 0.5);
}

function changedChordPositionChoices(length: number, index: number, stage: 1 | 2 | 3): string[] {
  const labels = Array.from({ length }, (_, i) => `Chord ${i + 1}`);
  const correct = labels[index];
  const choiceCount = Math.min(stageChoiceCount(stage), labels.length);
  return [correct, ...sampleDistinct(labels, choiceCount - 1, correct)].sort(() => Math.random() - 0.5);
}

function baseQuestion(args: Omit<TrainingQuestionBase, "id">): TrainingQuestionBase {
  return { id: `q_${uid()}`, ...args };
}

function applyAuthoredOverlay(question: TrainingQuestion): TrainingQuestion {
  const authored = findAuthoredDrill(question.mode, question.adaptiveFocusKey);
  if (!authored) return question;
  return {
    ...question,
    prompt: authored.promptOverride.trim() || question.prompt,
    feedback: {
      ...question.feedback,
      title: authored.explanationTitle.trim() || question.feedback.title,
      explanation: authored.explanationBody.trim() || question.feedback.explanation,
    },
    teaching: {
      ...question.teaching,
      lines: authored.coachingNotes.length > 0
        ? [authored.coachingNotes[0], ...authored.coachingNotes.slice(1)] as [string, ...string[]]
        : question.teaching.lines,
      more: authored.moreBody.trim() || question.teaching.more,
    },
  };
}

export function generateTrainingQuestion(input: {
  config: GeneratorConfig;
  questionIndex: number;
  previousTonic: NoteName;
  tonicOctave: number;
  shouldForceSinging: boolean;
  forcedMode?: TrainingMode;
  forcedAdaptiveKey?: string;
  adaptiveContextKey?: string;
}): TrainingQuestion {
  const { config, questionIndex, previousTonic, tonicOctave, shouldForceSinging, forcedMode, forcedAdaptiveKey, adaptiveContextKey } = input;
  const shouldShiftTonic =
    config.randomTonicEvery > 0
    && questionIndex > 0
    && questionIndex % config.randomTonicEvery === 0;
  const tonic = shouldShiftTonic ? randomNoteName(previousTonic, config.tonicPool) : previousTonic;
  const tonicMidi = rootMidiFromKey(tonic, tonicOctave);
  const pickedMode = forcedMode ?? modeByMix(config.modePool);

  if (pickedMode === "scale_degree") {
    const pool = degreePool(config.degreeLevel);
    const forcedDegree = forcedAdaptiveKey?.startsWith("degree:") ? forcedAdaptiveKey.slice("degree:".length) : null;
    const correct = pickMatchingOrWeighted(
      pool,
      (degree) => degree === forcedDegree,
      (degree) => adaptiveWeightForKey(`degree:${degree}`, { contextKey: adaptiveContextKey })
    );
    const choices = [correct, ...sampleDistinct(pool, 3, correct)];
    const doPredictive = Math.random() < config.predictiveResolutionChance && pool.includes("7");
    if (doPredictive) {
      const unstableMidi = degreeMidi(tonic, tonicOctave, "7", config.tonalMode);
      return applyAuthoredOverlay({
        ...baseQuestion({
          mode: "scale_degree",
          tonic,
          tonicMidi,
          prompt: "Where does this unstable degree want to resolve?",
          playbackPlan: {
            kind: "sequence",
            events: [
              { atBeats: 0, durationBeats: 0.7, freqHz: midiToFreq(tonicMidi), gain: 0.75 },
              {
                atBeats: 0.9,
                durationBeats: 0.85,
                freqHz: midiToFreq(unstableMidi),
                gain: 0.86,
              },
            ],
          },
          answerChoices: ["1", "6", "5", "2"],
          correctAnswer: "1",
          enforceSinging: shouldForceSinging,
          revealAfterSinging: shouldForceSinging,
          adaptiveFocusKey: "resolution:7->1",
          feedback: {
            title: "7 -> 1",
            subtitle: "Leading tone resolves to tonic.",
            explanation: "7 is unstable because it resolves to 1.",
          },
          teaching: {
            lines: [
              "This pitch sits one semitone below tonic, so your ear expects closure.",
              "When it rises to 1, tension drops immediately.",
            ],
            more: "In tonal melodies, this pull helps define the key center and makes cadences feel complete.",
            tendencyHint: "Leading tone tendency: 7 usually resolves up to 1.",
          },
          compareAudio: {
            label: "Play nearby pull",
            description: "Compare 7 against 6 before hearing the tonic.",
            playbackPlan: {
              kind: "sequence",
              events: [
                { atBeats: 0, durationBeats: 0.55, freqHz: midiToFreq(tonicMidi), gain: 0.72 },
                { atBeats: 0.65, durationBeats: 0.55, freqHz: midiToFreq(degreeMidi(tonic, tonicOctave, "6", config.tonalMode)), gain: 0.84 },
                { atBeats: 1.35, durationBeats: 0.55, freqHz: midiToFreq(unstableMidi), gain: 0.88 },
                { atBeats: 2.05, durationBeats: 0.75, freqHz: midiToFreq(tonicMidi), gain: 0.9 },
              ],
            },
          },
          metadata: {
            stability: "strong_tendency",
            solfege: "Ti -> Do",
            tonalMode: config.tonalMode,
            visualCue: {
              activeDegree: "7",
              movement: { from: "7", to: "1" },
              timelineMidis: [tonicMidi, unstableMidi],
            },
          },
        }),
        predictiveResolution: {
          isPredictiveResolution: true,
          unstableDegree: "7",
          expectedResolution: "1",
        },
      });
    }

    const stable = stabilityForDegree(correct);
    const targetMidi = degreeMidi(tonic, tonicOctave, correct, config.tonalMode);
    const neighborDegree = nearestDegreeNeighbor(correct, pool, config.tonalMode);
    const neighborMidi = neighborDegree ? degreeMidi(tonic, tonicOctave, neighborDegree, config.tonalMode) : null;
    return applyAuthoredOverlay(baseQuestion({
      mode: "scale_degree",
      tonic,
      tonicMidi,
      prompt: "Identify the scale degree against tonic.",
      playbackPlan: {
        kind: "sequence",
        events: [
          { atBeats: 0, durationBeats: 0.72, freqHz: midiToFreq(tonicMidi), gain: 0.76 },
          {
            atBeats: 0.95,
            durationBeats: 0.95,
            freqHz: midiToFreq(targetMidi),
            gain: 0.88,
          },
        ],
      },
      answerChoices: choices.sort(() => Math.random() - 0.5),
      correctAnswer: correct,
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `degree:${correct}`,
      feedback: {
        title: `Degree ${correct}`,
        subtitle: stable.replace("_", " "),
        explanation: stabilityExplanation(correct),
      },
      teaching: {
        lines: [
          `Hear degree ${correct} as a color measured from tonic.`,
          stabilityExplanation(correct),
        ],
        more: `In ${config.tonalMode.replace("_", " ")}, this degree gets its identity from distance to 1 and nearby tendency tones.`,
        tendencyHint:
          correct === "7"
            ? "Leading tone tendency: 7 leans up to 1."
            : correct === "4" || correct === "#4"
              ? "Upper tendency: this color often settles toward 3 or 5."
              : undefined,
      },
      compareAudio: neighborDegree && neighborMidi != null
        ? {
          label: `Play neighbor (${neighborDegree})`,
          description: `Contrast degree ${correct} with the nearest nearby degree.`,
          playbackPlan: {
            kind: "sequence",
            events: [
              { atBeats: 0, durationBeats: 0.6, freqHz: midiToFreq(tonicMidi), gain: 0.72 },
              { atBeats: 0.75, durationBeats: 0.65, freqHz: midiToFreq(targetMidi), gain: 0.9 },
              { atBeats: 1.6, durationBeats: 0.65, freqHz: midiToFreq(neighborMidi), gain: 0.86 },
            ],
          },
        }
        : undefined,
      metadata: {
        stability: stable,
        solfege: degreeSolfege(correct),
        tonalMode: config.tonalMode,
        visualCue: {
          activeDegree: correct,
          timelineMidis: [tonicMidi, targetMidi],
        },
      },
    }));
  }

  if (pickedMode === "functional_interval") {
    const forcedMovement = forcedAdaptiveKey?.startsWith("movement:") ? forcedAdaptiveKey.slice("movement:".length) : null;
    const movement = pickMatchingOrWeighted(
      intervalMovementPool(config.intervalLevel),
      ([from, to]) => `${from}->${to}` === forcedMovement,
      ([from, to]) => adaptiveWeightForKey(`movement:${movementLabel(from, to)}`, { contextKey: adaptiveContextKey })
    );
    const [fromDegree, toDegree] = movement;
    const fromMidi = degreeMidi(tonic, tonicOctave, fromDegree, config.tonalMode);
    let toMidi = degreeMidi(tonic, tonicOctave, toDegree, config.tonalMode);
    if (config.intervalLevel === 4 && fromDegree === "1" && toDegree === "1") {
      toMidi += 12;
    }

    const semitones = Math.abs(toMidi - fromMidi);
    const intervalName = intervalNameFromSemitones(semitones);
    const correct = `${fromDegree}->${toDegree}`;
    const choices = buildBalancedMovementChoices(movement, intervalMovementPool(config.intervalLevel), config.tonalMode);
    const feedbackNote = movementExplanation(fromDegree, toDegree);
    const neighborSemitones = semitones >= 11 ? semitones - 1 : semitones + 1;
    const neighborToMidi = fromMidi + (toMidi >= fromMidi ? neighborSemitones : -neighborSemitones);
    const neighborName = intervalNameFromSemitones(Math.abs(neighborToMidi - fromMidi));
    const tendencyHint =
      semitones === 6
        ? "Tritone tendency: hear the two notes wanting to resolve inward or outward."
        : fromDegree === "7" && toDegree === "1"
          ? "Leading tone tendency: 7 usually rises to 1."
          : undefined;

    return applyAuthoredOverlay(baseQuestion({
      mode: "functional_interval",
      tonic,
      tonicMidi,
      prompt: "Identify the scale-degree movement.",
      playbackPlan: buildIntervalPlayback(config.intervalPlaybackVariant, tonicMidi, fromMidi, toMidi),
      answerChoices: choices,
      correctAnswer: correct,
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `movement:${correct}`,
      feedback: {
        title: `${fromDegree} -> ${toDegree}`,
        subtitle: intervalName,
        note: feedbackNote,
        explanation: feedbackNote,
      },
      teaching: {
        lines: [
          "Intervals are heard as direction and distance from the start tone.",
          `This one is ${intervalName}, so keep that span in memory before naming the motion.`,
        ],
        more: "If two options feel close, focus on how strongly the second pitch pushes toward rest or away from it.",
        tendencyHint,
      },
      compareAudio: {
        label: `Play neighbor (${neighborName})`,
        description: `Compare ${intervalName} against a one-semitone neighbor.`,
        playbackPlan: buildIntervalPlayback(config.intervalPlaybackVariant, tonicMidi, fromMidi, neighborToMidi),
      },
      metadata: {
        intervalName,
        semitones,
        solfege: `${degreeSolfege(fromDegree)} -> ${degreeSolfege(toDegree)}`,
        tonalMode: config.tonalMode,
        visualCue: {
          movement: { from: fromDegree, to: toDegree },
          timelineMidis: [fromMidi, toMidi],
        },
      },
    }));
  }

  if (pickedMode === "timing_grid") {
    const pattern = makeTimingPattern(config.timingLevel);
    const forcedSync = forcedAdaptiveKey?.startsWith("syncopation:") ? forcedAdaptiveKey.slice("syncopation:".length) : null;
    const syncopated = pattern.targetBeats.some((beat) => Math.abs(beat % 1) > 0.0001);
    if (pattern.questionKind === "meter_pick") {
      const pool = ["2/4", "3/4", "4/4"];
      const choices = [pattern.meter, ...sampleDistinct(pool, 3, pattern.meter)].sort(() => Math.random() - 0.5);
      return applyAuthoredOverlay(baseQuestion({
        mode: "timing_grid",
        tonic,
        tonicMidi,
        prompt: "Identify the meter from the pulse pattern.",
        playbackPlan: pattern.promptPlan,
        answerChoices: choices,
        correctAnswer: pattern.meter,
        enforceSinging: false,
        revealAfterSinging: false,
        adaptiveFocusKey: `meter:${pattern.meter}`,
        feedback: {
          title: pattern.meter,
          subtitle: pattern.subdivision,
          explanation: `The accents cycle every ${pattern.meter}.`,
        },
        teaching: {
          lines: [
            "Hear where the stronger beat returns, then count the distance between accents.",
            `Subdivision is ${pattern.subdivision}, but meter comes from recurring beat groups.`,
          ],
          more: "If two choices feel close, track the downbeat reset over at least two bars.",
        },
        compareAudio: {
          label: "Replay with count-in",
          description: "Adds a lead-in click so the pulse settles first.",
          playbackPlan: pattern.replayWithCountIn,
        },
        metadata: {
          tonalMode: config.tonalMode,
          countInBeats: pattern.meter === "2/4" ? 2 : pattern.meter === "3/4" ? 3 : 4,
          timing: {
            questionKind: pattern.questionKind,
            meter: pattern.meter,
            subdivision: pattern.subdivision,
            quantizeStepBeats: pattern.quantizeStepBeats,
            bars: pattern.bars,
            targetBeats: pattern.targetBeats,
            patternLengthBeats: pattern.patternLengthBeats,
            supportsTapPad: false,
            showErrorOverlay: false,
          },
        },
      }));
    }

    if (pattern.questionKind === "subdivision_pick") {
      const all = ["quarter", "eighth", "triplet", "sixteenth"];
      const choices = [pattern.subdivision, ...sampleDistinct(all, 3, pattern.subdivision)].sort(() => Math.random() - 0.5);
      return applyAuthoredOverlay(baseQuestion({
        mode: "timing_grid",
        tonic,
        tonicMidi,
        prompt: "Identify the subdivision.",
        playbackPlan: pattern.promptPlan,
        answerChoices: choices,
        correctAnswer: pattern.subdivision,
        enforceSinging: false,
        revealAfterSinging: false,
        adaptiveFocusKey: `subdivision:${pattern.subdivision}`,
        feedback: {
          title: pattern.subdivision,
          subtitle: pattern.meter,
          explanation: `Smallest regular grid is ${pattern.subdivision}.`,
        },
        teaching: {
          lines: [
            "Subdivision is the smallest repeating slice between beats.",
            "Count one beat and listen for equally spaced internal pulses.",
          ],
          tendencyHint: "Triplet hearing often feels rounder than straight eighths.",
        },
        compareAudio: {
          label: "Replay with count-in",
          description: "Adds count-in clicks before the target pattern.",
          playbackPlan: pattern.replayWithCountIn,
        },
        metadata: {
          tonalMode: config.tonalMode,
          countInBeats: pattern.meter === "2/4" ? 2 : pattern.meter === "3/4" ? 3 : 4,
          timing: {
            questionKind: pattern.questionKind,
            meter: pattern.meter,
            subdivision: pattern.subdivision,
            quantizeStepBeats: pattern.quantizeStepBeats,
            bars: pattern.bars,
            targetBeats: pattern.targetBeats,
            patternLengthBeats: pattern.patternLengthBeats,
            supportsTapPad: false,
            showErrorOverlay: false,
          },
        },
      }));
    }

    if (pattern.questionKind === "offbeat_pick") {
      const choices = ["syncopated", "on beat only"];
      return applyAuthoredOverlay(baseQuestion({
        mode: "timing_grid",
        tonic,
        tonicMidi,
        prompt: "Does the pattern use syncopation?",
        playbackPlan: pattern.promptPlan,
        answerChoices: choices,
        correctAnswer: forcedSync === "yes" ? "syncopated" : forcedSync === "no" ? "on beat only" : syncopated ? "syncopated" : "on beat only",
        enforceSinging: false,
        revealAfterSinging: false,
        adaptiveFocusKey: `syncopation:${syncopated ? "yes" : "no"}`,
        feedback: {
          title: syncopated ? "syncopated" : "on beat only",
          subtitle: pattern.meter,
          explanation: syncopated ? "Several hits land between main beats." : "Hits align to beat anchors only.",
        },
        teaching: {
          lines: [
            "Syncopation means stress on weak parts of the beat.",
            "If taps feel pulled forward between beats, the line is syncopated.",
          ],
        },
        compareAudio: {
          label: "Replay with count-in",
          description: "Listen again with a stronger beat frame first.",
          playbackPlan: pattern.replayWithCountIn,
        },
        metadata: {
          tonalMode: config.tonalMode,
          countInBeats: pattern.meter === "2/4" ? 2 : pattern.meter === "3/4" ? 3 : 4,
          timing: {
            questionKind: pattern.questionKind,
            meter: pattern.meter,
            subdivision: pattern.subdivision,
            quantizeStepBeats: pattern.quantizeStepBeats,
            bars: pattern.bars,
            targetBeats: pattern.targetBeats,
            patternLengthBeats: pattern.patternLengthBeats,
            supportsTapPad: false,
            showErrorOverlay: false,
          },
        },
      }));
    }

    const signature = `${pattern.meter}:${pattern.subdivision}:${pattern.bars}`;
    return applyAuthoredOverlay(baseQuestion({
      mode: "timing_grid",
      tonic,
      tonicMidi,
      prompt: "Tap the pattern back on the pad, then submit your timing.",
      playbackPlan: pattern.promptPlan,
      answerChoices: ["tap_capture"],
      correctAnswer: "tap_capture",
      enforceSinging: false,
      revealAfterSinging: false,
      adaptiveFocusKey: `tap:${signature}`,
      feedback: {
        title: "Timing capture",
        subtitle: `${pattern.meter} / ${pattern.subdivision}`,
        explanation: "Quantized tap timing is compared against the source rhythm.",
      },
      teaching: {
        lines: [
          "Lock to the internal pulse before tapping.",
          "Stay on the same grid size you heard in the prompt.",
        ],
      },
      compareAudio: {
        label: "Replay with count-in",
        description: "Count-in plus pattern for another attempt.",
        playbackPlan: pattern.replayWithCountIn,
      },
      metadata: {
        tonalMode: config.tonalMode,
        countInBeats: pattern.meter === "2/4" ? 2 : pattern.meter === "3/4" ? 3 : 4,
        timing: {
          questionKind: pattern.questionKind,
          meter: pattern.meter,
          subdivision: pattern.subdivision,
          quantizeStepBeats: pattern.quantizeStepBeats,
          bars: pattern.bars,
          targetBeats: pattern.targetBeats,
          patternLengthBeats: pattern.patternLengthBeats,
          supportsTapPad: true,
          showErrorOverlay: true,
        },
      },
    }));
  }

  if (pickedMode === "phrase_recall") {
    const phrase = makePhrasePattern({
      level: config.phraseLevel,
      preferredInputMode: config.dictationInputMode,
      tonic,
      octave: tonicOctave,
      tonalMode: config.tonalMode,
    });
    const answerText = phrase.measureGroups.map((measure) => measure.join(" ")).join(" | ");
    return applyAuthoredOverlay(baseQuestion({
      mode: "phrase_recall",
      tonic,
      tonicMidi,
      prompt: "Recreate the melodic line.",
      playbackPlan: phrase.playbackPlan,
      answerChoices: phrase.answerChoices,
      correctAnswer: phrase.correctAnswer,
      enforceSinging: false,
      revealAfterSinging: false,
      adaptiveFocusKey: `phrase:${phrase.tag}`,
      feedback: {
        title: `${phrase.tag} line`,
        subtitle: `${phrase.bars} bars`,
        explanation: `Correct line: ${answerText}`,
      },
      teaching: {
        lines: [
          "Hold contour first, then fill exact degrees.",
          "Split the phrase into bars before naming details.",
        ],
        tendencyHint:
          phrase.tag === "stepwise"
            ? "Stepwise lines usually move by adjacent scale steps."
            : phrase.tag === "triadic"
              ? "Triadic lines outline chord tones (1-3-5 family)."
              : "Chromatic lines include altered scale colors.",
      },
      compareAudio: {
        label: "Replay with count-in",
        description: "Count-in first, then the full line.",
        playbackPlan: phrase.replayWithCountIn,
      },
      metadata: {
        tonalMode: config.tonalMode,
        countInBeats: 4,
        phrase: {
          bars: phrase.bars,
          tag: phrase.tag,
          inputMode: phrase.inputMode,
          expectedDegrees: phrase.degrees,
          measureGroups: phrase.measureGroups,
          measurePlaybackPlans: phrase.measurePlaybackPlans,
          replayWithCountIn: phrase.replayWithCountIn,
        },
      },
    }));
  }

  const isLegacyQualityPrompt = forcedAdaptiveKey?.startsWith("quality:");
  if (isLegacyQualityPrompt) {
    const qualityPool = harmonyQualitySet(config.harmonyLevel);
    const forcedQuality = forcedAdaptiveKey?.slice("quality:".length) ?? null;
    const quality = pickMatchingOrWeighted(
      qualityPool,
      (q) => q === forcedQuality,
      (q) => adaptiveWeightForKey(`quality:${q}`, { contextKey: adaptiveContextKey })
    );
    const functionLabel = harmonyFunctionFromQuality(quality);
    const chordMidis = buildHarmonyChord(tonicMidi, quality);
    const neighborQuality = nearestQualityNeighbor(quality);
    const neighborChord = buildHarmonyChord(tonicMidi, neighborQuality);
    const qualityChoices = [qualityLabel(quality), ...sampleDistinct(qualityPool.map(qualityLabel), 3, qualityLabel(quality))]
      .sort(() => Math.random() - 0.5);
    const harmonyHint = quality === "dominant7"
      ? "Dominant tendency: this quality strongly wants to resolve to tonic harmony."
      : quality === "half_diminished7" || quality === "diminished"
        ? "Diminished color usually sounds unstable and points toward resolution."
        : undefined;

    return applyAuthoredOverlay(baseQuestion({
      mode: "functional_harmony",
      tonic,
      tonicMidi,
      prompt: "Identify the chord quality in context (I -> ?).",
      playbackPlan: buildHarmonyPlayback(config.harmonyPlaybackVariant, tonicMidi, chordMidis),
      answerChoices: qualityChoices,
      correctAnswer: qualityLabel(quality),
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `quality:${quality}`,
      feedback: {
        title: qualityLabel(quality),
        subtitle: functionLabel,
        explanation: `Heard as ${functionLabel} function relative to tonic.`,
      },
      teaching: {
        lines: [
          `${qualityLabel(quality)} is a chord-color, not just a shape.`,
          `${functionLabel[0].toUpperCase()}${functionLabel.slice(1)} function tells you how strongly it feels at rest versus in motion.`,
        ],
        more: "As you replay, compare third and seventh placement because they usually define quality and pull.",
        tendencyHint: harmonyHint,
      },
      compareAudio: {
        label: `Play neighbor (${qualityLabel(neighborQuality)})`,
        description: "Hear a closely related quality in the same tonic context.",
        playbackPlan: buildHarmonyPlayback(config.harmonyPlaybackVariant, tonicMidi, neighborChord),
      },
      metadata: {
        chordQuality: quality,
        functionLabel,
        chordTones: chordMidis.map((m) => `${m}`),
        harmonyQuestionKind: "quality",
        tonalMode: config.tonalMode,
        visualCue: {
          timelineMidis: chordMidis,
        },
      },
    }));
  }

  const template = pickProgressionTemplate({ config, forcedAdaptiveKey, adaptiveContextKey });
  const canonicalPathLabel = progressionToLabel(template.romanPath);
  const canonicalChords = progressionChordMidis(tonicMidi, config.tonalMode, template.romanPath);
  const functionLabels = template.romanPath.map(functionFromRoman);
  const pullSummary = progressionPullSummary(template.romanPath);
  const forcedKind = forcedAdaptiveKey?.startsWith("cadence:")
    ? "cadence_type"
    : forcedAdaptiveKey?.startsWith("changed_position:")
      ? "changed_chord"
      : forcedAdaptiveKey?.startsWith("progression:")
        ? "roman_path"
        : null;
  const questionKind = forcedKind ?? progressionQuestionKindForStage(template.stage);
  const choiceCount = stageChoiceCount(template.stage);

  if (questionKind === "roman_path") {
    const templateChoices = progressionPool(config.tonalMode, config.harmonyLevel)
      .filter((candidate) => candidate.stage <= template.stage)
      .map((candidate) => progressionToLabel(candidate.romanPath));
    const choices = [canonicalPathLabel, ...sampleDistinct(templateChoices, choiceCount - 1, canonicalPathLabel)]
      .sort(() => Math.random() - 0.5);
    const neighborTemplate = progressionPool(config.tonalMode, config.harmonyLevel)
      .find((candidate) => candidate.romanPath.length === template.romanPath.length && progressionToLabel(candidate.romanPath) !== canonicalPathLabel);

    return applyAuthoredOverlay(baseQuestion({
      mode: "functional_harmony",
      tonic,
      tonicMidi,
      prompt: "Identify the Roman-numeral path.",
      playbackPlan: buildProgressionPlayback(config.harmonyPlaybackVariant, tonicMidi, canonicalChords),
      answerChoices: choices,
      correctAnswer: canonicalPathLabel,
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `progression:${canonicalPathLabel}`,
      feedback: {
        title: canonicalPathLabel,
        subtitle: `${cadenceLabel(template.cadenceType)} cadence`,
        explanation: pullSummary,
      },
      teaching: {
        lines: [
          "Hear each chord as function, not as an isolated sonority.",
          pullSummary,
        ],
        more: "Track the dominant arrival and whether it resolves or suspends, then map that direction onto the full path.",
        tendencyHint: `Cadence cue: ${cadenceLabel(template.cadenceType)} endings are shaped by the last chord's function.`,
      },
      compareAudio: neighborTemplate
        ? {
          label: `Play contrast (${progressionToLabel(neighborTemplate.romanPath)})`,
          description: "Compare against another path with the same number of chords.",
          playbackPlan: buildProgressionPlayback(
            config.harmonyPlaybackVariant,
            tonicMidi,
            progressionChordMidis(tonicMidi, config.tonalMode, neighborTemplate.romanPath)
          ),
        }
        : undefined,
      metadata: {
        harmonyQuestionKind: "roman_path",
        romanPath: template.romanPath,
        cadenceType: template.cadenceType,
        functionLabels,
        functionLabel: functionLabels[functionLabels.length - 1],
        pullSummary,
        chordTones: canonicalChords.flat().map((m) => `${m}`),
        tonalMode: config.tonalMode,
        visualCue: {
          timelineMidis: canonicalChords.flat(),
        },
      },
    }));
  }

  if (questionKind === "cadence_type") {
    const correct = cadenceLabel(template.cadenceType);
    const endingRoman = template.romanPath[template.romanPath.length - 1];
    const endingFunction = functionFromRoman(endingRoman);
    return applyAuthoredOverlay(baseQuestion({
      mode: "functional_harmony",
      tonic,
      tonicMidi,
      prompt: "Identify the cadence type.",
      playbackPlan: buildProgressionPlayback(config.harmonyPlaybackVariant, tonicMidi, canonicalChords),
      answerChoices: cadenceChoices(template.cadenceType, template.stage),
      correctAnswer: correct,
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `cadence:${template.cadenceType}`,
      feedback: {
        title: correct,
        subtitle: canonicalPathLabel,
        explanation: `Final ${endingRoman} sounds ${endingFunction} and ${pullDescription(endingFunction)}`,
      },
      teaching: {
        lines: [
          `Cadence hearing starts at the end: this path lands on ${endingRoman}.`,
          `That ending functions as ${endingFunction}, so notice how complete or suspended it feels.`,
        ],
        more: "Authentic closes on tonic after dominant pull, plagal returns from IV/iv to tonic, and half cadences pause on dominant.",
        tendencyHint: `Function path: ${pullSummary}`,
      },
      metadata: {
        harmonyQuestionKind: "cadence_type",
        romanPath: template.romanPath,
        cadenceType: template.cadenceType,
        functionLabels,
        functionLabel: endingFunction,
        pullSummary,
        chordTones: canonicalChords.flat().map((m) => `${m}`),
        tonalMode: config.tonalMode,
        visualCue: {
          timelineMidis: canonicalChords.flat(),
        },
      },
    }));
  }

  const changed = changedChordVariant({ tonalMode: config.tonalMode, romanPath: template.romanPath });
  if (!changed) {
    return applyAuthoredOverlay(baseQuestion({
      mode: "functional_harmony",
      tonic,
      tonicMidi,
      prompt: "Identify the Roman-numeral path.",
      playbackPlan: buildProgressionPlayback(config.harmonyPlaybackVariant, tonicMidi, canonicalChords),
      answerChoices: [canonicalPathLabel],
      correctAnswer: canonicalPathLabel,
      enforceSinging: shouldForceSinging,
      revealAfterSinging: shouldForceSinging,
      adaptiveFocusKey: `progression:${canonicalPathLabel}`,
      feedback: {
        title: canonicalPathLabel,
        explanation: pullSummary,
      },
      teaching: {
        lines: ["Hear function and direction as a sequence."],
      },
      metadata: {
        harmonyQuestionKind: "roman_path",
        romanPath: template.romanPath,
        functionLabels,
        functionLabel: functionLabels[functionLabels.length - 1],
        pullSummary,
        tonalMode: config.tonalMode,
      },
    }));
  }

  const changedChords = progressionChordMidis(tonicMidi, config.tonalMode, changed.changedPath);
  const targetFunction = functionFromRoman(changed.to);
  return applyAuthoredOverlay(baseQuestion({
    mode: "functional_harmony",
    tonic,
    tonicMidi,
    prompt: "Compare with the reference and identify which chord position changed.",
    playbackPlan: buildProgressionPlayback(config.harmonyPlaybackVariant, tonicMidi, changedChords),
    answerChoices: changedChordPositionChoices(changed.changedPath.length, changed.index, template.stage),
    correctAnswer: `Chord ${changed.index + 1}`,
    enforceSinging: shouldForceSinging,
    revealAfterSinging: shouldForceSinging,
    adaptiveFocusKey: `changed_position:${changed.index + 1}`,
    feedback: {
      title: `Chord ${changed.index + 1}`,
      subtitle: `${changed.from} -> ${changed.to}`,
      explanation: `${changed.to} is ${targetFunction} and ${pullDescription(targetFunction)}`,
    },
    teaching: {
      lines: [
        "Listen for where the function track shifts, not just where a single pitch differs.",
        `${changed.from} changed to ${changed.to}, changing the directional pull at that moment.`,
      ],
      more: `Reference path: ${canonicalPathLabel}. Changed path: ${progressionToLabel(changed.changedPath)}.`,
      tendencyHint: `Function path now: ${progressionPullSummary(changed.changedPath)}`,
    },
    compareAudio: {
      label: "Play reference path",
      description: `Reference: ${canonicalPathLabel}`,
      playbackPlan: buildProgressionPlayback(config.harmonyPlaybackVariant, tonicMidi, canonicalChords),
    },
    metadata: {
      harmonyQuestionKind: "changed_chord",
      romanPath: changed.changedPath,
      cadenceType: template.cadenceType,
      changedChordIndex: changed.index,
      changedFromRoman: changed.from,
      changedToRoman: changed.to,
      functionLabels: changed.changedPath.map(functionFromRoman),
      functionLabel: targetFunction,
      pullSummary: progressionPullSummary(changed.changedPath),
      chordTones: changedChords.flat().map((m) => `${m}`),
      tonalMode: config.tonalMode,
      visualCue: {
        timelineMidis: changedChords.flat(),
      },
    },
  }));
}
