import { useEffect, useMemo, useRef, useState } from "react";
import { engine } from "../audio/engine";
import { getEnabledVoiceExercises } from "../config/featureFlags";
import { analyzePitchFrame, type PitchFrame } from "../audio/pitchDetection";
import { midiToNoteLabel, rootMidiFromKey } from "../audio/music";
import { getWeakestAreas, recordAttempt, type WeakAreaSummary } from "../store/progressStore";
import { getSettings, subscribeSettings } from "../store/settingsStore";
import { getVoiceSettings, setVoiceSettings } from "../store/voiceStore";
import {
  buildVoiceExercise,
  calibrateTonicFromSamples,
  centsOffTarget,
  evaluateVoiceAttempt,
  extractPitchSegments,
  type VoiceExercise,
  type VoiceExerciseKind,
  type VoicePitchSample,
} from "../training/voice";
import type { TonalMode } from "../training/types";
import PitchTrace from "../ui/PitchTrace";

const ALL_EXERCISE_OPTIONS: Array<{ value: VoiceExerciseKind; label: string }> = [
  { value: "interval_echo", label: "Interval echo" },
  { value: "degree_match", label: "Degree over drone" },
];

const EXERCISE_OPTIONS: Array<{ value: VoiceExerciseKind; label: string }> = ALL_EXERCISE_OPTIONS
  .filter((option) => getEnabledVoiceExercises().includes(option.value));

const TONAL_OPTIONS: TonalMode[] = ["major", "natural_minor", "harmonic_minor", "melodic_minor", "modal"];

const EMPTY_FRAME: PitchFrame = {
  freqHz: null,
  midi: null,
  cents: null,
  clarity: 0,
  rms: 0,
  isSignal: false,
  noteLabel: null,
};

function tuningSummary(frame: PitchFrame, targetMidi: number | null, toleranceCents: number) {
  if (targetMidi == null || frame.midi == null) {
    return {
      label: frame.isSignal ? "Searching for pitch" : "Below gate",
      cents: null as number | null,
      tone: "neutral" as "neutral" | "good" | "warn",
    };
  }

  const cents = centsOffTarget(frame.midi, targetMidi);
  if (Math.abs(cents) <= toleranceCents) {
    return { label: "In tune", cents, tone: "good" as const };
  }
  return {
    label: cents > 0 ? "Sharp" : "Flat",
    cents,
    tone: "warn" as const,
  };
}

function promptFocusCopy(exercise: VoiceExercise) {
  if (exercise.kind === "interval_echo") {
    return "Hear the two-note move, then sing the same motion back in order.";
  }
  return "Lock into the drone, then sing the target degree and hold it steady.";
}

function promptSupportCopy(exercise: VoiceExercise) {
  if (exercise.targetLabels.length > 1) {
    return `Targets ${exercise.targetLabels.join(" -> ")}`;
  }
  return `Target ${exercise.targetLabels[0]}`;
}

function reinforcementSummary(area: WeakAreaSummary) {
  const mastery = Math.round(area.mastery * 100);

  if (area.mode === "functional_interval") {
    return `${area.label} is still unstable. You are averaging ${mastery}% mastery across ${area.attempts} scored interval attempts.`;
  }

  if (area.mode === "scale_degree") {
    return `${area.label} is lagging behind. You are averaging ${mastery}% mastery across ${area.attempts} scored degree matches.`;
  }

  return `${area.label} is one of the weakest recent voice buckets at ${mastery}% mastery over ${area.attempts} attempts.`;
}

function reinforcementAction(area: WeakAreaSummary) {
  if (area.mode === "functional_interval") {
    return "Replay the prompt once, sing the first note clearly, then exaggerate the motion into the destination note before tightening the pitch.";
  }

  if (area.mode === "scale_degree") {
    return "Stay on the drone longer before responding and aim for a stable center pitch before trying to finish the hold timer.";
  }

  return "Slow the response down, use the prompt as a reference, and prioritize pitch stability before speed.";
}

