import type { TrainingMode } from "../training/types";
import { readLocal, writeLocal } from "./storage";

export type AuthoredDrill = {
  id: string;
  name: string;
  mode: TrainingMode;
  adaptiveKey: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  promptOverride: string;
  explanationTitle: string;
  explanationBody: string;
  coachingNotes: string[];
  moreBody: string;
  enabled: boolean;
  updatedAt: number;
};

const KEY = "et_authored_drills_v1";
const EVENT = "et_authored_drills_changed";

export const DEFAULT_AUTHORED_DRILLS: AuthoredDrill[] = [
  {
    id: "seed_movement_7_1",
    name: "Leading tone release",
    mode: "functional_interval",
    adaptiveKey: "movement:7->1",
    difficulty: 2,
    tags: ["cadence", "resolution"],
    promptOverride: "Name the pull you hear after tonic is established.",
    explanationTitle: "Leading tone release",
    explanationBody: "This motion feels urgent because the upper note sits right next to tonic and resolves by shortest distance.",
    coachingNotes: [
      "Hear the first note as unstable before you try to label the span.",
      "If the landing feels complete, you are probably hearing the return to tonic.",
    ],
    moreBody: "This kind of motion is worth over-practicing because it appears across melodies, bass motion, and cadence hearing.",
    enabled: true,
    updatedAt: Date.now(),
  },
];

function emitContentChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

function newId() {
  return `drill_${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(drill: AuthoredDrill, index: number): AuthoredDrill {
  return {
    id: drill.id || `drill_${index}`,
    name: drill.name || `Drill ${index + 1}`,
    mode: drill.mode,
    adaptiveKey: drill.adaptiveKey,
    difficulty: drill.difficulty ?? 1,
    tags: drill.tags ?? [],
    promptOverride: drill.promptOverride ?? "",
    explanationTitle: drill.explanationTitle ?? drill.name,
    explanationBody: drill.explanationBody ?? "",
    coachingNotes: drill.coachingNotes ?? [],
    moreBody: drill.moreBody ?? "",
    enabled: drill.enabled ?? true,
    updatedAt: drill.updatedAt ?? Date.now(),
  };
}

export function getAuthoredDrills() {
  const raw = readLocal<AuthoredDrill[]>(KEY, DEFAULT_AUTHORED_DRILLS);
  return raw.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getEnabledAuthoredDrills() {
  return getAuthoredDrills().filter((drill) => drill.enabled);
}

export function saveAuthoredDrill(input: Omit<AuthoredDrill, "id" | "updatedAt"> & { id?: string }) {
  const drills = getAuthoredDrills();
  const next: AuthoredDrill = normalize({
    ...input,
    id: input.id ?? newId(),
    updatedAt: Date.now(),
  } as AuthoredDrill, drills.length);
  const existingIndex = drills.findIndex((drill) => drill.id === next.id);
  if (existingIndex >= 0) drills[existingIndex] = next;
  else drills.unshift(next);
  writeLocal(KEY, drills);
  emitContentChanged();
  return next;
}

export function deleteAuthoredDrill(id: string) {
  writeLocal(KEY, getAuthoredDrills().filter((drill) => drill.id !== id));
  emitContentChanged();
}

export function subscribeAuthoredDrills(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  const onEvent = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onEvent);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onEvent);
  };
}

export function findAuthoredDrill(mode: TrainingMode, adaptiveKey: string) {
  return getEnabledAuthoredDrills().find((drill) => drill.mode === mode && drill.adaptiveKey === adaptiveKey) ?? null;
}

export function modeAdaptiveKeyExamples(mode: TrainingMode) {
  if (mode === "scale_degree") return ["degree:3", "degree:7"];
  if (mode === "functional_interval") return ["movement:2->3", "movement:7->1"];
  if (mode === "functional_harmony") return ["progression:ii-V-I", "cadence:authentic", "changed_position:2"];
  if (mode === "timing_grid") return ["meter:4/4", "subdivision:triplet", "tap:4/4:eighth:2"];
  return ["phrase:stepwise", "phrase:triadic"];
}
