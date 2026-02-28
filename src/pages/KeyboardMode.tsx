import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { analyzePitchFrame, type PitchFrame } from "../audio/pitchDetection";
import { midiToFreq, midiToNoteName, NOTE_NAMES, type NoteName } from "../audio/music";
import {
  getSettings,
  setSettings as persistSettings,
  subscribeSettings,
  type AppSettings,
  type KeyboardAccidentalStyle,
  type KeyboardMiddleCMapping,
} from "../store/settingsStore";
import { getVoiceSettings } from "../store/voiceStore";

type KeyboardKey = {
  midi: number;
  name: NoteName;
  octave: number;
  isBlack: boolean;
  whiteIndex: number;
};

type VoiceNodes = {
  oscillator: OscillatorNode;
  gain: GainNode;
};

type ChordPattern = {
  intervals: number[];
  quality: string;
};

type IntervalPair = {
  fromMidi: number;
  toMidi: number;
  intervalLabel: string;
};

const MIDDLE_C_MIDI = 60;
const MAX_SIMULTANEOUS_NOTES = 4;
const EMPTY_FRAME: PitchFrame = {
  freqHz: null,
  midi: null,
  cents: null,
  clarity: 0,
  rms: 0,
  isSignal: false,
  noteLabel: null,
};

const SHORTCUT_ENTRIES_MIDDLE_C_B = [
  { shortcut: "z", midi: 53 },
  { shortcut: "s", midi: 54 },
  { shortcut: "x", midi: 55 },
  { shortcut: "d", midi: 56 },
  { shortcut: "c", midi: 57 },
  { shortcut: "f", midi: 58 },
  { shortcut: "v", midi: 59 },
  { shortcut: "b", midi: 60 },
  { shortcut: "h", midi: 61 },
  { shortcut: "n", midi: 62 },
  { shortcut: "j", midi: 63 },
  { shortcut: "m", midi: 64 },
  { shortcut: ",", midi: 65 },
  { shortcut: "l", midi: 66 },
  { shortcut: ".", midi: 67 },
  { shortcut: ";", midi: 68 },
  { shortcut: "/", midi: 69 },
  { shortcut: "'", midi: 70 },
  { shortcut: "q", midi: 71 },
  { shortcut: "w", midi: 72 },
  { shortcut: "3", midi: 73 },
  { shortcut: "e", midi: 74 },
  { shortcut: "4", midi: 75 },
  { shortcut: "r", midi: 76 },
  { shortcut: "t", midi: 77 },
  { shortcut: "6", midi: 78 },
  { shortcut: "y", midi: 79 },
  { shortcut: "7", midi: 80 },
  { shortcut: "u", midi: 81 },
  { shortcut: "8", midi: 82 },
  { shortcut: "i", midi: 83 },
  { shortcut: "o", midi: 84 },
  { shortcut: "0", midi: 85 },
  { shortcut: "p", midi: 86 },
  { shortcut: "-", midi: 87 },
  { shortcut: "[", midi: 88 },
  { shortcut: "]", midi: 89 },
  ] as const;

const SHORTCUT_ENTRIES_BY_MAPPING: Record<KeyboardMiddleCMapping, readonly { shortcut: string; midi: number }[]> = {
  B: SHORTCUT_ENTRIES_MIDDLE_C_B,
  W: SHORTCUT_ENTRIES_MIDDLE_C_B.map((entry) => ({
    shortcut: entry.shortcut,
    midi: entry.midi - 12,
  })),
};

