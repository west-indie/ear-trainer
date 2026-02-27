import { readLocal, writeLocal } from "./storage";
import type { TrainingMode } from "../training/types";

export type AttemptRecord = {
  ts: number; // Date.now()
  itemId: string;
  mode: string; // "interval" | "degree" | "chord" etc.
  correct: boolean;
  responseMs: number;
  contextKey?: string;
};

export type ItemMastery = {
  attempts: number;
  correct: number;
  streak: number;
  lastSeen: number;
  mastery: number; // 0..1 (simple heuristic for now)
  rollingAccuracy: number;
  avgResponseMs: number;
};

export type ProgressState = {
  attempts: AttemptRecord[];
  items: Record<string, ItemMastery>;
  adaptive: Record<string, AdaptiveBucket>;
  totals: {
    attempts: number;
    correct: number;
    streak: number;
    bestStreak: number;
  };
};

const KEY = "et_progress_v1";
const DAY_MS = 1000 * 60 * 60 * 24;
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

export type ReviewStrategy = "due" | "weak";
export type SkillArea = "intervals" | "degrees" | "chords" | "timing" | "phrases";

export type AdaptiveBucket = {
  id: string;
  key: string;
  context: string;
  mode: TrainingMode;
  attempts: number;
  correct: number;
  wrong: number;
  lastSeen: number;
  rollingAccuracy: number;
  avgResponseMs: number;
  mastery: number;
  intervalDays: number;
  dueAt: number;
  lastOutcomeCorrect: boolean;
};

export type ReviewFocus = {
  key: string;
  context: string;
  mode: TrainingMode;
};

export type SkillSummary = {
  skill: SkillArea;
  mastery: number;
  attempts: number;
  dueCount: number;
  weakCount: number;
};

export type DashboardSummary = {
  totals: ProgressState["totals"] & { accuracy: number };
  skills: SkillSummary[];
  reviewCounts: {
    due: number;
    weak: number;
  };
};

export type WeakAreaSummary = {
  key: string;
  label: string;
  mode: TrainingMode;
  mastery: number;
  attempts: number;
  dueNow: boolean;
  context: string;
};

export const DEFAULT_PROGRESS: ProgressState = {
  attempts: [],
  items: {},
  adaptive: {},
  totals: { attempts: 0, correct: 0, streak: 0, bestStreak: 0 },
};

export function getProgress(): ProgressState {
  const raw = readLocal<ProgressState>(KEY, DEFAULT_PROGRESS);
  return {
    attempts: raw.attempts ?? [],
    items: normalizeItems(raw.items ?? {}),
    adaptive: normalizeAdaptive(raw.adaptive ?? {}),
    totals: raw.totals ?? DEFAULT_PROGRESS.totals,
  };
}

function computeMastery(m: ItemMastery): number {
  const acc = m.attempts > 0 ? m.correct / m.attempts : 0;
  const confidence = Math.min(1, Math.log10(1 + m.attempts));
  const blended = m.rollingAccuracy * 0.6 + acc * 0.4;
  return clamp01(blended * confidence);
}

