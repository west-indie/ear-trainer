import { readLocal, removeLocal, writeLocal } from "./storage";

export type ProfileState = {
  userId: string | null;
  displayName: string;
  deviceLabel: string;
  syncEnabled: boolean;
  lastSyncedAt: number | null;
  syncState: "signed_out" | "ready" | "syncing" | "error";
  syncError: string | null;
};

const KEY = "et_profile_v1";
const EVENT = "et_profile_changed";
const CLOUD_PREFIX = "et_cloud_snapshot_v1:";

export const DEFAULT_PROFILE: ProfileState = {
  userId: null,
  displayName: "",
  deviceLabel: typeof navigator === "undefined" ? "This device" : navigator.userAgent.includes("Mobile") ? "Mobile device" : "Desktop device",
  syncEnabled: false,
  lastSyncedAt: null,
  syncState: "signed_out",
  syncError: null,
};

function emitProfileChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

function createUserId(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "learner";
  return `${slug}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getProfile(): ProfileState {
  const raw = readLocal<ProfileState>(KEY, DEFAULT_PROFILE);
  return {
    ...DEFAULT_PROFILE,
    ...raw,
  };
}

export function setProfile(next: ProfileState) {
  writeLocal(KEY, next);
  emitProfileChanged();
}

export function updateProfile(patch: Partial<ProfileState>) {
  setProfile({ ...getProfile(), ...patch });
}

export function signInProfile(displayName: string) {
  const trimmed = displayName.trim();
  const current = getProfile();
  const profile: ProfileState = {
    ...current,
    userId: current.userId ?? createUserId(trimmed),
    displayName: trimmed,
    syncEnabled: true,
    syncState: "ready",
    syncError: null,
  };
  setProfile(profile);
  return profile;
}

export function signOutProfile() {
  removeLocal(KEY);
  emitProfileChanged();
}

export function setSyncState(syncState: ProfileState["syncState"], syncError: string | null = null) {
  const current = getProfile();
  setProfile({
    ...current,
    syncState,
    syncError,
  });
}

export function saveCloudSnapshot(userId: string, snapshot: string) {
  localStorage.setItem(`${CLOUD_PREFIX}${userId}`, snapshot);
  updateProfile({
    lastSyncedAt: Date.now(),
    syncState: "ready",
    syncError: null,
  });
}

export function readCloudSnapshot(userId: string) {
  return localStorage.getItem(`${CLOUD_PREFIX}${userId}`);
}

export function subscribeProfile(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key?.startsWith(CLOUD_PREFIX)) {
      listener();
    }
  };
  const onEvent = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, onEvent);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, onEvent);
  };
}