export default function VoicePractice() {
  const [settings, setSettings] = useState(getSettings());
  const [voiceSettings, setVoiceState] = useState(getVoiceSettings());
  const [tonalMode, setTonalMode] = useState<TonalMode>("major");
  const [tonicMidi, setTonicMidi] = useState<number | null>(null);
  const [exercise, setExercise] = useState<VoiceExercise | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveFrame, setLiveFrame] = useState<PitchFrame>(EMPTY_FRAME);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationNote, setCalibrationNote] = useState<string>("Not set");
  const [attemptActive, setAttemptActive] = useState(false);
  const [attemptSegmentCount, setAttemptSegmentCount] = useState(0);
  const [inTuneHoldMs, setInTuneHoldMs] = useState(0);
  const [result, setResult] = useState<ReturnType<typeof evaluateVoiceAttempt> | null>(null);
  const [traceSamples, setTraceSamples] = useState<VoicePitchSample[]>([]);
  const [lastScoredSamples, setLastScoredSamples] = useState<VoicePitchSample[]>([]);
  const [attemptMessage, setAttemptMessage] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState({ attempts: 0, correct: 0 });
  const [weakAreas, setWeakAreas] = useState<WeakAreaSummary[]>([]);
  const [showInputOverlay, setShowInputOverlay] = useState(false);
  const [showTopicOverlay, setShowTopicOverlay] = useState(false);
  const [showReinforcementOverlay, setShowReinforcementOverlay] = useState(false);

  const detectorContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const lastUiTickRef = useRef(0);
  const calibrationSamplesRef = useRef<VoicePitchSample[]>([]);
  const attemptSamplesRef = useRef<VoicePitchSample[]>([]);
  const calibrationTimerRef = useRef<number | null>(null);
  const voiceSettingsRef = useRef(voiceSettings);
  const calibratingRef = useRef(calibrating);
  const attemptActiveRef = useRef(attemptActive);
  const exerciseRef = useRef<VoiceExercise | null>(exercise);
  const attemptStartedAtRef = useRef<number | null>(null);
  const scoredAttemptRef = useRef(false);
  const traceTickRef = useRef(0);

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  useEffect(() => {
    calibratingRef.current = calibrating;
  }, [calibrating]);

  useEffect(() => {
    attemptActiveRef.current = attemptActive;
  }, [attemptActive]);

  useEffect(() => {
    exerciseRef.current = exercise;
  }, [exercise]);

  const resolvedTonicMidi = tonicMidi ?? rootMidiFromKey(settings.keyRoot, settings.octave);
  const activeTargetIndex = exercise == null
    ? 0
    : exercise.targetMidis.length <= 1
      ? 0
      : Math.min(attemptSegmentCount, exercise.targetMidis.length - 1);
  const activeTargetMidi = exercise?.targetMidis[activeTargetIndex] ?? null;
  const liveTuning = useMemo(
    () => tuningSummary(liveFrame, activeTargetMidi, voiceSettings.toleranceCents),
    [activeTargetMidi, liveFrame, voiceSettings.toleranceCents]
  );
  const sessionAccuracy = sessionStats.attempts === 0
    ? null
    : Math.round((sessionStats.correct / sessionStats.attempts) * 100);

  function persistVoice(next: typeof voiceSettings) {
    setVoiceState(next);
    setVoiceSettings(next);
  }

  function refreshWeakAreas() {
    setWeakAreas(getWeakestAreas({
      contextPrefix: "voice:",
      limit: 3,
      modePool: ["scale_degree", "functional_interval"],
    }));
  }

  function queueExercise(kind = voiceSettings.exerciseKind, tonic = resolvedTonicMidi, mode = tonalMode) {
    setAttemptActive(false);
    attemptActiveRef.current = false;
    attemptStartedAtRef.current = null;
    scoredAttemptRef.current = false;
    attemptSamplesRef.current = [];
    setAttemptSegmentCount(0);
    setInTuneHoldMs(0);
    setResult(null);
    setTraceSamples([]);
    setLastScoredSamples([]);
    setAttemptMessage(null);
    setExercise(buildVoiceExercise({ kind, tonicMidi: tonic, tonalMode: mode }));
  }

  useEffect(() => {
    queueExercise(voiceSettings.exerciseKind, resolvedTonicMidi, tonalMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTonicMidi, tonalMode, voiceSettings.exerciseKind]);

  useEffect(() => {
    refreshWeakAreas();
  }, []);

  useEffect(() => {
    if (!exercise?.droneMidi) {
      engine.clearDrone();
      return;
    }
    void engine.setDrone(
      exercise.droneMidi,
      { tempoBpm: settings.tempoBpm, masterGain: settings.masterGain, timbre: settings.timbre },
      0.14
    );
  }, [exercise, settings.masterGain, settings.tempoBpm, settings.timbre]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      if (calibrationTimerRef.current != null) window.clearTimeout(calibrationTimerRef.current);
      engine.clearDrone();
      engine.stopAll();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      if (detectorContextRef.current != null) void detectorContextRef.current.close();
    };
  }, []);

  async function enableMic() {
    if (micReady) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("This browser does not expose microphone input.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.12;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
      detectorContextRef.current = context;
      analyserRef.current = analyser;
      sourceRef.current = source;
      streamRef.current = stream;
      frameBufferRef.current = buffer;
      setMicReady(true);
      setMicError(null);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const detectorContext = detectorContextRef.current;
        const frameBuffer = frameBufferRef.current;
        if (!analyserNode || !detectorContext || !frameBuffer) return;

        analyserNode.getFloatTimeDomainData(frameBuffer);
        const frame = analyzePitchFrame(frameBuffer, detectorContext.sampleRate, voiceSettingsRef.current.noiseGate);
        const now = performance.now();

        if (frame.midi != null) {
          const sample: VoicePitchSample = { atMs: now, midi: frame.midi, rms: frame.rms };
          if (calibratingRef.current) calibrationSamplesRef.current.push(sample);
          if (attemptActiveRef.current) attemptSamplesRef.current.push(sample);
        }

        if (attemptActiveRef.current) {
          const segments = extractPitchSegments(attemptSamplesRef.current);
          setAttemptSegmentCount(segments.length);
          if (exerciseRef.current?.targetMidis.length === 1 && frame.midi != null) {
            const cents = centsOffTarget(frame.midi, exerciseRef.current.targetMidis[0]);
            const hold = Math.abs(cents) <= voiceSettingsRef.current.toleranceCents
              ? ((attemptSamplesRef.current.at(-1)?.atMs ?? now) - (segments.at(-1)?.startMs ?? now))
              : 0;
            setInTuneHoldMs(Math.max(0, Math.round(hold)));
            if (hold >= voiceSettingsRef.current.holdDurationMs && !scoredAttemptRef.current) {
              window.setTimeout(() => finishAttempt("auto"), 0);
            }
          } else {
            setInTuneHoldMs(0);
          }

          if (now - traceTickRef.current > 110) {
            traceTickRef.current = now;
            setTraceSamples([...attemptSamplesRef.current]);
          }
        } else {
          setAttemptSegmentCount(0);
          setInTuneHoldMs(0);
        }

        if (now - lastUiTickRef.current > 70) {
          lastUiTickRef.current = now;
          setLiveFrame(frame);
        }

        rafRef.current = window.requestAnimationFrame(tick);
      };

      rafRef.current = window.requestAnimationFrame(tick);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microphone permission failed.";
      setMicError(message);
      setMicReady(false);
    }
  }

  async function disableMic() {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    frameBufferRef.current = null;
    if (detectorContextRef.current != null) {
      await detectorContextRef.current.close();
      detectorContextRef.current = null;
    }
    setMicReady(false);
    setMicError(null);
    setCalibrating(false);
    setLiveFrame(EMPTY_FRAME);
    setAttemptActive(false);
    attemptActiveRef.current = false;
  }

  function playPrompt() {
    if (!exercise) return;
    void engine.play(exercise.promptPlan, {
      tempoBpm: settings.tempoBpm,
      masterGain: settings.masterGain,
      timbre: settings.timbre,
    });
  }

  function startAttempt() {
    if (!micReady || !exercise) return;
    attemptSamplesRef.current = [];
    attemptStartedAtRef.current = performance.now();
    scoredAttemptRef.current = false;
    traceTickRef.current = 0;
    setAttemptActive(true);
    attemptActiveRef.current = true;
    setAttemptSegmentCount(0);
    setInTuneHoldMs(0);
    setResult(null);
    setTraceSamples([]);
    setLastScoredSamples([]);
    setAttemptMessage(null);
  }

  function finishAttempt(reason: "manual" | "auto" = "manual") {
    const currentExercise = exerciseRef.current;
    if (!currentExercise || scoredAttemptRef.current) return;
    scoredAttemptRef.current = true;
    setAttemptActive(false);
    attemptActiveRef.current = false;
    const responseMs = Math.max(1, Math.round((performance.now() - (attemptStartedAtRef.current ?? performance.now()))));
    const samples = [...attemptSamplesRef.current];
    const scored = evaluateVoiceAttempt({
      exercise: currentExercise,
      samples,
      toleranceCents: voiceSettingsRef.current.toleranceCents,
    });
    setResult(scored);
    setTraceSamples(samples);
    setLastScoredSamples(samples);
    setAttemptMessage(reason === "auto" ? "Hold target reached. Attempt scored automatically." : null);
    recordAttempt({
      itemId: currentExercise.progressItemId,
      mode: currentExercise.progressMode,
      correct: scored.correct,
      responseMs,
      contextKey: currentExercise.contextKey,
      adaptiveKeys: currentExercise.adaptiveKeys,
    });
    setSessionStats((current) => ({
      attempts: current.attempts + 1,
      correct: current.correct + (scored.correct ? 1 : 0),
    }));
    refreshWeakAreas();
  }

  function startCalibration() {
    if (!micReady) return;
    calibrationSamplesRef.current = [];
    setCalibrating(true);
    setCalibrationNote("Listening for a steady tonic...");
    if (calibrationTimerRef.current != null) window.clearTimeout(calibrationTimerRef.current);
    calibrationTimerRef.current = window.setTimeout(() => {
      const nextTonic = calibrateTonicFromSamples(calibrationSamplesRef.current);
      setCalibrating(false);
      if (nextTonic == null) {
        setCalibrationNote("No stable tonic captured");
        return;
      }
      setTonicMidi(nextTonic);
      setCalibrationNote(midiToNoteLabel(nextTonic));
      queueExercise(voiceSettingsRef.current.exerciseKind, nextTonic, tonalMode);
    }, 2200);
  }

  const resultTone = liveTuning.tone === "good"
    ? "rgba(24, 120, 63, 0.12)"
    : liveTuning.tone === "warn"
      ? "rgba(180, 110, 18, 0.14)"
      : "rgba(0,0,0,0.05)";

  return (
    <div className="page">
      <div style={{ display: "grid", gap: "0.45rem" }}>
        <h2 style={{ margin: 0 }}>Voice Practice</h2>
        <div className="subtle">
          Focus on the sung prompt, then use the live feedback panel to correct the response in real time.
        </div>
      </div>

      <div className="voice-layout">
        <div className="voice-prompt-shell">
          <div className="voice-prompt-shell__tools">
            <button type="button" onClick={() => void (micReady ? disableMic() : enableMic())}>
              {micReady ? "Disable mic" : "Enable mic"}
            </button>
            <button type="button" onClick={() => setShowInputOverlay(true)}>Settings</button>
            <button type="button" onClick={() => setShowTopicOverlay(true)}>Topic mode</button>
            <button type="button" onClick={() => setShowReinforcementOverlay(true)}>Reinforcement</button>
          </div>
        </div>

        <section className="panel panel--accent voice-feedback-panel">
          <div className="voice-feedback-panel__header">
            <div className="voice-feedback-panel__copy">
              <div className="panel-title">{exercise?.label ?? "Voice Practice"}</div>
              <div className="subtle">{exercise ? promptFocusCopy(exercise) : "Load a voice prompt to begin."}</div>
            </div>
            <div className="voice-feedback-panel__stats">
              <div className="metric-card">
                <div className="metric-card__label">Target</div>
                <div className="metric-card__value">{exercise ? promptSupportCopy(exercise).replace("Targets ", "").replace("Target ", "") : "--"}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Tonic</div>
                <div className="metric-card__value">{exercise ? midiToNoteLabel(exercise.tonicMidi) : "--"}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Mode</div>
                <div className="metric-card__value">{tonalMode.replace("_", " ")}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Accuracy</div>
                <div className="metric-card__value">
                  {sessionStats.correct}/{sessionStats.attempts}
                  {sessionAccuracy != null ? ` (${sessionAccuracy}%)` : ""}
                </div>
              </div>
            </div>
          </div>

          <PitchTrace
            samples={traceSamples}
            targetMidis={exercise?.targetMidis ?? []}
            scoredMidis={result?.scoredMidis}
          />

          <div className="notice voice-feedback-panel__notice voice-feedback-panel__notice--compact" style={{ background: resultTone }}>
            <div className="voice-feedback-panel__notice-row">
              <div className="voice-feedback-panel__headline voice-feedback-panel__headline--small">
                {liveTuning.cents != null ? `${Math.round(liveTuning.cents)} cents` : liveTuning.label}
              </div>
              {attemptActive && exercise?.targetMidis.length === 1 && (
                <div className="chip">
                  Hold {Math.min(inTuneHoldMs, voiceSettings.holdDurationMs)} / {voiceSettings.holdDurationMs} ms
                </div>
              )}
              {attemptMessage && <div className="chip">{attemptMessage}</div>}
            </div>
            <div className="subtle">
              {liveTuning.cents == null
                ? "No stable pitch is being tracked yet."
                : `Tracking ${exercise?.targetLabels[activeTargetIndex] ?? "target"} at ${voiceSettings.toleranceCents}-cent tolerance.`}
            </div>
          </div>

          <div className="button-row">
            <button onClick={playPrompt}>Play prompt</button>
            <button onClick={() => queueExercise()}>New prompt</button>
            <button onClick={startAttempt} disabled={!micReady || attemptActive}>Start attempt</button>
            <button onClick={() => finishAttempt("manual")} disabled={!attemptActive}>Finish attempt</button>
          </div>

          {result ? (
            <div className="feedback-block voice-result-card">
              <div className="voice-result-card__header">
                <div className="panel-title">{result.correct ? "Matched" : "Try again"}</div>
                <div className="subtle">{result.summary}</div>
              </div>
              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-card__label">Hits in tolerance</div>
                  <div className="metric-card__value">{result.matched}/{result.expected}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card__label">Captured samples</div>
                  <div className="metric-card__value">{lastScoredSamples.length}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card__label">Reinforcement queue</div>
                  <div className="metric-card__value">{weakAreas.length}</div>
                </div>
              </div>
              {result.centsOff.length > 0 && (
                <div className="chip-row">
                  {result.centsOff.map((cents, index) => (
                    <div key={`${exercise?.id ?? "voice"}_${index}`} className="chip">
                      {exercise?.targetLabels[index] ?? index + 1}: {Math.round(cents)} cents
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="feedback-block voice-result-card">
              <div className="panel-title">Awaiting scored attempt</div>
              <div className="subtle">
                The scored summary appears here after you finish an attempt. Use the prompt card to replay or generate a new cue if needed.
              </div>
            </div>
          )}
        </section>
      </div>

      {showInputOverlay && (
        <div className="mode-overlay" onClick={() => setShowInputOverlay(false)} role="presentation">
          <div
            className="mode-overlay__panel mode-overlay__panel--wide mode-overlay__panel--compact"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-input-settings-title"
          >
            <div id="voice-input-settings-title" className="panel-title">Input settings</div>
            <div className="subtle">
              Configure the microphone and tracking thresholds here so the main screen can stay focused on the prompt and response.
            </div>
            <div className="button-row">
              <button onClick={startCalibration} disabled={!micReady || calibrating}>Calibrate tonic</button>
              <div className="meta-pill">
                {micReady ? "Microphone ready" : "Microphone required"}
                {micError ? ` | ${micError}` : ""}
                {calibrating ? " | capturing..." : ""}
              </div>
            </div>
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-card__label">Tonic</div>
                <div className="metric-card__value">{tonicMidi == null ? `${settings.keyRoot}${settings.octave}` : calibrationNote}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Detected</div>
                <div className="metric-card__value">{liveFrame.noteLabel ?? "none"}</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Clarity</div>
                <div className="metric-card__value">{Math.round(liveFrame.clarity * 100)}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-card__label">Level</div>
                <div className="metric-card__value">{liveFrame.rms.toFixed(3)}</div>
              </div>
            </div>
            <div className="control-grid">
              <label className="control-label">Noise gate
                <input
                  type="range"
                  min={0.005}
                  max={0.05}
                  step={0.001}
                  value={voiceSettings.noiseGate}
                  onChange={(e) => persistVoice({ ...voiceSettings, noiseGate: Number(e.target.value) })}
                />
                <span>{voiceSettings.noiseGate.toFixed(3)}</span>
              </label>
              <label className="control-label">Tolerance
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={1}
                  value={voiceSettings.toleranceCents}
                  onChange={(e) => persistVoice({ ...voiceSettings, toleranceCents: Number(e.target.value) })}
                />
                <span>{voiceSettings.toleranceCents} cents</span>
              </label>
              <label className="control-label">Steady hold
                <input
                  type="range"
                  min={400}
                  max={1600}
                  step={100}
                  value={voiceSettings.holdDurationMs}
                  onChange={(e) => persistVoice({ ...voiceSettings, holdDurationMs: Number(e.target.value) })}
                />
                <span>{voiceSettings.holdDurationMs} ms</span>
              </label>
            </div>
            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowInputOverlay(false)}>
              Close input settings
            </button>
          </div>
        </div>
      )}

      {showTopicOverlay && (
        <div className="mode-overlay" onClick={() => setShowTopicOverlay(false)} role="presentation">
          <div
            className="mode-overlay__panel mode-overlay__panel--wide mode-overlay__panel--compact"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-topic-settings-title"
          >
            <div id="voice-topic-settings-title" className="panel-title">Topic mode</div>
            <div className="subtle">
              Choose the voice exercise and tonal context here without crowding the main response screen.
            </div>
            <div className="chip-row">
              {EXERCISE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={voiceSettings.exerciseKind === option.value ? "toggle-chip toggle-chip--active" : "toggle-chip"}
                  aria-pressed={voiceSettings.exerciseKind === option.value}
                  onClick={() => {
                    const next = { ...voiceSettings, exerciseKind: option.value };
                    persistVoice(next);
                    queueExercise(option.value, resolvedTonicMidi, tonalMode);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="control-grid">
              <label className="control-label">Tonal mode
                <select value={tonalMode} onChange={(e) => setTonalMode(e.target.value as TonalMode)}>
                  {TONAL_OPTIONS.map((mode) => (
                    <option value={mode} key={mode}>{mode.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowTopicOverlay(false)}>
              Close topic mode
            </button>
          </div>
        </div>
      )}

      {showReinforcementOverlay && (
        <div className="mode-overlay" onClick={() => setShowReinforcementOverlay(false)} role="presentation">
          <div
            className="mode-overlay__panel mode-overlay__panel--wide mode-overlay__panel--compact"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-reinforcement-title"
          >
            <div id="voice-reinforcement-title" className="panel-title">Reinforcement</div>
            <div className="subtle">
              These are the voice areas the tracker currently considers least stable. Use them to decide what to repeat before chasing more speed.
            </div>
            {weakAreas.length === 0 ? (
              <div className="panel-copy">No weak voice buckets yet. Complete a few scored attempts and this overlay will start prioritizing what needs extra reps.</div>
            ) : (
              <div className="list-stack">
                {weakAreas.map((area) => (
                  <div key={area.context + area.key} className="list-row voice-reinforcement-row">
                    <div className="voice-reinforcement-row__header">
                      <div style={{ fontWeight: 700 }}>{area.label}</div>
                      <div className="chip-row">
                        <div className="chip">Mastery {Math.round(area.mastery * 100)}%</div>
                        <div className="chip">Attempts {area.attempts}</div>
                        <div className="chip">Mode {area.mode.replace("_", " ")}</div>
                        {area.dueNow && <div className="chip">Due now</div>}
                      </div>
                    </div>
                    <div className="subtle">{reinforcementSummary(area)}</div>
                    <div className="panel-copy">{reinforcementAction(area)}</div>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="mode-overlay__dismiss" onClick={() => setShowReinforcementOverlay(false)}>
              Close reinforcement
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
