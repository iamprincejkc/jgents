import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWhisper, parseWhisperJson } from './whisper';

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
    expect(findWhisper({ HOME: '/h', PATH: '' }, () => false)).toEqual({ missing: 'whisper-cli (brew install whisper-cpp)' });
    expect(findWhisper({ HOME: '/h', PATH: '', JGENTS_DICTATION_LANGS: 'en, pt, xx-bad' }, () => true)).toMatchObject({ langs: ['en', 'pt'] });
  });

  it('acha whisper-cli e ffmpeg no PATH (no Windows, os .exe; os scripts .cmd não rodam sem shell)', () => {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const [a, b] = [join('/x', 'a'), join('/x', 'b')];
    const model = join('/h', '.whisper', 'ggml-base.bin');
    const have = new Set([join(a, `ffmpeg${exe}`), join(b, `whisper-cli${exe}`), join(b, 'whisper-cli.cmd'), model]);
    const env = { HOME: '/h', PATH: ['', '/nao/existe', a, b].join(delimiter) };
    expect(findWhisper(env, (p) => have.has(p))).toMatchObject({ bin: join(b, `whisper-cli${exe}`), ffmpeg: join(a, `ffmpeg${exe}`), model });
    have.delete(join(b, `whisper-cli${exe}`));
    expect(findWhisper(env, (p) => have.has(p))).toEqual({ missing: 'whisper-cli (brew install whisper-cpp)' });
  });
});
