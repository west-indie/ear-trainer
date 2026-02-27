import { useEffect, useMemo, useState } from "react";
import { ItemBank } from "../bank/itemBank";
import type { AnyItem } from "../bank/types";
import { buildQuestionFromItem } from "../questions/buildQuestion";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import { engine } from "../audio/engine";
import { recordAttempt } from "../store/progressStore";

export default function Debug() {
  const [selectedId, setSelectedId] = useState(ItemBank[0]?.id ?? "");
  const [settings, setSettings] = useState(getSettings());

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);

  const selectedItem: AnyItem | undefined = useMemo(
    () => ItemBank.find((x) => x.id === selectedId),
    [selectedId]
  );

  const question = useMemo(() => {
    if (!selectedItem) return null;
    return buildQuestionFromItem(selectedItem, settings);
  }, [selectedItem, settings]);

  async function play() {
    if (!question) return;
    await engine.play(question.playbackPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }

  function logAttempt(correct: boolean) {
    if (!question) return;
    recordAttempt({
      itemId: question.metadata.itemId,
      mode: question.metadata.itemKind,
      correct,
      responseMs: 0,
    });
    alert(correct ? "Logged: correct" : "Logged: incorrect");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Debug Mode</h2>
      <div style={{ opacity: 0.75 }}>
        Pick any item, generate the standardized Question JSON, and play it through the shared PlaybackEngine.
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <div>Item</div>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ minWidth: 280 }}>
            {ItemBank.map((it) => (
              <option key={it.id} value={it.id}>
                [{it.kind}] {it.label} (d{it.difficulty})
              </option>
            ))}
          </select>
        </label>

        <button onClick={play} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Play
        </button>
        <button onClick={() => engine.stopAll()} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Stop
        </button>

        <button onClick={() => logAttempt(true)} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Log Correct
        </button>
        <button onClick={() => logAttempt(false)} style={{ padding: "10px 12px", borderRadius: 10 }}>
          Log Incorrect
        </button>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: 12, borderRadius: 12, background: "white", border: "1px solid rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Selected Item</div>
          <pre style={{ margin: 0, fontSize: 12, overflow: "auto" }}>
            {JSON.stringify(selectedItem, null, 2)}
          </pre>
        </div>

        <div style={{ padding: 12, borderRadius: 12, background: "white", border: "1px solid rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Generated Question JSON</div>
          <pre style={{ margin: 0, fontSize: 12, overflow: "auto" }}>
            {JSON.stringify(question, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
