import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEnabledTrainingModes } from "../config/featureFlags";
import {
  QUICKPLAY_INTERVAL_LEVEL_COPY,
  QUICKPLAY_TONIC_SOURCE_COPY,
  QUICKPLAY_TOPIC_OPTIONS,
  quickplayPoolOptions,
  sanitizeQuickplayModePool,
  type QuickplayTonicSourceLevel,
} from "../config/quickplayPresets";
import { NOTE_NAMES, type NoteName } from "../audio/music";
import type { TrainingMode } from "../training/types";
import ModePicker from "../ui/ModePicker";

export default function Home() {
  const navigate = useNavigate();
  const [pathOverlayOpen, setPathOverlayOpen] = useState(false);
  const [quickplayOverlayOpen, setQuickplayOverlayOpen] = useState(false);
  const [quickplayTopics, setQuickplayTopics] = useState<TrainingMode[]>(
    sanitizeQuickplayModePool(getEnabledTrainingModes().filter((mode) =>
      mode === "scale_degree" || mode === "functional_interval"
    ))
  );
  const [quickplayTonicSourceLevel, setQuickplayTonicSourceLevel] = useState<QuickplayTonicSourceLevel>(1);
  const [quickplayFixedTonic, setQuickplayFixedTonic] = useState<NoteName>("C");
  const [quickplayFixedPoolRoot, setQuickplayFixedPoolRoot] = useState<NoteName>("C");
  const [quickplayIntervalLevel, setQuickplayIntervalLevel] = useState<1 | 2 | 3 | 4>(1);
  const [quickplayDegreeLevel, setQuickplayDegreeLevel] = useState<1 | 2 | 3>(1);
  const intervalTopicSelected = quickplayTopics.includes("functional_interval");
  const degreeTopicSelected = quickplayTopics.includes("scale_degree");
  const tonicSelectionDisabled = quickplayTonicSourceLevel === 3;
  const tonicSelectionLabel = quickplayTonicSourceLevel === 2 ? "Fixed pool" : "Fixed tonic";

  function toggleQuickplayTopic(mode: TrainingMode) {
    setQuickplayTopics((current) => {
      if (current.includes(mode)) {
        const next = current.filter((item) => item !== mode);
        return next.length > 0 ? next : current;
      }
      return [...current, mode];
    });
  }

  function openPath(path: string) {
    navigate(path);
    setPathOverlayOpen(false);
    setQuickplayOverlayOpen(false);
  }

  function openQuickplayOverlay() {
    setPathOverlayOpen(false);
    setQuickplayOverlayOpen(true);
  }

  function startQuickplay() {
    const next = new URLSearchParams({
      quickplay: "default",
      quickplayTopics: sanitizeQuickplayModePool(quickplayTopics).join(","),
      quickplayTonicLevel: String(quickplayTonicSourceLevel),
      quickplayFixedTonic,
      quickplayFixedPool: quickplayFixedPoolRoot,
      quickplayIntervalLevel: String(quickplayIntervalLevel),
      quickplayDegreeLevel: String(quickplayDegreeLevel),
    });
    navigate(`/practice?${next.toString()}`);
    setQuickplayOverlayOpen(false);
  }

  return (
    <div className="page">
      <section className="page-header page-header--hero">
        <div className="page-header__copy">
          <div className="eyebrow">New Ultraviolet Systems Basic</div>
          <h1 className="page-title home-page__title">VI-V-i Trainer</h1>
          <div className="page-lede">
            Tonic-centered ear training for scale degrees, intervals, guided review, and voice work, built around repeatable drills and local-first progress.
          </div>
        </div>
        <aside className="page-header__aside">
          <div className="hero-note hero-note--poster">
            <div className="hero-cta">
              <div className="hero-cta__label">Click here to choose how to begin</div>
              <button type="button" className="hero-cta__button" onClick={() => setPathOverlayOpen(true)}>
                Start here
              </button>
              <div className="hero-cta__label">Click Here to enter keyboard mode</div>
              <button type="button" className="hero-cta__button" onClick={() => navigate("/keyboard")}>
                Keyboard mode
              </button>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel panel--blue">
        <div className="panel-header">
          <div>
            <div className="section-label kicker kicker--blue">Start Here</div>
            <h2 className="panel-title">Choose a practice mode</h2>
          </div>
          <div className="panel-copy">
            Short paths, focused sessions, and voice work all share the same tonic-centered engine.
          </div>
        </div>
      </section>

      <ModePicker />

      {pathOverlayOpen && (
        <div className="mode-overlay" onClick={() => setPathOverlayOpen(false)} role="presentation">
          <div
            className="mode-overlay__panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="path-overlay-title"
          >
            <div id="path-overlay-title" className="panel-title">Choose How to Begin</div>
            <div className="subtle">Pick the starting route that matches how guided or customizable you want this session to be.</div>
            <div className="mode-overlay__actions">
              <button type="button" className="mode-overlay__option" onClick={() => openPath("/beginner")}>
                <span className="mode-overlay__option-title">Start from Basics</span>
                <span className="mode-overlay__option-copy">A guided beginner on-ramp with tonic-first drills, singing prompts, and required review.</span>
              </button>
              <button type="button" className="mode-overlay__option" onClick={openQuickplayOverlay}>
                <span className="mode-overlay__option-title">Quickplay</span>
                <span className="mode-overlay__option-copy">Pick a few core session options, then jump straight into a preset-backed run.</span>
              </button>
              <button type="button" className="mode-overlay__option" onClick={() => openPath("/practice")}>
                <span className="mode-overlay__option-title">Open Practice</span>
                <span className="mode-overlay__option-copy">Go straight to the full practice builder with manual control over the session.</span>
              </button>
              <button type="button" className="mode-overlay__option" onClick={() => openPath("/custom-path")}>
                <span className="mode-overlay__option-title">Custom path</span>
                <span className="mode-overlay__option-copy">Take a short drill assessment, see what needs work, then save your own reusable preset.</span>
              </button>
            </div>
            <button type="button" className="mode-overlay__dismiss" onClick={() => setPathOverlayOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {quickplayOverlayOpen && (
        <div className="mode-overlay" onClick={() => setQuickplayOverlayOpen(false)} role="presentation">
          <div
            className="mode-overlay__panel mode-overlay__panel--wide mode-overlay__panel--compact"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quickplay-overlay-title"
          >
            <div id="quickplay-overlay-title" className="panel-title">Quickplay</div>
            <div className="subtle">Set the few options that should override the quickplay preset, then start immediately.</div>

            <div className="control-grid quickplay-control-grid">
              <label className="control-label">Tonic source
                <select
                  value={quickplayTonicSourceLevel}
                  onChange={(event) => setQuickplayTonicSourceLevel(Number(event.target.value) as QuickplayTonicSourceLevel)}
                >
                  <option value={1}>Level 1: Fixed tonic</option>
                  <option value={2}>Level 2: Fixed pool</option>
                  <option value={3}>Level 3: Fully randomized</option>
                </select>
              </label>
              <label className={tonicSelectionDisabled ? "control-label control-label--disabled" : "control-label"}>{tonicSelectionLabel}
                <select
                  value={quickplayTonicSourceLevel === 2 ? quickplayFixedPoolRoot : quickplayFixedTonic}
                  disabled={tonicSelectionDisabled}
                  onChange={(event) => {
                    const value = event.target.value as NoteName;
                    if (quickplayTonicSourceLevel === 2) {
                      setQuickplayFixedPoolRoot(value);
                      return;
                    }
                    setQuickplayFixedTonic(value);
                  }}
                >
                  {quickplayTonicSourceLevel === 2
                    ? quickplayPoolOptions().map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))
                    : NOTE_NAMES.map((note) => (
                      <option key={note} value={note}>{note}</option>
                    ))}
                </select>
              </label>
              <label className={intervalTopicSelected ? "control-label" : "control-label control-label--disabled"}>Interval level
                <select
                  value={quickplayIntervalLevel}
                  disabled={!intervalTopicSelected}
                  onChange={(event) => setQuickplayIntervalLevel(Number(event.target.value) as 1 | 2 | 3 | 4)}
                >
                  <option value={1}>{QUICKPLAY_INTERVAL_LEVEL_COPY[1]}</option>
                  <option value={2}>{QUICKPLAY_INTERVAL_LEVEL_COPY[2]}</option>
                  <option value={3}>{QUICKPLAY_INTERVAL_LEVEL_COPY[3]}</option>
                  <option value={4}>{QUICKPLAY_INTERVAL_LEVEL_COPY[4]}</option>
                </select>
              </label>
              <label className={degreeTopicSelected ? "control-label" : "control-label control-label--disabled"}>Degree level
                <select
                  value={quickplayDegreeLevel}
                  disabled={!degreeTopicSelected}
                  onChange={(event) => setQuickplayDegreeLevel(Number(event.target.value) as 1 | 2 | 3)}
                >
                  <option value={1}>1-5</option>
                  <option value={2}>+6/7</option>
                  <option value={3}>+b3/#4/b7</option>
                </select>
              </label>
              <div className="subtle quickplay-control-grid__description">{QUICKPLAY_TONIC_SOURCE_COPY[quickplayTonicSourceLevel]}</div>
            </div>

            <div className="control-group">
              <div className="subtle">Topics</div>
              <div className="chip-row">
                {QUICKPLAY_TOPIC_OPTIONS.filter((option) => getEnabledTrainingModes().includes(option.mode)).map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    className={quickplayTopics.includes(option.mode) ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                    aria-pressed={quickplayTopics.includes(option.mode)}
                    onClick={() => toggleQuickplayTopic(option.mode)}
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="button-row">
              <button type="button" onClick={startQuickplay}>Start quickplay</button>
              <button type="button" onClick={() => setQuickplayOverlayOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