const CHORD_PATTERNS: ChordPattern[] = [
  { intervals: [0, 3], quality: "minor dyad" },
  { intervals: [0, 4], quality: "major dyad" },
  { intervals: [0, 7], quality: "fifth dyad" },
  { intervals: [0, 3, 6], quality: "diminished triad" },
  { intervals: [0, 3, 7], quality: "minor triad" },
  { intervals: [0, 4, 7], quality: "major triad" },
  { intervals: [0, 4, 8], quality: "augmented triad" },
  { intervals: [0, 2, 7], quality: "sus2" },
  { intervals: [0, 5, 7], quality: "sus4" },
  { intervals: [0, 4, 7, 10], quality: "dominant 7" },
  { intervals: [0, 4, 7, 11], quality: "major 7" },
  { intervals: [0, 3, 7, 10], quality: "minor 7" },
  { intervals: [0, 3, 7, 11], quality: "minor-major 7" },
  { intervals: [0, 3, 6, 9], quality: "diminished 7" },
  { intervals: [0, 3, 6, 10], quality: "half-diminished 7" },
];

const INTERVAL_NAMES: Record<number, string> = {
  0: "P1",
  1: "m2",
  2: "M2",
  3: "m3",
  4: "M3",
  5: "P4",
  6: "TT",
  7: "P5",
  8: "m6",
  9: "M6",
  10: "m7",
  11: "M7",
  12: "P8",
  13: "m9",
  14: "M9",
  15: "m10",
  16: "M10",
  17: "P11",
  18: "TT+8",
  19: "P12",
  20: "m13",
  21: "M13",
  22: "m14",
  23: "M14",
  24: "P15",
};

const ACTIVE_NOTE_COLORS = ["#df4638", "#245db7", "#efc133", "#3d8a5f"] as const;
const SHARP_NOTE_NAMES: Record<NoteName, string> = {
  C: "C",
  Db: "C#",
  D: "D",
  Eb: "D#",
  E: "E",
  F: "F",
  Gb: "F#",
  G: "G",
  Ab: "G#",
  A: "A",
  Bb: "A#",
  B: "B",
};

