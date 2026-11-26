// The HQ console's voice. Listening: the microphone goes through an audio worklet (one path for both modes): push to
// talk records while Space (or the mic button) is held; always listening lets the speech detector (voice-core.ts) cut
// each sentence. Each sentence goes as a 16 kHz WAV to the local Whisper (POST /api/dictation) and comes back as text:
// the voice never leaves this computer. Speaking: the CEO's replies are read with the browser's speech synthesis, and
// the microphone pauses meanwhile so it never hears the CEO as you.
import { concat, downsample, encodeWav, floorFor, rms, toBase64, Vad, VAD_DEFAULTS, WAV_RATE } from './voice-core';

export type ListenMode = 'push' | 'always' | 'off';
export type VoicePhase = 'idle' | 'listening' | 'recording' | 'transcribing';

export interface VoiceEvents {
  /** Something to redraw (mode, phase, availability). */
  change(): void;
  /** What you said, as text. */
  text(text: string): void;
  /** A short line for you (error = something went wrong). */
  say(text: string, error?: boolean): void;
  /** Loudness 0..1 of each frame while the microphone is open (the waveform). */
  level?(v: number): void;
}

/** The worklet: hands the main thread ~20 ms frames of the first channel. */
const TAP = `
class JgentsTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buf = new Float32Array(options.processorOptions.frame);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('jgents-tap', JgentsTap);
`;

/** Kept from before the sentence started: the first syllable is said before the detector is sure. */
const PREROLL_MS = 400;
/** Shorter than this is a noise, not a sentence. */
const MIN_SPEECH_MS = 350;
/** Push to talk: the microphone stays open this long after you let go, so the next press starts at once. */
const KEEP_OPEN_MS = 20_000;
const MAX_PUSH_MS = 120_000;
const POLL_MS = 500;
const WAIT_MS = 150_000;

interface DictationReply {
  id: string;
  status: 'queued' | 'sent' | 'done' | 'failed';
  text?: string;
  error?: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error('JGENTS did not answer');
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `error ${res.status}`);
  return body;
}

/** A WAV through the local Whisper: the text said in it (may be empty). */
export async function transcribe(wav: ArrayBuffer): Promise<string> {
  let r = await json<DictationReply>('/api/dictation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'audio/wav', data: toBase64(wav) }),
  });
  const end = Date.now() + WAIT_MS;
  while ((r.status === 'queued' || r.status === 'sent') && Date.now() < end) {
    await new Promise((ok) => setTimeout(ok, POLL_MS));
    r = await json<DictationReply>(`/api/dictation/${encodeURIComponent(r.id)}`);
  }
  if (r.status !== 'done') throw new Error(r.error || 'the computer did not answer in time');
  return (r.text ?? '').trim();
}