function inferModeFromKey(key: string): TrainingMode {
  if (key.startsWith("meter:") || key.startsWith("subdivision:") || key.startsWith("syncopation:") || key.startsWith("tap:")) {
    return "timing_grid";
  }
  if (key.startsWith("phrase:")) return "phrase_recall";
  if (key.startsWith("movement:")) return "functional_interval";
  if (
    key.startsWith("quality:")
    || key.startsWith("function:")
    || key.startsWith("progression:")
    || key.startsWith("cadence:")
    || key.startsWith("changed_position:")
  ) return "functional_harmony";
  return "scale_degree";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bucketId(context: string, key: string): string {
  return `${context}::${key}`;
}

function normalizeAdaptive(raw: ProgressState["adaptive"]): ProgressState["adaptive"] {
  const next: ProgressState["adaptive"] = {};
  for (const [id, bucket] of Object.entries(raw)) {
    if (!bucket) continue;
    const key = "key" in bucket && typeof bucket.key === "string" ? bucket.key : id;
    const context = "context" in bucket && typeof bucket.context === "string" ? bucket.context : "global";
    const attempts = bucket.attempts ?? 0;
    const wrong = "wrong" in bucket && typeof bucket.wrong === "number" ? bucket.wrong : Math.max(0, attempts - (bucket.correct ?? 0));
    const correct = "correct" in bucket && typeof bucket.correct === "number" ? bucket.correct : Math.max(0, attempts - wrong);
    const rollingAccuracy =
      "rollingAccuracy" in bucket && typeof bucket.rollingAccuracy === "number"
        ? bucket.rollingAccuracy
        : attempts > 0
          ? correct / attempts
          : 0;
    const mode =
      "mode" in bucket
      && (bucket.mode === "scale_degree"
        || bucket.mode === "functional_interval"
        || bucket.mode === "functional_harmony"
        || bucket.mode === "timing_grid"
        || bucket.mode === "phrase_recall")
        ? bucket.mode
        : inferModeFromKey(key);
    const normalized: AdaptiveBucket = {
      id,
      key,
      context,
      mode,
      attempts,
      correct,
      wrong,
      lastSeen: bucket.lastSeen ?? 0,
      rollingAccuracy,
      avgResponseMs: "avgResponseMs" in bucket && typeof bucket.avgResponseMs === "number" ? bucket.avgResponseMs : 0,
      mastery: "mastery" in bucket && typeof bucket.mastery === "number" ? bucket.mastery : clamp01(rollingAccuracy),
      intervalDays: "intervalDays" in bucket && typeof bucket.intervalDays === "number" ? bucket.intervalDays : 0,
      dueAt: "dueAt" in bucket && typeof bucket.dueAt === "number" ? bucket.dueAt : 0,
      lastOutcomeCorrect: "lastOutcomeCorrect" in bucket ? Boolean(bucket.lastOutcomeCorrect) : true,
    };
    next[id] = normalized;
  }
  return next;
}

function normalizeItems(raw: ProgressState["items"]): ProgressState["items"] {
  const next: ProgressState["items"] = {};
  for (const [itemId, item] of Object.entries(raw)) {
    if (!item) continue;
    const attempts = item.attempts ?? 0;
    const correct = item.correct ?? 0;
    next[itemId] = {
      attempts,
      correct,
      streak: item.streak ?? 0,
      lastSeen: item.lastSeen ?? 0,
      mastery: item.mastery ?? 0,
      rollingAccuracy: item.rollingAccuracy ?? (attempts > 0 ? correct / attempts : 0),
      avgResponseMs: item.avgResponseMs ?? 0,
    };
  }
  return next;
}

function nextIntervalDays(currentInterval: number): number {
  for (const value of REVIEW_INTERVALS_DAYS) {
    if (value > currentInterval) return value;
  }
  return REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1];
}

function tonalGroupFromContext(context: string): "major" | "minor" | "mixed" {
  if (context.includes(":major")) return "major";
  if (context.includes(":minor")) return "minor";
  return "mixed";
}

function skillFromMode(mode: TrainingMode): SkillArea {
  if (mode === "functional_interval") return "intervals";
  if (mode === "functional_harmony") return "chords";
  if (mode === "timing_grid") return "timing";
  if (mode === "phrase_recall") return "phrases";
  return "degrees";
}

function bucketWeight(bucket: AdaptiveBucket, now: number): number {
  const dueBoost = bucket.dueAt > 0 && bucket.dueAt <= now ? 1.8 : 0;
  const weaknessBoost = (1 - bucket.mastery) * 2.6;
  const missBoost = !bucket.lastOutcomeCorrect ? 1.1 : 0;
  const recencyGapDays = Math.max(0, (now - bucket.lastSeen) / DAY_MS);
  const decayBoost = Math.min(0.9, recencyGapDays * 0.08);
  return 1 + dueBoost + weaknessBoost + missBoost + decayBoost;
}

function labelForAdaptiveKey(key: string): string {
  if (key.startsWith("degree:")) {
    return `Degree ${key.slice("degree:".length)}`;
  }
  if (key.startsWith("movement:")) {
    const movement = key.slice("movement:".length).replace("->", " -> ");
    return `Movement ${movement}`;
  }
  if (key.startsWith("phrase:voice_")) {
    return `Motif ${key.slice("phrase:voice_".length).replaceAll("-", " - ")}`;
  }
  return key;
}

