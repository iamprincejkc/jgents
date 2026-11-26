import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nameFromFile, PACK_MAX_IMAGE_BYTES, type CreaturePackInfo } from '../../shared/creatures';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { ensureCreaturePack, packFilePath, readPack } from './pack';

setQuiet(true);

/** A 1x1 transparent PNG (the server never decodes it; the bytes only need to be served back). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('pacote de criaturas: leitura da pasta', () => {
  let dir = '';
  let cleanup = () => {};
  beforeEach(() => {
    ({ dir, cleanup } = tempDir('jgents-pack-'));
  });
  afterEach(() => cleanup());

  const put = (name: string, data: Buffer | string = PNG) => writeFileSync(join(dir, name), data);

  it('nome a partir do arquivo', () => {
    expect(nameFromFile('sun-bird.png')).toBe('Sun-Bird');
    expect(nameFromFile('fire_cat.webp')).toBe('Fire Cat');
    expect(nameFromFile('  my  beast .gif')).toBe('My Beast');
    expect(nameFromFile('.png')).toBe('Creature');
  });

  it('pasta ausente ou vazia: pacote vazio, sem avisos', () => {
    expect(readPack(join(dir, 'nope'))).toEqual({ creatures: [], warnings: [] });
    expect(readPack(dir)).toEqual({ creatures: [], warnings: [] });
  });

  it('cada imagem vira uma criatura com o nome do arquivo; o resto é ignorado', () => {
    put('fire-cat.png');
    put('Storm_Bird.webp');
    put('blob.gif');
    put('notes.txt', 'x');
    put('.hidden.png');
    put('README.txt', 'x');
    mkdirSync(join(dir, 'sub.png'));
    const pack = readPack(dir);
    expect(pack.warnings).toEqual([]);
    expect(pack.creatures.map((c) => [c.id, c.file, c.name, c.flies, c.size, c.faces])).toEqual([
      ['pack:blob.gif', 'blob.gif', 'Blob', false, 36, 'left'],
      ['pack:fire-cat.png', 'fire-cat.png', 'Fire-Cat', false, 36, 'left'],
      ['pack:storm_bird.webp', 'Storm_Bird.webp', 'Storm Bird', false, 36, 'left'],
    ]);
    expect(pack.creatures.every((c) => c.version.length > 0)).toBe(true);
  });

  it('creatures.json ajusta cada criatura; valores inválidos viram avisos', () => {
    put('fire-cat.png');
    put('fire-cat-shiny.png');
    put('bird.png');
    put('old.png');
    put(
      'creatures.json',
      JSON.stringify({
        creatures: {
          'Fire-Cat.png': { name: '  Blaze  ', size: 500, faces: 'right', types: ['fire', 'cute', 'x', 'y'], level: [80, 40], glow: '#FF8800', blurb: 'Warm.', variants: { shiny: 'fire-cat-shiny.png' } },
          'bird.png': { flies: true, speed: 'fast', colour: 'red', variants: { golden: 'old.png' } },
          'old.png': { enabled: false },
          'ghost.png': { name: 'Nobody' },
        },
      }),
    );
    const pack = readPack(dir);
    const byId = Object.fromEntries(pack.creatures.map((c) => [c.id, c]));
    // the variant image is not a creature of its own, and a disabled one is hidden
    expect(Object.keys(byId)).toEqual(['pack:bird.png', 'pack:fire-cat.png']);
    expect(byId['pack:fire-cat.png']).toMatchObject({
      name: 'Blaze',
      size: 96,
      faces: 'right',
      types: ['fire', 'cute', 'x'],
      level: [40, 80],
      glow: '#ff8800',
      blurb: 'Warm.',
      variants: { shiny: 'fire-cat-shiny.png' },
    });
    expect(byId['pack:bird.png']).toMatchObject({ flies: true, variants: {} });
    expect(byId['pack:bird.png'].speed).toBeUndefined();
    expect(pack.warnings).toHaveLength(4);
    expect(pack.warnings.join('\n')).toMatch(/ghost\.png/);
    expect(pack.warnings.join('\n')).toMatch(/speed/);
    expect(pack.warnings.join('\n')).toMatch(/colour/);
    expect(pack.warnings.join('\n')).toMatch(/variants\.golden/);
  });

  it('creatures.json quebrado: aviso, e as imagens continuam valendo', () => {
    put('a.png');
    put('creatures.json', '{ nope');
    const pack = readPack(dir);
    expect(pack.creatures.map((c) => c.name)).toEqual(['A']);
    expect(pack.warnings).toHaveLength(1);
  });

  it('imagem grande demais fica de fora, com aviso', () => {
    put('big.png', Buffer.alloc(PACK_MAX_IMAGE_BYTES + 1));
    put('ok.png');
    const pack = readPack(dir);
    expect(pack.creatures.map((c) => c.file)).toEqual(['ok.png']);
    expect(pack.warnings.join()).toMatch(/big\.png/);
  });

  it('só serve imagens diretamente na pasta', () => {
    put('ok.png');
    put('notes.txt', 'x');
    put('big.png', Buffer.alloc(PACK_MAX_IMAGE_BYTES + 1));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'in.png'), PNG);
    expect(packFilePath(dir, 'ok.png')).toBeTruthy();
    expect(packFilePath(dir, 'OK.PNG') ?? '').not.toBe('x');
    for (const bad of ['', '../ok.png', '..\\ok.png', 'sub/in.png', 'sub\\in.png', 'notes.txt', '.ok.png', 'ok.png:stream', 'big.png', 'missing.png', 'C:\\Windows\\win.png', '/etc/x.png']) {
      expect(packFilePath(dir, bad), bad).toBeNull();
    }
  });

  it('um atalho (link) para fora da pasta não é servido', () => {
    const outside = tempDir('jgents-out-');
    try {
      writeFileSync(join(outside.dir, 'secret.png'), PNG);
      try {
        symlinkSync(join(outside.dir, 'secret.png'), join(dir, 'link.png'));
      } catch {
        return; // no permission to create links here (Windows without developer mode)
      }
      expect(packFilePath(dir, 'link.png')).toBeNull();
    } finally {
      outside.cleanup();
    }
  });

  it('a pasta nova nasce com um LEIA-ME', () => {
    const pack = ensureCreaturePack(join(dir, 'creatures'));
    expect(readPack(pack)).toEqual({ creatures: [], warnings: [] });
    expect(packFilePath(pack, 'README.txt')).toBeNull();
  });
});

describe('GET /api/creatures', () => {
  let base = '';
  let dir = '';
  let close: () => Promise<void> = async () => {};
  let cleanup = () => {};

  beforeEach(async () => {
    const tmp = tempDir('jgents-pack-http-');
    cleanup = tmp.cleanup;
    dir = join(tmp.dir, 'creatures');
    mkdirSync(dir);
    writeFileSync(join(dir, 'fire-cat.png'), PNG);
    const late: { office?: Office } = {};
    const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => late.office?.markDirty() });
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
    late.office = office;
    const hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    const api = createApiHandler({ office, hub, accounts, sources: () => [], version: '9.9.9', inDocker: false, creaturesDir: dir });
    const guard = createRequestGuard();
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () =>
      new Promise((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => ok());
      });
  });

  afterEach(async () => {
    await close();
    cleanup();
  });

  it('lista o pacote (com a pasta, para o próprio computador) e relê a cada chamada', async () => {
    const first = (await (await fetch(`${base}/api/creatures`)).json()) as CreaturePackInfo;
    expect(first.creatures.map((c) => c.name)).toEqual(['Fire-Cat']);
    expect(first.folder).toBe(dir);
    writeFileSync(join(dir, 'moth.webp'), PNG);
    const second = (await (await fetch(`${base}/api/creatures`)).json()) as CreaturePackInfo;
    expect(second.creatures.map((c) => c.name)).toEqual(['Fire-Cat', 'Moth']);
  });

  it('serve a imagem com o tipo certo e revalida pelo ETag', async () => {
    const res = await fetch(`${base}/api/creatures/file/fire-cat.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    const again = await fetch(`${base}/api/creatures/file/fire-cat.png`, { headers: { 'If-None-Match': res.headers.get('etag') ?? '' } });
    expect(again.status).toBe(304);
  });

  it('recusa caminhos para fora da pasta, outros arquivos e outros métodos', async () => {
    writeFileSync(join(dir, '..', 'secret.png'), PNG);
    for (const p of ['..%2Fsecret.png', '..%5Csecret.png', '%2E%2E%2Fsecret.png', 'missing.png', 'README.txt', 'fire-cat.png%3Astream', '%E0%A4%A']) {
      const res = await fetch(`${base}/api/creatures/file/${p}`);
      expect([400, 404], p).toContain(res.status);
    }
    // (a POST without a JSON body is already refused by the request guard, with 415)
    expect((await fetch(`${base}/api/creatures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
  });
});
