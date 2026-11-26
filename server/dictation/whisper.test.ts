import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioContext, findWhisper, parseWhisperJson, passArgs, threadsFor } from './whisper';

describe('Whisper local', () => {
  it('lê texto e idioma do JSON do whisper-cli, sem marcas de silêncio', () => {
    const raw = JSON.stringify({ result: { language: 'pt' }, transcription: [{ text: ' Crie um agente' }, { text: ' para o relatório. [BLANK_AUDIO]' }] });
    expect(parseWhisperJson(raw)).toEqual({ text: 'Crie um agente para o relatório.', lang: 'pt' });
    expect(parseWhisperJson('{}')).toEqual({ text: '', lang: '' });
  });

  it('acha binários e o melhor modelo multilíngue (nunca um .en)', () => {
    const models = join('/h', '.local', 'share', 'whisper');
    const have = new Set(['/opt/homebrew/bin/whisper-cli', '/opt/homebrew/bin/ffmpeg', join('/h', '.whisper', 'ggml-base.en.bin'), join(models, 'ggml-base.bin'), join(models, 'ggml-small.bin')]);
    const setup = findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p));
    expect(setup).toEqual({ bin: '/opt/homebrew/bin/whisper-cli', ffmpeg: '/opt/homebrew/bin/ffmpeg', model: join(models, 'ggml-small.bin'), langs: ['pt', 'en'] });
    have.delete(join(models, 'ggml-small.bin'));
    have.delete(join(models, 'ggml-base.bin'));
    expect(findWhisper({ HOME: '/h', PATH: '' }, (p) => have.has(p))).toHaveProperty('missing');
    expect(findWhisper({ HOME: '/h', PATH: '' }, () => false, 'darwin')).toEqual({ missing: 'whisper-cli (brew install whisper-cpp)' });
    expect(findWhisper({ HOME: '/h', PATH: '', JGENTS_DICTATION_LANGS: 'en, pt, xx-bad' }, () => true)).toMatchObject({ langs: ['en', 'pt'] });
  });

  it('o que falta e como instalar: Homebrew no macOS e no Linux; Scoop e winget no Windows, com a pasta do modelo inteira', () => {
    const hints = (platform: NodeJS.Platform, home: string) => {
      const have = new Set<string>();
      const env = { HOME: home, PATH: '', JGENTS_WHISPER_BIN: join('/w', 'whisper-cli'), JGENTS_FFMPEG_BIN: join('/w', 'ffmpeg') };
      const steps = [findWhisper(env, (p) => have.has(p), platform)];
      have.add(env.JGENTS_WHISPER_BIN);
      steps.push(findWhisper(env, (p) => have.has(p), platform));
      have.add(env.JGENTS_FFMPEG_BIN);
      steps.push(findWhisper(env, (p) => have.has(p), platform));
      return steps.map((s) => ('missing' in s ? s.missing : 'ok'));
    };
    const posix = ['whisper-cli (brew install whisper-cpp)', 'ffmpeg (brew install ffmpeg)', 'um modelo multilíngue do Whisper (ggml-small.bin ou ggml-base.bin em ~/.local/share/whisper)'];
    expect(hints('darwin', '/h')).toEqual(posix);
    expect(hints('linux', '/h')).toEqual(posix);
    expect(hints('win32', 'C:\\Users\\ana')).toEqual([
      'whisper-cli (scoop install whisper-cpp)',
      'ffmpeg (winget install Gyan.FFmpeg)',
      `um modelo multilíngue do Whisper (ggml-small.bin ou ggml-base.bin em ${join('C:\\Users\\ana', '.local', 'share', 'whisper')})`,
    ]);
  });

  it('no Windows procura o .exe no PATH, em qualquer sistema', () => {
    const dir = join('/x', 'bin');
    const model = join('/h', '.whisper', 'ggml-base.bin');
    const have = new Set([join(dir, 'whisper-cli.exe'), join(dir, 'ffmpeg.exe'), join(dir, 'whisper-cli'), join(dir, 'ffmpeg'), model]);
    const env = { HOME: '/h', PATH: dir };
    expect(findWhisper(env, (p) => have.has(p), 'win32')).toMatchObject({ bin: join(dir, 'whisper-cli.exe'), ffmpeg: join(dir, 'ffmpeg.exe') });
    expect(findWhisper(env, (p) => have.has(p), 'linux')).toMatchObject({ bin: join(dir, 'whisper-cli'), ffmpeg: join(dir, 'ffmpeg') });
  });

  it('a short clip gets an encoder window its size (several times faster), long ones the full window, and up to 8 threads', () => {
    expect(audioContext(4.2)).toBe(338);
    expect(audioContext(0.5)).toBe(153);
    expect(audioContext(27.9)).toBe(1500);
    expect(audioContext(28)).toBe(0);
    expect(audioContext(180)).toBe(0);
    expect(audioContext(0)).toBe(0);
    expect(audioContext(Number.NaN)).toBe(0);
    expect([threadsFor(12), threadsFor(4), threadsFor(1), threadsFor(0)]).toEqual([8, 4, 1, 1]);
    expect(passArgs({ model: 'm.bin' }, 'a.wav', 'out', 'en', 4.2, 12)).toEqual(['-m', 'm.bin', '-l', 'en', '-f', 'a.wav', '-nt', '-np', '-oj', '-of', 'out', '-t', '8', '-ac', '338']);
    expect(passArgs({ model: 'm.bin' }, 'a.wav', 'out', 'auto', 95, 2)).toEqual(['-m', 'm.bin', '-l', 'auto', '-f', 'a.wav', '-nt', '-np', '-oj', '-of', 'out', '-t', '2']);
  });

  it('acha whisper-cli e ffmpeg no PATH (no Windows, os .exe; os scripts .cmd não rodam sem shell)', () => {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const [a, b] = [join('/x', 'a'), join('/x', 'b')];
    const model = join('/h', '.whisper', 'ggml-base.bin');
    const have = new Set([join(a, `ffmpeg${exe}`), join(b, `whisper-cli${exe}`), join(b, 'whisper-cli.cmd'), model]);
    const env = { HOME: '/h', PATH: ['', '/nao/existe', a, b].join(delimiter) };
    expect(findWhisper(env, (p) => have.has(p))).toMatchObject({ bin: join(b, `whisper-cli${exe}`), ffmpeg: join(a, `ffmpeg${exe}`), model });
    have.delete(join(b, `whisper-cli${exe}`));
    expect(findWhisper(env, (p) => have.has(p))).toEqual({ missing: expect.stringMatching(/^whisper-cli \(/) });
  });
});