export class Voice {
  mode: ListenMode = 'push';
  phase: VoicePhase = 'idle';
  /** The local Whisper works (GET /api/dictation). */
  available = false;
  /** Why not, with how to install it (from the server). */
  missing?: string;
  /** The browser can record here (a secure page: localhost or HTTPS). */
  readonly canRecord = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';
  /** The CEO is speaking: the microphone does not listen. */
  paused = false;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private opening: Promise<boolean> | null = null;
  private ring: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private recording = false;
  private pushStartedAt = 0;
  private busy = 0;
  private t = 0;
  private frameMs = 20;
  private vad = new Vad({ ...VAD_DEFAULTS, floor: floorFor(0.5) });
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly on: VoiceEvents) {}

  /** Can you talk at all (browser and Whisper)? */
  get usable(): boolean {
    return this.canRecord && this.available;
  }

  /** Is the microphone taking your words right now (holding Space, or always listening and not paused)? */
  get hot(): boolean {
    return this.usable && !this.paused && (this.recording || (this.mode === 'always' && !!this.stream));
  }

  async check(): Promise<void> {
    try {
      const r = await json<{ available: boolean; missing?: string }>('/api/dictation');
      this.available = r.available === true;
      this.missing = r.missing;
    } catch (err) {
      this.available = false;
      this.missing = (err as Error).message;
    }
    if (!this.available && this.mode === 'always') this.mode = 'push';
    this.on.change();
  }

  setSensitivity(s: number): void {
    this.vad = new Vad({ ...VAD_DEFAULTS, floor: floorFor(s) });
  }

  setMode(mode: ListenMode): void {
    if (mode === this.mode) return;
    if (mode === 'always' && !this.usable) {
      this.on.say(this.whyNot(), true);
      return;
    }
    this.mode = mode;
    this.dropSentence();
    if (mode === 'always') {
      void this.open().then((ok) => {
        if (!ok) return;
        this.phase = this.busy ? 'transcribing' : 'listening';
        this.on.change();
      });
    } else if (mode === 'off') this.close();
    else this.closeLater();
    this.phase = this.busy ? 'transcribing' : 'idle';
    this.on.change();
  }

  /** Why the microphone cannot be used here. */
  whyNot(): string {
    if (!this.canRecord) return 'This browser cannot record here (it needs http://localhost or HTTPS).';
    if (!this.available) return this.missing ? `Voice needs the local Whisper: install ${this.missing}, then restart JGENTS.` : 'Voice needs the local Whisper (whisper-cli, ffmpeg and a model), then a restart of JGENTS.';
    return '';
  }

  /** Push to talk: Space (or the mic button) goes down. */
  async pressStart(): Promise<void> {
    if (this.mode !== 'push' || this.recording) return;
    if (!this.usable) return this.on.say(this.whyNot(), true);
    this.recording = true;
    // with the microphone already open, the last moments before the press come too (the first syllable)
    this.frames = this.ring.slice();
    this.pushStartedAt = performance.now();
    this.phase = 'recording';
    this.on.change();
    const ok = await this.open();
    if (!ok && this.recording) {
      this.recording = false;
      this.phase = 'idle';
      this.on.change();
    }
  }

  /** Push to talk: let go. What was said goes to Whisper. */
  pressEnd(): void {
    if (this.mode !== 'push' || !this.recording) return;
    this.recording = false;
    const frames = this.frames;
    this.frames = [];
    this.phase = this.busy ? 'transcribing' : 'idle';
    this.on.change();
    this.closeLater();
    void this.finish(frames, true);
  }

  /** Esc: drop the sentence in progress and stop listening now. */
  stop(): void {
    this.dropSentence();
    if (this.mode === 'always') this.setMode('push');
    else {
      this.phase = this.busy ? 'transcribing' : 'idle';
      this.on.change();
    }
  }

  /** While the CEO speaks, the microphone does not take anything (it would hear the CEO as you). */
  pause(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (on && this.mode === 'always') this.dropSentence();
    this.on.change();
  }

  close(): void {
    clearTimeout(this.closeTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.ring = [];
    this.on.level?.(0);
  }

  private dropSentence(): void {
    this.recording = false;
    this.frames = [];
    this.vad.reset();
  }

  private closeLater(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (this.mode !== 'always' && !this.recording) this.close();
    }, KEEP_OPEN_MS);
  }

  private open(): Promise<boolean> {
    clearTimeout(this.closeTimer);
    if (this.stream && this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return Promise.resolve(true);
    }
    if (this.opening) return this.opening;
    this.opening = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        const ctx = new AudioContext();
        const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const frame = Math.round(ctx.sampleRate * 0.02);
        const node = new AudioWorkletNode(ctx, 'jgents-tap', { processorOptions: { frame } });
        node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
        // the worklet runs only inside a live graph: through a silent gain to the speakers
        const mute = ctx.createGain();
        mute.gain.value = 0;
        ctx.createMediaStreamSource(stream).connect(node);
        node.connect(mute).connect(ctx.destination);
        this.frameMs = (frame / ctx.sampleRate) * 1000;
        this.stream = stream;
        this.ctx = ctx;
        if (this.mode === 'off') this.close();
        return !!this.stream;
      } catch (err) {
        const denied = (err as DOMException)?.name === 'NotAllowedError';
        this.on.say(denied ? 'The browser blocked the microphone: allow it for this page, then try again.' : `Could not open the microphone: ${(err as Error).message}`, true);
        this.close();
        if (this.mode === 'always') {
          this.mode = 'push';
          this.phase = 'idle';
          this.on.change();
        }
        return false;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  private onFrame(f: Float32Array): void {
    const level = rms(f);
    this.t += this.frameMs;
    this.ring.push(f);
    while (this.ring.length * this.frameMs > PREROLL_MS) this.ring.shift();
    const listening = this.mode === 'always' && !this.paused;
    this.on.level?.(this.recording || listening ? Math.min(1, level * 8) : 0);
    if (this.mode === 'push') {
      if (!this.recording) return;
      this.frames.push(f);
      if (performance.now() - this.pushStartedAt > MAX_PUSH_MS) this.pressEnd();
      return;
    }
    if (!listening) return;
    if (this.recording) this.frames.push(f);
    const ev = this.vad.feed(level, this.frameMs, this.t);
    if (ev?.event === 'start') {
      this.recording = true;
      this.frames = this.ring.slice();
      this.phase = 'recording';
      this.on.change();
    } else if (ev?.event === 'end') {
      this.recording = false;
      const frames = this.frames;
      this.frames = [];
      this.phase = 'listening';
      this.on.change();
      if (ev.durationMs >= MIN_SPEECH_MS) void this.finish(frames, false);
    }
  }

  private async finish(frames: Float32Array[], pushed: boolean): Promise<void> {
    const rate = this.ctx?.sampleRate;
    if (!frames.length || !rate) return;
    const pcm = downsample(concat(frames), rate);
    if (pcm.length < WAV_RATE * 0.3) {
      if (pushed) this.on.say('Too short: hold Space while you talk, then let go.', true);
      return;
    }
    this.busy++;
    if (!this.recording) this.phase = 'transcribing';
    this.on.change();
    try {
      const text = await transcribe(encodeWav(pcm));
      if (text) this.on.text(text);
      else if (pushed) this.on.say("I didn't catch that: try again, a bit closer to the microphone.", true);
    } catch (err) {
      this.on.say(`Voice failed: ${(err as Error).message}`, true);
    } finally {
      this.busy--;
      if (!this.recording) this.phase = this.busy ? 'transcribing' : this.mode === 'always' && this.stream ? 'listening' : 'idle';
      this.on.change();
    }
  }
}

