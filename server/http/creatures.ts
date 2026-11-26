// Creature pack routes (server/creatures/pack.ts): GET /api/creatures (the list, re-read on each call) and
// GET /api/creatures/file/<name> (one image of the pack). Decoration only, like the snapshot: they work over the
// remote port too, but only a browser on this computer is told where the folder is.
import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { tr } from '../../shared/i18n';
import { packFilePath, readPack } from '../creatures/pack';
import { etagOf, isNotModified } from './static';

type Send = (res: ServerResponse, status: number, body: unknown) => void;

const MIME: Readonly<Record<string, string>> = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const FILE_PREFIX = '/api/creatures/file/';

export interface CreatureRouteOptions {
  dir: string;
  /** The request came through the remote port (the folder path stays private). */
  remote: boolean;
}

/** Handles /api/creatures and /api/creatures/file/*. */
export function handleCreaturesRoute(req: IncomingMessage, res: ServerResponse, path: string, opts: CreatureRouteOptions, send: Send): void {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, { error: tr('método não permitido') });
    return;
  }
  if (path === '/api/creatures') {
    const info = readPack(opts.dir);
    if (!opts.remote) info.folder = opts.dir;
    send(res, 200, info);
    return;
  }
  if (!path.startsWith(FILE_PREFIX)) {
    send(res, 404, { error: tr('rota desconhecida') });
    return;
  }
  let name: string;
  try {
    name = decodeURIComponent(path.slice(FILE_PREFIX.length));
  } catch {
    send(res, 400, { error: tr('nome de arquivo inválido') });
    return;
  }
  const full = packFilePath(opts.dir, name);
  const type = MIME[extname(name).toLowerCase()];
  if (!full || !type) {
    send(res, 404, { error: tr('imagem não encontrada no pacote de criaturas') });
    return;
  }
  let data: Buffer;
  let st: { size: number; mtimeMs: number };
  try {
    st = statSync(full);
    data = readFileSync(full);
  } catch {
    send(res, 404, { error: tr('imagem não encontrada no pacote de criaturas') });
    return;
  }
  const etag = etagOf(st);
  const headers = {
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': new Date(st.mtimeMs).toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'",
  };
  if (isNotModified(req, etag, st.mtimeMs)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': data.length });
  res.end(method === 'HEAD' ? undefined : data);
}