export function recordAttempt(input: {
  itemId: string;
  mode: string;
  correct: boolean;
  responseMs: number;
  contextKey?: string;
  adaptiveKeys?: string[];
}) {
  const s = getProgress();
  const now = Date.now();

  const rec: AttemptRecord = {
    ts: now,
    itemId: input.itemId,
    mode: input.mode,
    correct: input.correct,
    responseMs: input.responseMs,
    contextKey: input.contextKey,
  };
  s.attempts.push(rec);

  // totals
  s.totals.attempts += 1;
  if (input.correct) {
    s.totals.correct += 1;
    s.totals.streak += 1;
    s.totals.bestStreak = Math.max(s.totals.bestStreak, s.totals.streak);
  } else {
    s.totals.streak = 0;
  }

  // per-item mastery
  const cur = s.items[input.itemId] ?? {
    attempts: 0,
    correct: 0,
    streak: 0,
    lastSeen: 0,
    mastery: 0,
    rollingAccuracy: 0,
    avgResponseMs: 0,
  };
  cur.attempts += 1;
  if (input.correct) {
    cur.correct += 1;
    cur.streak += 1;
  } else {
    cur.streak = 0;
  }
  cur.lastSeen = now;
  const itemAlpha = 0.35;
  cur.rollingAccuracy = cur.attempts === 1 ? (input.correct ? 1 : 0) : itemAlpha * (input.correct ? 1 : 0) + (1 - itemAlpha) * cur.rollingAccuracy;
  cur.avgResponseMs = cur.attempts === 1 ? input.responseMs : itemAlpha * input.responseMs + (1 - itemAlpha) * cur.avgResponseMs;
  cur.mastery = computeMastery(cur);

  s.items[input.itemId] = cur;

  for (const adaptiveKey of input.adaptiveKeys ?? []) {
    const context = input.contextKey ?? "global";
    const id = bucketId(context, adaptiveKey);
    const bucket = s.adaptive[id] ?? {
      id,
      key: adaptiveKey,
      context,
      mode: inferModeFromKey(adaptiveKey),
      attempts: 0,
      correct: 0,
      wrong: 0,
      lastSeen: 0,
      rollingAccuracy: 0,
      avgResponseMs: 0,
      mastery: 0,
      intervalDays: 0,
      dueAt: 0,
      lastOutcomeCorrect: true,
    };
    bucket.attempts += 1;
    if (input.correct) {
      bucket.correct += 1;
    } else {
      bucket.wrong += 1;
    }
    bucket.lastSeen = now;
    bucket.lastOutcomeCorrect = input.correct;
    const alpha = 0.35;
    bucket.rollingAccuracy = bucket.attempts === 1 ? (input.correct ? 1 : 0) : alpha * (input.correct ? 1 : 0) + (1 - alpha) * bucket.rollingAccuracy;
    bucket.avgResponseMs = bucket.attempts === 1 ? input.responseMs : alpha * input.responseMs + (1 - alpha) * bucket.avgResponseMs;
    const rawAcc = bucket.attempts > 0 ? bucket.correct / bucket.attempts : 0;
    const confidence = Math.min(1, bucket.attempts / 10);
    bucket.mastery = clamp01((bucket.rollingAccuracy * 0.7 + rawAcc * 0.3) * confidence);

    if (!input.correct) {
      bucket.intervalDays = 0;
      bucket.dueAt = now;
    } else if (bucket.mastery >= 0.82) {
      bucket.intervalDays = nextIntervalDays(bucket.intervalDays);
      bucket.dueAt = now + bucket.intervalDays * DAY_MS;
    } else {
      bucket.intervalDays = 0;
      bucket.dueAt = now;
    }
    s.adaptive[id] = bucket;
  }

  // keep attempts bounded (Phase 0 scaffolding)
  if (s.attempts.length > 2000) s.attempts = s.attempts.slice(-2000);

  writeLocal(KEY, s);
}

export function adaptiveWeightForKey(adaptiveKey: string, options?: { contextKey?: string }): number {
  const s = getProgress();
  const now = Date.now();
  const context = options?.contextKey;
  if (context) {
    const direct = s.adaptive[bucketId(context, adaptiveKey)];
    if (direct) return bucketWeight(direct, now);
  }
  const matching = Object.values(s.adaptive).filter((b) => b.key === adaptiveKey);
  if (matching.length === 0) return 1;
  return matching.reduce((sum, bucket) => sum + bucketWeight(bucket, now), 0) / matching.length;
}

