import { readLocal, writeLocal } from "./storage";

export type Timbre = "sine" | "triangle" | "square" | "sawtooth";

export type AppSettings = {
  keyRoot: "C" | "Db" | "D" | "Eb" | "E" | "F" | "Gb" | "G" | "Ab" | "A" | "Bb" | "B";
  octave: number;              // tonic octave
  tempoBpm: number;
  masterGain: number;          // 0..1
  timbre: Timbre;
  droneEnabled: boolean;
  visualsEnabled: boolean;
  range: { lowMidi: number; highMidi: number }; // for future singing/range constraints
};

const KEY = "et_settings_v1";
const SETTINGS_EVENT = "et_settings_changed";

export const DEFAULT_SETTINGS: AppSettings = {
  keyRoot: "C",
  octave: 3,
  tempoBpm: 90,
  masterGain: 0.25,
  timbre: "triangle",
  droneEnabled: false,
  visualsEnabled: true,
  range: { lowMidi: 48, highMidi: 72 }, // C3..C5
};

export function getSettings(): AppSettings {
  return readLocal<AppSettings>(KEY, DEFAULT_SETTINGS);
}

export function setSettings(next: AppSettings) {
  writeLocal(KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SETTINGS_EVENT));
  }
}

export function subscribeSettings(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  const onSettingsEvent = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(SETTINGS_EVENT, onSettingsEvent);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SETTINGS_EVENT, onSettingsEvent);
  };
}
