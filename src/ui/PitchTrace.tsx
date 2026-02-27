type PitchTraceProps = {
  samples: Array<{ atMs: number; midi: number }>;
  targetMidis: number[];
  scoredMidis?: number[];
  height?: number;
};

export default function PitchTrace({ samples, targetMidis, scoredMidis = [], height = 180 }: PitchTraceProps) {
  if (samples.length === 0 && targetMidis.length === 0) {
    return (
      <div style={{ height, borderRadius: 10, background: "rgba(0,0,0,0.04)", display: "grid", placeItems: "center", fontSize: 13, opacity: 0.72 }}>
        No pitch trace yet
      </div>
    );
  }

  const sampleMidis = samples.map((sample) => sample.midi);
  const allMidis = [...sampleMidis, ...targetMidis, ...scoredMidis];
  const minMidi = Math.floor(Math.min(...allMidis)) - 1;
  const maxMidi = Math.ceil(Math.max(...allMidis)) + 1;
  const range = Math.max(1, maxMidi - minMidi);
  const width = 560;
  const startMs = samples[0]?.atMs ?? 0;
  const endMs = samples.at(-1)?.atMs ?? startMs + Math.max(1, targetMidis.length - 1) * 550;
  const duration = Math.max(1, endMs - startMs);

  const xFor = (atMs: number) => ((atMs - startMs) / duration) * width;
  const yFor = (midi: number) => height - ((midi - minMidi) / range) * height;
  const path = samples
    .map((sample, index) => `${index === 0 ? "M" : "L"} ${xFor(sample.atMs).toFixed(1)} ${yFor(sample.midi).toFixed(1)}`)
    .join(" ");

  const targetSpacing = duration / Math.max(1, targetMidis.length);

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, borderRadius: 10, background: "rgba(0,0,0,0.04)" }}>
        {Array.from({ length: range + 1 }, (_, idx) => {
          const midi = minMidi + idx;
          const y = yFor(midi);
          return (
            <line
              key={`grid_${midi}`}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke="rgba(0,0,0,0.08)"
              strokeWidth={midi % 12 === 0 ? 1.2 : 0.6}
            />
          );
        })}

        {targetMidis.map((midi, index) => {
          const x0 = index * targetSpacing;
          const x1 = Math.min(width, x0 + targetSpacing * 0.9);
          const y = yFor(midi);
          return (
            <line
              key={`target_${index}`}
              x1={x0}
              y1={y}
              x2={x1}
              y2={y}
              stroke="rgba(37, 99, 235, 0.75)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}

        {path.length > 0 && (
          <path
            d={path}
            fill="none"
            stroke="rgba(24, 120, 63, 0.95)"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {scoredMidis.map((midi, index) => {
          const x = Math.min(width - 10, index * targetSpacing + targetSpacing * 0.45);
          const y = yFor(midi);
          return (
            <circle
              key={`scored_${index}`}
              cx={x}
              cy={y}
              r={4.5}
              fill="rgba(180, 110, 18, 0.95)"
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.72 }}>
        <div>Blue: target</div>
        <div>Green: sung pitch</div>
        <div>Amber: scored centers</div>
      </div>
    </div>
  );
}
