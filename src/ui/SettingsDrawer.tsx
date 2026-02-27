import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, getSettings, setSettings, type AppSettings, type Timbre } from "../store/settingsStore";
import { NOTE_NAMES } from "../audio/music";

export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setS(getSettings()), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const panelClassName = useMemo(
    () => open ? "settings-drawer settings-drawer--open" : "settings-drawer",
    [open],
  );

  function save(next: AppSettings) {
    setS(next);
    setSettings(next);
  }

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className="settings-scrim"
        />
      )}
      <div className={panelClassName} role="dialog" aria-modal="true" aria-label="Quick settings">
        <div className="settings-drawer__header">
          <div>
            <div className="kicker kicker--red">Quick Controls</div>
            <div className="panel-title">Settings</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose}>Close</button>
        </div>

        <div className="settings-drawer__body">
          <label className="control-label">
            <div>Key</div>
            <select value={s.keyRoot} onChange={(e) => save({ ...s, keyRoot: e.target.value as AppSettings["keyRoot"] })}>
              {NOTE_NAMES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          <label className="control-label">
            <div>Tonic octave</div>
            <input
              type="number"
              min={1}
              max={6}
              value={s.octave}
              onChange={(e) => save({ ...s, octave: Number(e.target.value) })}
            />
          </label>

          <label className="control-label">
            <div>Tempo (BPM)</div>
            <input
              type="number"
              min={40}
              max={220}
              value={s.tempoBpm}
              onChange={(e) => save({ ...s, tempoBpm: Number(e.target.value) })}
            />
          </label>

          <label className="control-label">
            <div>Master volume</div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={s.masterGain}
              onChange={(e) => save({ ...s, masterGain: Number(e.target.value) })}
            />
            <div className="subtle">{s.masterGain.toFixed(2)}</div>
          </label>

          <label className="control-label">
            <div>Timbre</div>
            <select value={s.timbre} onChange={(e) => save({ ...s, timbre: e.target.value as Timbre })}>
              <option value="sine">sine</option>
              <option value="triangle">triangle</option>
              <option value="square">square</option>
              <option value="sawtooth">sawtooth</option>
            </select>
          </label>

          <label className="checkbox-chip">
            <input
              type="checkbox"
              checked={s.droneEnabled}
              onChange={(e) => save({ ...s, droneEnabled: e.target.checked })}
            />
            <div>Tonic drone enabled</div>
          </label>

          <label className="checkbox-chip">
            <input
              type="checkbox"
              checked={s.visualsEnabled}
              onChange={(e) => save({ ...s, visualsEnabled: e.target.checked })}
            />
            <div>Visual aids enabled</div>
          </label>

          <div className="settings-drawer__footer">
            <button onClick={() => save(DEFAULT_SETTINGS)} style={{ width: "100%" }}>
              Reset settings
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
