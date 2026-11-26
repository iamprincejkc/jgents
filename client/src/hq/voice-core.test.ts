import { describe, expect, it } from 'vitest';
import { concat, downsample, encodeWav, floorFor, rms, toBase64, Vad, VAD_DEFAULTS } from './voice-core';
import { speechChunks } from './voice';

describe('microphone samples to a WAV', () => {
  it('downsamples by averaging, and writes a 16-bit mono WAV header Whisper reads', () => {
    const input = new Float32Array(48).map((_, i) => (i % 3 === 0 ? 0.3 : 0));
    const out = downsample(input, 48_000, 16_000);
    expect(out).toHaveLength(16);
    expect(out[0]).toBeCloseTo(0.1);
    const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 16_000));
    const text = (a: number, n: number) => String.fromCharCode(...new Uint8Array(wav.buffer, a, n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16_000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect([wav.getInt16(44, true), wav.getInt16(46, true), wav.getInt16(48, true), wav.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
    expect(concat([new Float32Array([1]), new Float32Array([2, 3])])).toEqual(new Float32Array([1, 2, 3]));
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(toBase64(new Uint8Array([104, 105]).buffer)).toBe('aGk=');
  });
});

describe('telling speech from silence', () => {
  const run = (vad: Vad, levels: number[], frameMs = 20) => {
    const out: string[] = [];
    levels.forEach((l, i) => {
      const e = vad.feed(l, frameMs, (i + 1) * frameMs);
      if (e) out.push(e.event === 'start' ? `start@${e.at}` : `end:${e.durationMs}`);
    });
    return out;
  };

  it('a sentence starts after a moment of voice (dated back) and ends after a pause', () => {
    const vad = new Vad();
    const levels = [...Array(50).fill(0.002), ...Array(60).fill(0.08), ...Array(50).fill(0.002)];
    expect(run(vad, levels)).toEqual(['start@1000', 'end:1200']);
  });

  it('a click or a cough is not a sentence, and a short breath does not end one', () => {
    const vad = new Vad();
    expect(run(vad, [...Array(30).fill(0.002), 0.2, 0.2, ...Array(20).fill(0.002)])).toEqual([]);
    const words = [...Array(20).fill(0.08), ...Array(15).fill(0.002), ...Array(20).fill(0.08), ...Array(60).fill(0.002)];
    expect(run(vad, words).map((e) => e.split(/[@:]/)[0])).toEqual(['start', 'end']);
  });

  it('listens to the room first, and its noise never counts as talking (a voice over it does)', () => {
    // the microphone opens on a click: still calibrating, nothing starts
    expect(run(new Vad(), [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, ...Array(10).fill(0.002)])).toEqual([]);
    // a steady fan, however long
    expect(run(new Vad(), Array(300).fill(0.02))).toEqual([]);
    // the fan, then someone talks over it
    const fan = new Vad();
    expect(run(fan, [...Array(60).fill(0.02), ...Array(30).fill(0.2), ...Array(60).fill(0.02)])).toEqual(['start@1200', 'end:600']);
    expect(fan.gate()).toBeCloseTo(0.06);
    // a quiet room keeps the floor: a whisper-quiet level below it is not speech
    const calm = new Vad();
    run(calm, Array(100).fill(0.001));
    expect(calm.gate()).toBe(VAD_DEFAULTS.floor);
    expect(run(calm, Array(50).fill(0.009))).toEqual([]);
    expect(floorFor(0)).toBeCloseTo(0.03);
    expect(floorFor(1)).toBeCloseTo(0.004);
  });

  it('never runs a sentence past the limit, and Esc drops it', () => {
    const vad = new Vad({ ...VAD_DEFAULTS, maxMs: 1000 });
    expect(run(vad, [...Array(30).fill(0.002), ...Array(70).fill(0.1)])).toEqual(['start@600', 'end:1000', 'start@1600']);
    const v2 = new Vad();
    run(v2, [...Array(30).fill(0.002), ...Array(10).fill(0.1)]);
    expect(v2.speaking).toBe(true);
    v2.reset();
    expect(v2.speaking).toBe(false);
  });
});

describe('speaking', () => {
  it('splits a reply into pieces a voice reads whole, at sentence ends', () => {
    expect(speechChunks('One. Two! Three?', 10)).toEqual(['One. Two!', 'Three?']);
    expect(speechChunks('A'.repeat(25), 10)).toEqual(['AAAAAAAAAA', 'AAAAAAAAAA', 'AAAAA']);
    expect(speechChunks('')).toEqual([]);
  });
});