/** Splits text into pieces the speech engine reads whole (some voices stop after ~15 s of one utterance). */
export function speechChunks(text: string, max = 220): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if (cur && (cur + s).length > max) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** The CEO's voice: the browser's speech synthesis, in pieces, with start/end for pausing the microphone. */
export class Speaker {
  enabled = true;
  /** SpeechSynthesisVoice.name; '' = an English voice the browser picks. */
  voiceName = '';
  rate = 1;
  speaking = false;
  private run = 0;

  constructor(private readonly onSpeaking: (on: boolean) => void) {}

  supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  voices(): SpeechSynthesisVoice[] {
    return this.supported() ? speechSynthesis.getVoices() : [];
  }

  private voice(): SpeechSynthesisVoice | undefined {
    const all = this.voices();
    return all.find((v) => v.name === this.voiceName) ?? all.find((v) => v.default && v.lang.startsWith('en')) ?? all.find((v) => v.lang.startsWith('en'));
  }

  speak(text: string, force = false): void {
    if ((!this.enabled && !force) || !this.supported() || !text.trim()) return;
    this.stop();
    const run = ++this.run;
    const voice = this.voice();
    const parts = speechChunks(text);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? 'en-US';
      u.rate = this.rate;
      if (i === 0) u.onstart = () => run === this.run && this.set(true);
      if (i === parts.length - 1) u.onend = () => run === this.run && this.set(false);
      u.onerror = () => run === this.run && this.set(false);
      speechSynthesis.speak(u);
    });
  }

  stop(): void {
    this.run++;
    if (this.supported()) speechSynthesis.cancel();
    this.set(false);
  }

  private set(on: boolean): void {
    if (this.speaking === on) return;
    this.speaking = on;
    this.onSpeaking(on);
  }
}
