type PianoRollProps = {
  midis: number[];
  tonicMidi?: number;
  width?: number;
  height?: number;
};

type KeyRect = {
  midi: number;
  x: number;
  width: number;
  isBlack: boolean;
};

const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

function isBlackKey(midi: number) {
  return BLACK_SEMITONES.has(((midi % 12) + 12) % 12);
}

function floorToC(midi: number) {
  const semitone = ((midi % 12) + 12) % 12;
  return midi - semitone;
}

function ceilToB(midi: number) {
  const semitone = ((midi % 12) + 12) % 12;
  return midi + (11 - semitone);
}

export default function PianoRoll({ midis, tonicMidi, width = 320, height = 120 }: PianoRollProps) {
  if (midis.length === 0) return null;

  const minMidi = Math.min(...midis, tonicMidi ?? 127);
  const maxMidi = Math.max(...midis, tonicMidi ?? 0);
  const low = Math.max(24, floorToC(minMidi - 1));
  const high = Math.min(96, ceilToB(maxMidi + 1));
  const midiRange = Array.from({ length: high - low + 1 }, (_, index) => low + index);
  const whiteMidis = midiRange.filter((midi) => !isBlackKey(midi));
  const whiteKeyWidth = width / Math.max(1, whiteMidis.length);
  const blackKeyWidth = whiteKeyWidth * 0.62;
  const blackKeyHeight = height * 0.62;
  const activeSet = new Set(midis);

  const keyRects: KeyRect[] = [];
  let whiteIndex = 0;

  for (const midi of midiRange) {
    if (!isBlackKey(midi)) {
      keyRects.push({
        midi,
        x: whiteIndex * whiteKeyWidth,
        width: whiteKeyWidth,
        isBlack: false,
      });
      whiteIndex += 1;
      continue;
    }

    keyRects.push({
      midi,
      x: Math.max(0, whiteIndex * whiteKeyWidth - blackKeyWidth * 0.5),
      width: blackKeyWidth,
      isBlack: true,
    });
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Keyboard view">
      <rect x={0} y={0} width={width} height={height} rx={10} fill="rgba(0,0,0,0.03)" />

      {keyRects.filter((key) => !key.isBlack).map((key) => {
        const isActive = activeSet.has(key.midi);
        const isTonic = tonicMidi === key.midi;
        return (
          <rect
            key={`white_${key.midi}`}
            x={key.x}
            y={0}
            width={key.width}
            height={height}
            fill={isActive ? "rgba(199,91,18,0.22)" : "rgba(255,255,255,0.96)"}
            stroke={isTonic ? "rgba(24,95,220,0.75)" : "rgba(0,0,0,0.18)"}
            strokeWidth={isTonic ? 2 : 1}
          />
        );
      })}

      {keyRects.filter((key) => key.isBlack).map((key) => {
        const isActive = activeSet.has(key.midi);
        const isTonic = tonicMidi === key.midi;
        return (
          <rect
            key={`black_${key.midi}`}
            x={key.x}
            y={0}
            width={key.width}
            height={blackKeyHeight}
            rx={4}
            fill={isActive ? "rgba(199,91,18,0.78)" : "rgba(20,33,61,0.9)"}
            stroke={isTonic ? "rgba(24,95,220,0.9)" : "rgba(0,0,0,0.45)"}
            strokeWidth={isTonic ? 2 : 1}
          />
        );
      })}
    </svg>
  );
}
