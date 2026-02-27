import { useEffect, useRef, useState } from "react";
import {
  getProfile,
  signInProfile,
  signOutProfile,
  subscribeProfile,
  updateProfile,
} from "../store/accountStore";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import {
  clearLocalProductData,
  exportSnapshot,
  pullSnapshotFromCloud,
  pushSnapshotToCloud,
  restoreSnapshot,
} from "../store/snapshotStore";
import { getAuthoredDrills, subscribeAuthoredDrills } from "../store/contentStore";

export default function SettingsPage() {
  const [profile, setProfile] = useState(getProfile());
  const [settings, setSettings] = useState(getSettings());
  const [draftName, setDraftName] = useState(getProfile().displayName);
  const [authoredCount, setAuthoredCount] = useState(getAuthoredDrills().length);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => subscribeProfile(() => setProfile(getProfile())), []);
  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);
  useEffect(() => subscribeAuthoredDrills(() => setAuthoredCount(getAuthoredDrills().length)), []);

  async function runSync(direction: "push" | "pull") {
    try {
      setStatus(direction === "push" ? "Syncing local snapshot..." : "Restoring latest synced snapshot...");
      if (direction === "push") await pushSnapshotToCloud();
      else await pullSnapshotFromCloud();
      setStatus(direction === "push" ? "Snapshot saved to synced storage." : "Synced snapshot restored.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sync failed.");
    }
  }

  async function importFile(file: File) {
    try {
      const raw = await file.text();
      restoreSnapshot(raw);
      setStatus("Backup imported.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <h2>Settings</h2>
        <p className="subtle">Manage your local profile, backup snapshots, and the data layers that power practice, authored content, and telemetry.</p>
      </div>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3>Profile</h3>
        <label>
          Display name
          <input value={draftName} onChange={(event) => setDraftName(event.target.value)} aria-label="Display name" />
        </label>
        <label>
          Device label
          <input value={profile.deviceLabel} onChange={(event) => updateProfile({ deviceLabel: event.target.value })} aria-label="Device label" />
        </label>
        <div className="subtle">
          {profile.userId ? `Signed in as ${profile.displayName || "Learner"} (${profile.userId})` : "Running in local-only mode."}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => signInProfile(draftName || "Learner")}>{profile.userId ? "Refresh profile" : "Create profile"}</button>
          <button onClick={() => signOutProfile()}>Sign out</button>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={profile.syncEnabled}
              onChange={(event) => updateProfile({ syncEnabled: event.target.checked })}
              style={{ width: 18, minHeight: 18 }}
              aria-label="Enable sync"
            />
            Keep a synced backup
          </label>
        </div>
      </section>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3>Data flow</h3>
        <div className="subtle">
          Last sync: {profile.lastSyncedAt ? new Date(profile.lastSyncedAt).toLocaleString() : "Never"} | State: {profile.syncState}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => runSync("push")} disabled={!profile.userId || !profile.syncEnabled}>Save synced copy</button>
          <button onClick={() => runSync("pull")} disabled={!profile.userId || !profile.syncEnabled}>Restore synced copy</button>
          <button onClick={() => exportSnapshot()}>Download backup</button>
          <button onClick={() => fileInputRef.current?.click()}>Import backup</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.currentTarget.value = "";
          }}
          className="sr-only"
          aria-label="Import backup file"
        />
        <div style={{ display: "grid", gap: 4 }} className="subtle">
          <div>Saved drills: {authoredCount}</div>
          <div>Tempo: {settings.tempoBpm} BPM</div>
          <div>Visual aids: {settings.visualsEnabled ? "On" : "Off"}</div>
        </div>
        {status && <div style={{ padding: 12, borderRadius: 14, background: "var(--surface-muted)" }}>{status}</div>}
      </section>

      <section className="card" style={{ display: "grid", gap: 12 }}>
        <h3>Reset</h3>
        <p className="subtle">This clears local progress, authored drills, settings, telemetry, and the current profile. It does not erase any synced copy saved under the same profile id.</p>
        <button onClick={() => { clearLocalProductData(); setStatus("Local data cleared."); }}>Clear local data</button>
      </section>
    </div>
  );
}
