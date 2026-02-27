export const NOTE_NAMES = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] as const;
export type NoteName = typeof NOTE_NAMES[number];

export function noteNameToSemitone(name: NoteName): number {
  return NOTE_NAMES.indexOf(name);
}

export function midiToFreq(midi: number): number {
  // A4 = 440 at midi 69
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440);
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function rootMidiFromKey(key: NoteName, octave: number): number {
  // octave is MIDI octave number where C4 = 60 => octave 4
  // so C(octave) midi = 12*(octave+1)
  const cMidi = 12 * (octave + 1);
  return cMidi + noteNameToSemitone(key);
}

export function transposeMidi(midi: number, semitones: number): number {
  return midi + semitones;
}

export function midiToNoteName(midi: number): { name: NoteName; octave: number } {
  const rounded = Math.round(midi);
  const semitone = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return {
    name: NOTE_NAMES[semitone],
    octave,
  };
}

export function midiToNoteLabel(midi: number): string {
  const note = midiToNoteName(midi);
  return `${note.name}${note.octave}`;
}

export type ChordQuality = "maj" | "min" | "dim" | "aug";

export function buildTriad(rootMidi: number, quality: ChordQuality): number[] {
  const third = quality === "maj" ? 4 : quality === "min" ? 3 : quality === "dim" ? 3 : 4;
  const fifth = quality === "maj" ? 7 : quality === "min" ? 7 : quality === "dim" ? 6 : 8;
  return [rootMidi, rootMidi + third, rootMidi + fifth];
}
