export type ScheduledEvent = {
  atBeats: number;     // position in beats from start
  durationBeats: number;
  freqHz?: number;     // for note
  freqsHz?: number[];  // for chord
  gain?: number;       // 0..1 relative to master
};

export function beatsToSeconds(beats: number, tempoBpm: number): number {
  return (60 / tempoBpm) * beats;
}