import { DEFAULT_PROFILE, getProfile, readCloudSnapshot, saveCloudSnapshot, setProfile, setSyncState } from "./accountStore";
import { clearAnalytics, getAnalyticsEvents, trackEvent } from "./analyticsStore";
import { DEFAULT_AUTHORED_DRILLS, getAuthoredDrills } from "./contentStore";
import { DEFAULT_PROGRESS, getProgress, resetProgress, type ProgressState } from "./progressStore";
import { DEFAULT_SETTINGS, getSettings, setSettings } from "./settingsStore";
import { DEFAULT_TRAINING_SETTINGS, getTrainingSettings, setTrainingSettings } from "./trainingStore";
import { downloadTextFile, writeLocal } from "./storage";

const PROGRESS_KEY = "et_progress_v1";
const CONTENT_KEY = "et_authored_drills_v1";

export type AppSnapshot = {
  version: 1;
  exportedAt: number;
  profile: ReturnType<typeof getProfile>;
  settings: ReturnType<typeof getSettings>;
  training: ReturnType<typeof getTrainingSettings>;
  progress: ReturnType<typeof getProgress>;
  analytics: ReturnType<typeof getAnalyticsEvents>;
  authoredDrills: ReturnType<typeof getAuthoredDrills>;
};

export function createSnapshot(): AppSnapshot {
  return {
    version: 1,
    exportedAt: Date.now(),
    profile: getProfile(),
    settings: getSettings(),
    training: getTrainingSettings(),
    progress: getProgress(),
    analytics: getAnalyticsEvents(),
    authoredDrills: getAuthoredDrills(),
  };
}

function isSnapshot(input: unknown): input is AppSnapshot {
  if (typeof input !== "object" || input == null) return false;
  return "version" in input && "settings" in input && "training" in input && "progress" in input;
}

export function exportSnapshot() {
  const snapshot = createSnapshot();
  downloadTextFile(`ear-trainer-backup-${snapshot.exportedAt}.json`, JSON.stringify(snapshot, null, 2));
  trackEvent("export_snapshot", "/settings", { authoredCount: snapshot.authoredDrills.length });
}

export function restoreSnapshot(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  if (!isSnapshot(parsed)) {
    throw new Error("Backup file is missing required fields.");
  }

  const snapshot = parsed as AppSnapshot;
  setProfile({ ...DEFAULT_PROFILE, ...snapshot.profile });
  setSettings({ ...DEFAULT_SETTINGS, ...snapshot.settings });
  setTrainingSettings({ ...DEFAULT_TRAINING_SETTINGS, ...snapshot.training });
  writeLocal(PROGRESS_KEY, { ...DEFAULT_PROGRESS, ...snapshot.progress } satisfies ProgressState);
  clearAnalytics();
  writeLocal(CONTENT_KEY, [...DEFAULT_AUTHORED_DRILLS, ...(snapshot.authoredDrills ?? [])]);
  writeLocal("et_analytics_v1", snapshot.analytics ?? []);
  trackEvent("import_snapshot", "/settings", { exportedAt: snapshot.exportedAt });
}

export function clearLocalProductData() {
  setProfile(DEFAULT_PROFILE);
  setSettings(DEFAULT_SETTINGS);
  setTrainingSettings(DEFAULT_TRAINING_SETTINGS);
  resetProgress();
  clearAnalytics();
  writeLocal(CONTENT_KEY, DEFAULT_AUTHORED_DRILLS);
}

export async function pushSnapshotToCloud() {
  const profile = getProfile();
  if (!profile.userId || !profile.syncEnabled) {
    throw new Error("Sign in before syncing.");
  }
  setSyncState("syncing");
  const snapshot = JSON.stringify(createSnapshot());
  saveCloudSnapshot(profile.userId, snapshot);
  trackEvent("sync_push", "/settings", { authoredCount: getAuthoredDrills().length });
}

export async function pullSnapshotFromCloud() {
  const profile = getProfile();
  if (!profile.userId || !profile.syncEnabled) {
    throw new Error("Sign in before syncing.");
  }
  setSyncState("syncing");
  const snapshot = readCloudSnapshot(profile.userId);
  if (!snapshot) {
    setSyncState("error", "No synced data found for this profile.");
    throw new Error("No synced data found for this profile.");
  }
  restoreSnapshot(snapshot);
  setSyncState("ready");
  trackEvent("sync_pull", "/settings", { source: "local-cloud" });
}
