import { beatsToSeconds } from "./scheduler";
import type { ScheduledEvent } from "./scheduler";
import { midiToFreq } from "./music";
import type { Timbre } from "../store/settingsStore";

type EngineState = "idle" | "ready" | "playing";

export type PlaybackPlan =
  | { kind: "note"; midi: number; durationBeats: number; atBeats?: number; gain?: number }
  | { kind: "chord"; midis: number[]; durationBeats: number; atBeats?: number; gain?: number }
  | { kind: "sequence"; events: ScheduledEvent[] }
  | { kind: "drone"; midi: number; gain?: number };

export type EngineConfig = {
  tempoBpm: number;
  masterGain: number;
  timbre: Timbre;
};

export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private state: EngineState = "idle";
  private preparedPlanCache = new Map<string, ScheduledEvent[]>();

  private activeNodes: AudioNode[] = [];
  private droneOsc: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;

  getState() {
    return this.state;
  }

  async init() {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      throw new Error("Web Audio API is not available in this browser.");
    }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.2;
    this.master.connect(this.ctx.destination);
    this.state = "ready";
  }

  async ensureRunning() {
    await this.init();
    if (!this.ctx) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  async warm() {
    await this.init();
  }

  setMasterGain(value: number) {
    if (!this.master) return;
    this.master.gain.value = value;
  }

  stopAll() {
    // stop scheduled/playing nodes
    for (const n of this.activeNodes) {
      if (n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch (error) {
          void error;
        }
      }
      try {
        n.disconnect();
      } catch (error) {
        void error;
      }
    }
    this.activeNodes = [];
    this.state = this.ctx ? "ready" : "idle";
  }

  private makeVoice(freqHz: number, timbre: Timbre, startTime: number, stopTime: number, gain: number) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = timbre;
    osc.frequency.value = freqHz;

    const g = this.ctx.createGain();
    // clickless envelope
    const a = 0.008;
    const r = 0.03;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gain, startTime + a);
    g.gain.setValueAtTime(gain, Math.max(startTime + a, stopTime - r));
    g.gain.linearRampToValueAtTime(0, stopTime);

    osc.connect(g);
    g.connect(this.master);

    osc.start(startTime);
    osc.stop(stopTime + 0.02);

    this.activeNodes.push(osc, g);
  }

  async play(plan: PlaybackPlan, cfg: EngineConfig) {
    await this.ensureRunning();
    if (!this.ctx) return;

    this.stopAll();
    this.setMasterGain(cfg.masterGain);
    this.state = "playing";

    const now = this.ctx.currentTime;
    const tempo = cfg.tempoBpm;

    const scheduleNote = (freqHz: number, atBeats: number, durationBeats: number, gain = 0.9) => {
      const t0 = now + beatsToSeconds(atBeats, tempo);
      const t1 = t0 + beatsToSeconds(durationBeats, tempo);
      this.makeVoice(freqHz, cfg.timbre, t0, t1, gain);
    };

    const scheduleChord = (freqsHz: number[], atBeats: number, durationBeats: number, gain = 0.75) => {
      for (const f of freqsHz) scheduleNote(f, atBeats, durationBeats, gain / Math.max(1, freqsHz.length * 0.75));
    };

    if (plan.kind === "note") {
      scheduleNote(midiToFreq(plan.midi), plan.atBeats ?? 0, plan.durationBeats, plan.gain ?? 0.9);
      return;
    }

    if (plan.kind === "chord") {
      scheduleChord(plan.midis.map(midiToFreq), plan.atBeats ?? 0, plan.durationBeats, plan.gain ?? 0.75);
      return;
    }

    if (plan.kind === "sequence") {
      const preparedEvents = this.prepareSequence(plan);
      for (const ev of preparedEvents) {
        const gain = ev.gain ?? 0.85;
        if (ev.freqHz != null) scheduleNote(ev.freqHz, ev.atBeats, ev.durationBeats, gain);
        else if (ev.freqsHz) scheduleChord(ev.freqsHz, ev.atBeats, ev.durationBeats, gain);
      }
      return;
    }

    if (plan.kind === "drone") {
      this.setDrone(plan.midi, cfg, plan.gain ?? 0.18);
      return;
    }
  }

  async setDrone(midi: number, cfg: EngineConfig, gain = 0.18) {
    await this.ensureRunning();
    if (!this.ctx || !this.master) return;

    // already running? update pitch + gain
    if (this.droneOsc && this.droneGain) {
      this.droneOsc.frequency.setValueAtTime(midiToFreq(midi), this.ctx.currentTime);
      this.droneGain.gain.setValueAtTime(gain, this.ctx.currentTime);
      return;
    }

    // create drone
    const osc = this.ctx.createOscillator();
    osc.type = cfg.timbre;
    osc.frequency.value = midiToFreq(midi);

    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + 0.03);

    osc.connect(g);
    g.connect(this.master);
    osc.start();

    this.droneOsc = osc;
    this.droneGain = g;
  }

  clearDrone() {
    if (!this.ctx) return;
    if (this.droneGain) {
      const t = this.ctx.currentTime;
      this.droneGain.gain.cancelScheduledValues(t);
      this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
      this.droneGain.gain.linearRampToValueAtTime(0, t + 0.05);
    }
    if (this.droneOsc) {
      try {
        this.droneOsc.stop(this.ctx.currentTime + 0.06);
      } catch (error) {
        void error;
      }
      try {
        this.droneOsc.disconnect();
      } catch (error) {
        void error;
      }
    }
    if (this.droneGain) {
      try {
        this.droneGain.disconnect();
      } catch (error) {
        void error;
      }
    }
    this.droneOsc = null;
    this.droneGain = null;
  }

  private prepareSequence(plan: Extract<PlaybackPlan, { kind: "sequence" }>) {
    const key = JSON.stringify(plan.events);
    const cached = this.preparedPlanCache.get(key);
    if (cached) return cached;

    const prepared = plan.events.map((event) => ({ ...event }));
    this.preparedPlanCache.set(key, prepared);
    if (this.preparedPlanCache.size > 40) {
      const oldestKey = this.preparedPlanCache.keys().next().value;
      if (oldestKey) this.preparedPlanCache.delete(oldestKey);
    }
    return prepared;
  }
}