function buildKeys(startMidi: number, endMidi: number) {
  let whiteIndex = 0;
  const keys: KeyboardKey[] = [];

  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    const note = midiToNoteName(midi);
    const isBlack = note.name.includes("b");
    keys.push({
      midi,
      name: note.name,
      octave: note.octave,
      isBlack,
      whiteIndex,
    });
    if (!isBlack) {
      whiteIndex += 1;
    }
  }

  return keys;
}
function arraysEqual(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatShortcut(shortcut: string) {
  return shortcut.toUpperCase();
}

function noteNameFromPitchClass(pitchClass: number) {
  return NOTE_NAMES[((pitchClass % 12) + 12) % 12];
}

function displayNoteName(noteName: NoteName, accidentalStyle: KeyboardAccidentalStyle) {
  if (accidentalStyle === "sharp") {
    return SHARP_NOTE_NAMES[noteName];
  }
  return noteName;
}

function displayMidiLabel(midi: number, accidentalStyle: KeyboardAccidentalStyle) {
  const note = midiToNoteName(midi);
  return `${displayNoteName(note.name, accidentalStyle)}${note.octave}`;
}

function intervalNameFromSemitones(semitones: number) {
  return INTERVAL_NAMES[semitones] ?? `${semitones} st`;
}

function describeChord(midis: number[], accidentalStyle: KeyboardAccidentalStyle) {
  if (midis.length === 0) {
    return "No notes pressed";
  }
  if (midis.length === 1) {
    return "Single note";
  }

  const uniquePitchClasses = Array.from(new Set(midis.map((midi) => ((midi % 12) + 12) % 12))).sort((a, b) => a - b);
  const bassPitchClass = ((midis[0] % 12) + 12) % 12;

  const matchCandidates = uniquePitchClasses.flatMap((rootPitchClass) => {
    const normalized = uniquePitchClasses
      .map((pitchClass) => (pitchClass - rootPitchClass + 12) % 12)
      .sort((a, b) => a - b);

    return CHORD_PATTERNS
      .filter((pattern) => arraysEqual(pattern.intervals, normalized))
      .map((pattern) => ({ rootPitchClass, quality: pattern.quality }));
  });

  const match = matchCandidates.find((candidate) => candidate.rootPitchClass === bassPitchClass) ?? matchCandidates[0];
  if (!match) {
    if (midis.length === 2) {
      return `${intervalNameFromSemitones(midis[1] - midis[0])} interval`;
    }
    return "Unrecognized chord shape";
  }

  const rootName = displayNoteName(noteNameFromPitchClass(match.rootPitchClass), accidentalStyle);
  const bassName = displayNoteName(noteNameFromPitchClass(bassPitchClass), accidentalStyle);
  return bassName === rootName ? `${rootName} ${match.quality}` : `${rootName} ${match.quality} / ${bassName}`;
}

function buildIntervalPairs(midis: number[]): IntervalPair[] {
  if (midis.length < 2) {
    return [];
  }

  return midis.slice(1).map((midi, index) => ({
    fromMidi: midis[index],
    toMidi: midi,
    intervalLabel: intervalNameFromSemitones(midi - midis[index]),
  }));
}

export default function KeyboardMode() {
  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [activeMidis, setActiveMidis] = useState<number[]>([]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [liveFrame, setLiveFrame] = useState<PitchFrame>(EMPTY_FRAME);
  const [micNoiseGate, setMicNoiseGate] = useState(() => Math.max(0.001, getVoiceSettings().noiseGate / 4));
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const voiceRef = useRef(new Map<number, VoiceNodes>());
  const activeSourcesRef = useRef(new Map<number, Set<string>>());
  const pointerSourcesRef = useRef(new Map<number, { sourceId: string; midi: number }>());
  const detectorContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const micRafRef = useRef<number | null>(null);
  const lastMicUiTickRef = useRef(0);
  const micNoiseGateRef = useRef(micNoiseGate);

  const sortedActiveMidis = useMemo(() => [...activeMidis].sort((a, b) => a - b), [activeMidis]);
  const shortcutEntries = useMemo(
    () => SHORTCUT_ENTRIES_BY_MAPPING[settings.keyboardMiddleCMapping],
    [settings.keyboardMiddleCMapping],
  );
  const keyboardStartMidi = shortcutEntries[0]?.midi ?? MIDDLE_C_MIDI;
  const keyboardEndMidi = shortcutEntries[shortcutEntries.length - 1]?.midi ?? MIDDLE_C_MIDI;
  const keyboardKeys = useMemo(() => buildKeys(keyboardStartMidi, keyboardEndMidi), [keyboardEndMidi, keyboardStartMidi]);
  const whiteKeys = useMemo(() => keyboardKeys.filter((key) => !key.isBlack), [keyboardKeys]);
  const shortcutsByMidi = useMemo(
    () => shortcutEntries.reduce((map, entry) => {
      const existing = map.get(entry.midi) ?? [];
      existing.push(entry.shortcut);
      map.set(entry.midi, existing);
      return map;
    }, new Map<number, string[]>()),
    [shortcutEntries],
  );
  const midiByShortcut = useMemo(
    () => new Map<string, number>(shortcutEntries.map((entry) => [entry.shortcut, entry.midi])),
    [shortcutEntries],
  );
  const activeColorByMidi = useMemo(
    () => new Map(sortedActiveMidis.map((midi, index) => [midi, ACTIVE_NOTE_COLORS[index] ?? ACTIVE_NOTE_COLORS[0]])),
    [sortedActiveMidis],
  );
  const chordSummary = describeChord(sortedActiveMidis, settings.keyboardAccidentalStyle);
  const intervalPairs = useMemo(() => buildIntervalPairs(sortedActiveMidis), [sortedActiveMidis]);
  const sungMidi = liveFrame.midi == null ? null : Math.round(liveFrame.midi);
  const sungMidiInRange = sungMidi != null && sungMidi >= keyboardStartMidi && sungMidi <= keyboardEndMidi ? sungMidi : null;
  const sungNoteSummary = sungMidi == null ? "Waiting for stable pitch" : displayMidiLabel(sungMidi, settings.keyboardAccidentalStyle);
  const sungPitchStatus = !micEnabled
    ? "Microphone off"
    : sungMidi == null
      ? liveFrame.isSignal ? "Searching for pitch" : "Below gate"
      : liveFrame.cents == null
        ? "Tracking pitch"
        : `${liveFrame.cents >= 0 ? "+" : ""}${Math.round(liveFrame.cents)} cents`;
  const sungPitchMeta = sungMidi == null
    ? "Sing a steady pitch and the nearest note in the excerpt will highlight."
    : `Clarity ${Math.round(liveFrame.clarity * 100)}% | Level ${liveFrame.rms.toFixed(3)}`;

  useEffect(() => subscribeSettings(() => setSettings(getSettings())), []);
  useEffect(() => {
    micNoiseGateRef.current = micNoiseGate;
  }, [micNoiseGate]);

  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.gain.value = settings.masterGain;
    }
    voiceRef.current.forEach(({ oscillator }) => {
      oscillator.type = settings.timbre;
    });
  }, [settings.masterGain, settings.timbre]);

  useEffect(() => {
    const onBlur = () => {
      releaseAllNotes();
    };

    const onPointerUp = (event: PointerEvent) => {
      releasePointerSource(event.pointerId);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const shortcut = event.key.toLowerCase();
      const midi = midiByShortcut.get(shortcut);
      if (midi == null) {
        return;
      }

      event.preventDefault();
      void pressNote(midi, `kbd:${shortcut}`);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const shortcut = event.key.toLowerCase();
      const midi = midiByShortcut.get(shortcut);
      if (midi == null) {
        return;
      }

      event.preventDefault();
      releaseNote(midi, `kbd:${shortcut}`);
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      releaseAllNotes();
    };
  }, [midiByShortcut, settings.masterGain, settings.timbre]);

  useEffect(() => {
    return () => {
      if (micRafRef.current != null) window.cancelAnimationFrame(micRafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      if (detectorContextRef.current != null) void detectorContextRef.current.close();
    };
  }, []);

  async function ensureAudio() {
    if (contextRef.current && masterRef.current) {
      if (contextRef.current.state !== "running") {
        await contextRef.current.resume();
      }
      return { context: contextRef.current, master: masterRef.current };
    }

    const AudioCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtor) {
      const message = "This browser does not support Web Audio.";
      setAudioError(message);
      throw new Error(message);
    }

    const context = new AudioCtor();
    const master = context.createGain();
    master.gain.value = settings.masterGain;
    master.connect(context.destination);

    contextRef.current = context;
    masterRef.current = master;

    if (context.state !== "running") {
      await context.resume();
    }

    setAudioError(null);
    return { context, master };
  }

  async function enableMic() {
    if (micEnabled) return;
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
      setMicEnabled(true);
      setMicError(null);
      setLiveFrame(EMPTY_FRAME);

      const tick = () => {
        const analyserNode = analyserRef.current;
        const detectorContext = detectorContextRef.current;
        const frameBuffer = frameBufferRef.current;
        if (!analyserNode || !detectorContext || !frameBuffer) return;

        analyserNode.getFloatTimeDomainData(frameBuffer);
        const frame = analyzePitchFrame(frameBuffer, detectorContext.sampleRate, micNoiseGateRef.current);
        const now = performance.now();

        if (now - lastMicUiTickRef.current > 70) {
          lastMicUiTickRef.current = now;
          setLiveFrame(frame);
        }
        micRafRef.current = window.requestAnimationFrame(tick);
      };

      micRafRef.current = window.requestAnimationFrame(tick);
    } catch (error) {
      setMicError(error instanceof Error ? error.message : "Microphone permission failed.");
      setMicEnabled(false);
      setLiveFrame(EMPTY_FRAME);
    }
  }

  async function disableMic() {
    if (micRafRef.current != null) {
      window.cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
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
    setMicEnabled(false);
    setMicError(null);
    setLiveFrame(EMPTY_FRAME);
  }

  function syncActiveState() {
    setActiveMidis(Array.from(activeSourcesRef.current.keys()).sort((a, b) => a - b));
  }

  async function pressNote(midi: number, sourceId: string) {
    const existingSources = activeSourcesRef.current.get(midi);
    if (existingSources?.has(sourceId)) {
      return;
    }
    if (!existingSources && activeSourcesRef.current.size >= MAX_SIMULTANEOUS_NOTES) {
      return;
    }

    const sourceSet = existingSources ?? new Set<string>();
    sourceSet.add(sourceId);
    activeSourcesRef.current.set(midi, sourceSet);
    syncActiveState();

    if (voiceRef.current.has(midi)) {
      return;
    }

    try {
      const { context, master } = await ensureAudio();
      const oscillator = context.createOscillator();
      oscillator.type = settings.timbre;
      oscillator.frequency.value = midiToFreq(midi);

      const gain = context.createGain();
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.36, now + 0.01);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);

      voiceRef.current.set(midi, { oscillator, gain });
    } catch (error) {
      activeSourcesRef.current.delete(midi);
      syncActiveState();
      setAudioError(error instanceof Error ? error.message : "Unable to start audio.");
    }
  }

  function releaseNote(midi: number, sourceId: string) {
    const sources = activeSourcesRef.current.get(midi);
    if (!sources) {
      return;
    }

    sources.delete(sourceId);
    if (sources.size > 0) {
      return;
    }

    activeSourcesRef.current.delete(midi);
    syncActiveState();

    const voice = voiceRef.current.get(midi);
    const context = contextRef.current;
    if (!voice || !context) {
      voiceRef.current.delete(midi);
      return;
    }

    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.06);

    try {
      voice.oscillator.stop(now + 0.08);
    } catch (error) {
      void error;
    }

    voice.oscillator.onended = () => {
      voice.gain.disconnect();
      voice.oscillator.disconnect();
    };
    voiceRef.current.delete(midi);
  }

  function releaseAllNotes() {
    Array.from(activeSourcesRef.current.entries()).forEach(([midi, sources]) => {
      Array.from(sources).forEach((sourceId) => releaseNote(midi, sourceId));
    });
    pointerSourcesRef.current.clear();
  }

  function beginPointerSource(pointerId: number, midi: number) {
    const sourceId = `ptr:${pointerId}`;
    const current = pointerSourcesRef.current.get(pointerId);
    if (current && current.midi !== midi) {
      releaseNote(current.midi, current.sourceId);
    }
    pointerSourcesRef.current.set(pointerId, { sourceId, midi });
    void pressNote(midi, sourceId);
  }

  function movePointerSource(pointerId: number, midi: number) {
    const current = pointerSourcesRef.current.get(pointerId);
    if (!current || current.midi === midi) {
      return;
    }

    releaseNote(current.midi, current.sourceId);
    pointerSourcesRef.current.set(pointerId, { sourceId: current.sourceId, midi });
    void pressNote(midi, current.sourceId);
  }

  function releasePointerSource(pointerId: number) {
    const current = pointerSourcesRef.current.get(pointerId);
    if (!current) {
      return;
    }
    releaseNote(current.midi, current.sourceId);
    pointerSourcesRef.current.delete(pointerId);
  }

  return (
    <div className="page keyboard-mode-page">
      <section className="panel panel--blue keyboard-analysis-panel">
        <div className="keyboard-analysis-header">
          <div className="keyboard-analysis-line">
            <span className="section-label kicker kicker--red">Pressed Notes</span>
            <div className="keyboard-analysis-notes">
              {sortedActiveMidis.length > 0 ? (
                sortedActiveMidis.map((midi) => {
                  const note = midiToNoteName(midi);
                  const noteColor = activeColorByMidi.get(midi) ?? ACTIVE_NOTE_COLORS[0];
                  return (
                    <span
                      key={midi}
                      className="keyboard-note-pill"
                      style={{ "--keyboard-note-color": noteColor } as CSSProperties}
                    >
                      <span className="keyboard-note-pill__text">{displayNoteName(note.name, settings.keyboardAccidentalStyle)}</span>
                    </span>
                  );
                })
              ) : (
                <div className="keyboard-analysis-value">Press notes</div>
              )}
            </div>
          </div>
          <button type="button" className="keyboard-analysis__mic-button" onClick={() => void (micEnabled ? disableMic() : enableMic())}>
            {micEnabled ? "Disable mic" : "Enable mic"}
          </button>
        </div>
        <div className="keyboard-analysis-grid">
          <div className="mini-stat keyboard-analysis-card">
            <div className="metric-card__label">Chord Type</div>
            <div className="keyboard-analysis-card__value">{chordSummary}</div>
          </div>
          <div className="mini-stat keyboard-analysis-card">
            <div className="metric-card__label">Adjacent Intervals</div>
            <div className="keyboard-analysis-card__value">
              {intervalPairs.length > 0 ? (
                <div className="keyboard-interval-list">
                  {intervalPairs.map((pair) => {
                    const fromNote = displayNoteName(midiToNoteName(pair.fromMidi).name, settings.keyboardAccidentalStyle);
                    const toNote = displayNoteName(midiToNoteName(pair.toMidi).name, settings.keyboardAccidentalStyle);
                    const fromColor = activeColorByMidi.get(pair.fromMidi) ?? ACTIVE_NOTE_COLORS[0];
                    const toColor = activeColorByMidi.get(pair.toMidi) ?? ACTIVE_NOTE_COLORS[0];

                    return (
                      <span key={`${pair.fromMidi}-${pair.toMidi}`} className="keyboard-interval-item">
                        <span className="keyboard-interval-note" style={{ "--keyboard-note-color": fromColor } as CSSProperties}>
                          {fromNote}
                        </span>
                        <span className="keyboard-interval-separator">-</span>
                        <span className="keyboard-interval-note" style={{ "--keyboard-note-color": toColor } as CSSProperties}>
                          {toNote}
                        </span>
                        <span className="keyboard-interval-separator">:</span>
                        <span>{pair.intervalLabel}</span>
                      </span>
                    );
                  })}
                </div>
              ) : (
                "Add another note to see intervals"
              )}
            </div>
          </div>
        </div>
        {micEnabled && (
          <div className="mini-stat keyboard-analysis-card keyboard-analysis-card--mic">
            <div className="metric-card__label">Sung Note</div>
            <div className="keyboard-analysis-card__value keyboard-analysis-card__value--large">{sungNoteSummary}</div>
            <div className="subtle">{sungPitchStatus}</div>
            <div className="subtle">{sungPitchMeta}</div>
            <label className="control-label keyboard-analysis-card__slider">
              <span>Mic sensitivity</span>
              <input
                type="range"
                min={0.001}
                max={0.02}
                step={0.001}
                value={micNoiseGate}
                onChange={(event) => setMicNoiseGate(Number(event.target.value))}
              />
              <span className="subtle">Gate {micNoiseGate.toFixed(3)} | lower = more sensitive</span>
            </label>
          </div>
        )}
        {audioError && <div className="notice notice--alert">{audioError}</div>}
        {micError && <div className="notice notice--alert">{micError}</div>}
      </section>

      <section className="panel keyboard-surface">
        <div className="panel-header">
          <div>
            <div className="section-label kicker kicker--blue keyboard-surface__kicker">
              {midiToNoteName(keyboardStartMidi).name}{midiToNoteName(keyboardStartMidi).octave}
              {" "}to{" "}
              {midiToNoteName(keyboardEndMidi).name}{midiToNoteName(keyboardEndMidi).octave} excerpt
            </div>
            <h2 className="panel-title keyboard-surface__title">Keyboard</h2>
          </div>
          <div className="keyboard-surface__controls">
            <label className="control-label keyboard-surface__mapping">
              <span>Middle C mapping</span>
              <select
                value={settings.keyboardMiddleCMapping}
                onChange={(event) => persistSettings({ ...settings, keyboardMiddleCMapping: event.target.value as KeyboardMiddleCMapping })}
              >
                <option value="B">Middle C = B</option>
                <option value="W">Middle C = W</option>
              </select>
            </label>
            <label className="control-label keyboard-surface__mapping">
              <span>Black keys</span>
              <select
                value={settings.keyboardAccidentalStyle}
                onChange={(event) => persistSettings({ ...settings, keyboardAccidentalStyle: event.target.value as KeyboardAccidentalStyle })}
              >
                <option value="flat">Flats (b)</option>
                <option value="sharp">Sharps (#)</option>
              </select>
            </label>
          </div>
        </div>

        <div className="keyboard-shell">
          <div className="keyboard-stage" aria-label="Three-octave keyboard">
            <div className="keyboard-whites" style={{ gridTemplateColumns: `repeat(${whiteKeys.length}, minmax(0, 1fr))` }}>
              {whiteKeys.map((key) => {
                const shortcuts = shortcutsByMidi.get(key.midi) ?? [];
                const isActive = activeMidis.includes(key.midi);
                const isMicActive = sungMidiInRange === key.midi;
                const isMiddleC = key.midi === MIDDLE_C_MIDI;
                const noteColor = activeColorByMidi.get(key.midi);
                const className = [
                  "keyboard-key",
                  "keyboard-key--white",
                  isActive ? "keyboard-key--active" : "",
                  isMicActive ? "keyboard-key--mic-active" : "",
                  isMiddleC ? "keyboard-key--middle-c" : "",
                ].filter(Boolean).join(" ");

                return (
                  <button
                    key={key.midi}
                    type="button"
                    className={className}
                    style={noteColor ? ({ "--keyboard-note-color": noteColor } as CSSProperties) : undefined}
                    onPointerDown={(event) => beginPointerSource(event.pointerId, key.midi)}
                    onPointerEnter={(event) => {
                      if (event.buttons > 0) {
                        movePointerSource(event.pointerId, key.midi);
                      }
                    }}
                    onPointerLeave={(event) => {
                      if (event.buttons === 0) {
                        releasePointerSource(event.pointerId);
                      }
                    }}
                    onPointerUp={(event) => releasePointerSource(event.pointerId)}
                    onPointerCancel={(event) => releasePointerSource(event.pointerId)}
                  >
                    <span className="keyboard-key__note">{displayNoteName(key.name, settings.keyboardAccidentalStyle)}{key.octave}</span>
                    <span className="keyboard-key__shortcut">
                      {shortcuts.map((shortcut) => formatShortcut(shortcut)).join(" / ")}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="keyboard-blacks">
              {keyboardKeys.filter((key) => key.isBlack).map((key) => {
                const shortcuts = shortcutsByMidi.get(key.midi) ?? [];
                const isActive = activeMidis.includes(key.midi);
                const isMicActive = sungMidiInRange === key.midi;
                const noteColor = activeColorByMidi.get(key.midi);
                const className = [
                  "keyboard-key",
                  "keyboard-key--black",
                  isActive ? "keyboard-key--active" : "",
                  isMicActive ? "keyboard-key--mic-active" : "",
                ].filter(Boolean).join(" ");

                return (
                  <button
                    key={key.midi}
                    type="button"
                    className={className}
                    style={{
                      left: `calc(${(key.whiteIndex / whiteKeys.length) * 100}% - 1.9rem)`,
                      ...(noteColor ? { "--keyboard-note-color": noteColor } : {}),
                    } as CSSProperties}
                    onPointerDown={(event) => beginPointerSource(event.pointerId, key.midi)}
                    onPointerEnter={(event) => {
                      if (event.buttons > 0) {
                        movePointerSource(event.pointerId, key.midi);
                      }
                    }}
                    onPointerLeave={(event) => {
                      if (event.buttons === 0) {
                        releasePointerSource(event.pointerId);
                      }
                    }}
                    onPointerUp={(event) => releasePointerSource(event.pointerId)}
                    onPointerCancel={(event) => releasePointerSource(event.pointerId)}
                  >
                    <span className="keyboard-key__note">{displayNoteName(key.name, settings.keyboardAccidentalStyle)}</span>
                    <span className="keyboard-key__shortcut">
                      {shortcuts.map((shortcut) => formatShortcut(shortcut)).join(" / ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
