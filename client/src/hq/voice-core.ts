// The pure half of the HQ console's voice (voice-core.test.ts): turning microphone samples into a 16 kHz WAV for the
// local Whisper, and telling speech from silence for "always listening".

/** Whisper's rate: smaller uploads, nothing lost for speech. */
export const WAV_RATE = 16_000;

/** Mono float samples -> a lower rate, averaging each output sample's span (a crude low-pass that is fine for speech). */
export function downsample(input: Float32Array, inRate: number, outRate = WAV_RATE): Float32Array {
  if (outRate >= inRate) return input.slice();
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

/** A 16-bit PCM mono WAV file of `samples` (clipped to [-1, 1]). */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Loudness of one frame (root mean square, 0..1). */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/** Joins frames into one buffer. */
export function concat(frames: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

export interface VadOptions {
  /** Quietest level that can count as speech (RMS), however quiet the room. */
  floor: number;
  /** Speech must be this many times louder than the room's noise. */
  ratio: number;
  /** Loud this long (ms) before it counts as speech (a cough or a click does not). */
  startMs: number;
  /** Quiet this long (ms) ends the sentence. */
  silenceMs: number;
  /** A sentence never runs longer than this (ms). */
  maxMs: number;
}

export const VAD_DEFAULTS: VadOptions = { floor: 0.012, ratio: 3, startMs: 120, silenceMs: 900, maxMs: 30_000 };

/** Sensitivity 0..1 (the setting) -> the floor: more sensitive hears quieter voices (and more of the room). */
export function floorFor(sensitivity: number): number {
  const s = Math.max(0, Math.min(1, sensitivity));
  return 0.03 * (1 - s) + 0.004 * s;
}

/** The room's noise is the quietest level over this long (speech always has gaps between words; a fan does not). */
export const NOISE_WINDOW_MS = 2000;
/** Right after the microphone opens, only listen to the room. */
export const CALIBRATE_MS = 500;

/**
 * Speech detection for "always listening": feed it each frame's loudness; it says when a sentence starts (it was loud
 * for `startMs`; the start is dated back to when it got loud) and when it ends (quiet for `silenceMs`, or `maxMs`). The
 * room's noise is the quietest moment of the last two seconds, so a fan, a hum or a busy street never counts as
 * talking, yet a voice over them does.
 */
export class Vad {
  private hist: number[] = [];
  private heardMs = 0;
  private loudMs = 0;
  private quietMs = 0;
  private startedAt = 0;
  speaking = false;

  constructor(private readonly opts: VadOptions = VAD_DEFAULTS) {}

  /** The level speech must reach now. */
  gate(): number {
    let noise = Infinity;
    for (const v of this.hist) if (v < noise) noise = v;
    return Math.max(this.opts.floor, (Number.isFinite(noise) ? noise : 0) * this.opts.ratio);
  }

  /** One frame of `frameMs` ending at `t` (ms). */
  feed(level: number, frameMs: number, t: number): { event: 'start'; at: number } | { event: 'end'; durationMs: number } | null {
    const gate = this.gate();
    this.hist.push(level);
    if (this.hist.length > Math.max(1, Math.round(NOISE_WINDOW_MS / frameMs))) this.hist.shift();
    this.heardMs += frameMs;
    if (this.heardMs <= CALIBRATE_MS) return null;
    if (!this.speaking) {
      if (level >= gate) {
        this.loudMs += frameMs;
        if (this.loudMs >= this.opts.startMs) {
          this.speaking = true;
          this.quietMs = 0;
          this.startedAt = t - this.loudMs;
          return { event: 'start', at: this.startedAt };
        }
      } else this.loudMs = 0;
      return null;
    }
    // speaking: a little below the gate still counts (the end of a word fades)
    if (level >= gate * 0.7) this.quietMs = 0;
    else this.quietMs += frameMs;
    if (this.quietMs >= this.opts.silenceMs || t - this.startedAt >= this.opts.maxMs) {
      this.speaking = false;
      this.loudMs = 0;
      return { event: 'end', durationMs: t - this.startedAt - this.quietMs };
    }
    return null;
  }

  /** Forget the sentence in progress (Esc, or the CEO started talking). */
  reset(): void {
    this.speaking = false;
    this.loudMs = 0;
    this.quietMs = 0;
  }
}

/** base64 of binary data (for POST /api/dictation, which takes JSON). */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
