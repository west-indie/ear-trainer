import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { TrainingMode } from "../training/types";

type SelectableMode = {
  mode: TrainingMode;
  title: string;
  description: string;
};

const TRAINING_CARDS: SelectableMode[] = [
  {
    mode: "functional_interval",
    title: "Intervals",
    description: "Functional movement against tonic.",
  },
  {
    mode: "scale_degree",
    title: "Scale Degrees",
    description: "Anchored tonic hearing with stability feedback.",
  },
];

export default function ModePicker() {
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState<SelectableMode | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  const overlayPanelRef = useRef<HTMLDivElement | null>(null);
  const overlayTitle = useMemo(() => {
    if (!selectedMode) return "";
    return `${selectedMode.title} Mode`;
  }, [selectedMode]);

  function closeOverlay() {
    setSelectedMode(null);
  }

  function chooseDestination(path: string) {
    if (!selectedMode) return;
    navigate(`${path}?mode=${selectedMode.mode}`);
    setSelectedMode(null);
  }

  function chooseQuickplay() {
    if (!selectedMode) return;
    const next = new URLSearchParams({
      quickplay: "default",
      quickplayTopics: selectedMode.mode,
      quickplayTonicLevel: "1",
      quickplayFixedTonic: "C",
      quickplayFixedPool: "C",
      quickplayIntervalLevel: "1",
      quickplayDegreeLevel: "1",
    });
    navigate(`/practice?${next.toString()}`);
    setSelectedMode(null);
  }

  useEffect(() => {
    if (!selectedMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedMode(null);
        return;
      }
      if (event.key !== "Tab") return;

      const panel = overlayPanelRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || active == null || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || active == null || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMode]);

  useEffect(() => {
    if (!selectedMode) return;
    firstActionRef.current?.focus();
  }, [selectedMode]);

  return (
    <>
      <div className="split-grid">
        {TRAINING_CARDS.map((card) => (
          <button
            key={card.mode}
            type="button"
            className="mode-card mode-card--button mode-card--practice"
            onClick={() => setSelectedMode(card)}
          >
            <div className="kicker kicker--red">Practice Track</div>
            <div className="mode-card__title">{card.title}</div>
            <div className="mode-card__copy">{card.description}</div>
          </button>
        ))}
        <Link to="/voice" className="mode-card mode-card--voice">
          <div className="kicker kicker--blue">Voice Track</div>
          <div className="mode-card__title">Voice Match</div>
          <div className="mode-card__copy">Mic calibration, tuning feedback, and sing-back response drills.</div>
        </Link>
      </div>

      {selectedMode && (
        <div className="mode-overlay" onClick={closeOverlay} role="presentation">
          <div
            ref={overlayPanelRef}
            className="mode-overlay__panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mode-overlay-title"
          >
            <div id="mode-overlay-title" className="panel-title">{overlayTitle}</div>
            <div className="subtle">
              Choose how you want to work on {selectedMode.title.toLowerCase()} right now.
            </div>
            <div className="mode-overlay__actions">
              <button
                ref={firstActionRef}
                type="button"
                className="mode-overlay__option"
                onClick={chooseQuickplay}
              >
                <span className="mode-overlay__option-title">Quickplay</span>
                <span className="mode-overlay__option-copy">Jump straight into the quickplay preset with this topic preselected.</span>
              </button>
              <button
                type="button"
                className="mode-overlay__option"
                onClick={() => chooseDestination("/practice")}
              >
                <span className="mode-overlay__option-title">Open Practice</span>
                <span className="mode-overlay__option-copy">Custom drill mode with adjustable settings and a freer session flow.</span>
              </button>
            </div>
            <button type="button" className="mode-overlay__dismiss" onClick={closeOverlay}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