export function getReviewFocus(input: {
  strategy: ReviewStrategy;
  limit: number;
  modePool?: TrainingMode[];
  tonalGroup?: "major" | "minor" | "mixed";
}): ReviewFocus[] {
  const s = getProgress();
  const now = Date.now();
  const modeSet = new Set(input.modePool ?? ["scale_degree", "functional_interval", "functional_harmony", "timing_grid", "phrase_recall"]);
  const candidates = Object.values(s.adaptive).filter((bucket) => {
    const supportedKey =
      bucket.key.startsWith("degree:")
      || bucket.key.startsWith("movement:")
      || bucket.key.startsWith("quality:")
      || bucket.key.startsWith("progression:")
      || bucket.key.startsWith("cadence:")
      || bucket.key.startsWith("changed_position:")
      || bucket.key.startsWith("meter:")
      || bucket.key.startsWith("subdivision:")
      || bucket.key.startsWith("syncopation:")
      || bucket.key.startsWith("tap:")
      || bucket.key.startsWith("phrase:");
    if (!supportedKey) return false;
    if (!modeSet.has(bucket.mode)) return false;
    if (input.tonalGroup && input.tonalGroup !== "mixed") {
      const bucketGroup = tonalGroupFromContext(bucket.context);
      if (bucketGroup !== "mixed" && bucketGroup !== input.tonalGroup) return false;
    }
    if (input.strategy === "due") return bucket.dueAt > 0 && bucket.dueAt <= now;
    return bucket.attempts >= 2 && bucket.mastery < 0.72;
  });

  const sorted = candidates.sort((a, b) => {
    if (input.strategy === "due") return a.dueAt - b.dueAt;
    return bucketWeight(b, now) - bucketWeight(a, now);
  });

  return sorted.slice(0, input.limit).map((bucket) => ({
    key: bucket.key,
    context: bucket.context,
    mode: bucket.mode,
  }));
}

export function getDashboardSummary(): DashboardSummary {
  const s = getProgress();
  const now = Date.now();
  const buckets = Object.values(s.adaptive);
  const accuracy = s.totals.attempts > 0 ? s.totals.correct / s.totals.attempts : 0;

  const skills: SkillSummary[] = (["degrees", "intervals", "chords", "timing", "phrases"] as SkillArea[]).map((skill) => {
    const skillBuckets = buckets.filter((bucket) => skillFromMode(bucket.mode) === skill);
    const attempts = skillBuckets.reduce((sum, b) => sum + b.attempts, 0);
    const mastery = skillBuckets.length > 0 ? skillBuckets.reduce((sum, b) => sum + b.mastery, 0) / skillBuckets.length : 0;
    const dueCount = skillBuckets.filter((b) => b.dueAt > 0 && b.dueAt <= now).length;
    const weakCount = skillBuckets.filter((b) => b.attempts >= 2 && b.mastery < 0.72).length;
    return { skill, mastery, attempts, dueCount, weakCount };
  });

  return {
    totals: {
      ...s.totals,
      accuracy,
    },
    skills,
    reviewCounts: {
      due: buckets.filter((b) => b.dueAt > 0 && b.dueAt <= now).length,
      weak: buckets.filter((b) => b.attempts >= 2 && b.mastery < 0.72).length,
    },
  };
}

export function getWeakestAreas(input?: {
  contextPrefix?: string;
  limit?: number;
  modePool?: TrainingMode[];
}): WeakAreaSummary[] {
  const s = getProgress();
  const now = Date.now();
  const modeSet = input?.modePool ? new Set(input.modePool) : null;
  const candidates = Object.values(s.adaptive)
    .filter((bucket) => {
      if (input?.contextPrefix && !bucket.context.startsWith(input.contextPrefix)) return false;
      if (modeSet && !modeSet.has(bucket.mode)) return false;
      return bucket.attempts > 0;
    })
    .sort((a, b) => {
      const masteryDiff = a.mastery - b.mastery;
      if (Math.abs(masteryDiff) > 0.001) return masteryDiff;
      return bucketWeight(b, now) - bucketWeight(a, now);
    });

  return candidates.slice(0, input?.limit ?? 3).map((bucket) => ({
    key: bucket.key,
    label: labelForAdaptiveKey(bucket.key),
    mode: bucket.mode,
    mastery: bucket.mastery,
    attempts: bucket.attempts,
    dueNow: bucket.dueAt > 0 && bucket.dueAt <= now,
    context: bucket.context,
  }));
}

export function resetProgress() {
  writeLocal(KEY, DEFAULT_PROGRESS);
}
