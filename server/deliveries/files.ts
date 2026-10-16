// Arquivos das entregas: o que pode ser mostrado no escritório. Só arquivos que o próprio agente entregou (o servidor
// só pede caminhos que estão numa entrega) e, mesmo assim, só tipos de ver (imagem, PDF, vídeo, página, texto) e nunca
// algo com cara de segredo (.ssh, .env, chaves, credenciais...). Quem lê é o servidor (modo Node, ou pasta montada no
// Docker) ou o auxiliar do host (scripts/codex-bridge.ts), que confere tudo de novo antes de ler.
// Os caminhos vêm dos transcripts, isto é, do computador onde o agente rodou (no Docker, não é o do servidor): cada um
// é lido pelo seu formato, POSIX (/Users/...) ou Windows (C:\Users\... ou C:/Users/...), e não pelo sistema que confere.
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { existsSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { DeliveryAttachmentKind } from '../../shared/types';
import { tr } from '../../shared/i18n';

export const DELIVERY_FILE_MAX_BYTES = 25 * 1024 * 1024;

const TYPES: Readonly<Record<string, { kind: DeliveryAttachmentKind; type: string }>> = {
  png: { kind: 'image', type: 'image/png' },
  jpg: { kind: 'image', type: 'image/jpeg' },
  jpeg: { kind: 'image', type: 'image/jpeg' },
  gif: { kind: 'image', type: 'image/gif' },
  webp: { kind: 'image', type: 'image/webp' },
  svg: { kind: 'image', type: 'image/svg+xml' },
  pdf: { kind: 'pdf', type: 'application/pdf' },
  mp4: { kind: 'video', type: 'video/mp4' },
  mov: { kind: 'video', type: 'video/quicktime' },
  webm: { kind: 'video', type: 'video/webm' },
  html: { kind: 'page', type: 'text/html; charset=utf-8' },
  htm: { kind: 'page', type: 'text/html; charset=utf-8' },
  md: { kind: 'text', type: 'text/plain; charset=utf-8' },
  txt: { kind: 'text', type: 'text/plain; charset=utf-8' },
  csv: { kind: 'text', type: 'text/plain; charset=utf-8' },
  log: { kind: 'text', type: 'text/plain; charset=utf-8' },
  xlsx: { kind: 'file', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { kind: 'file', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { kind: 'file', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  zip: { kind: 'file', type: 'application/zip' },
};

/** Pastas e nomes que nunca saem, mesmo que um agente os "entregue" (texto injetado num transcript, por exemplo). */
const SECRET_DIRS = /(^|\/)(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.password-store|\.config\/gh|\.config\/gcloud|Keychains|\.jgents\/remote-tls)(\/|$)/i;
const SECRET_NAMES = /(^|\/)(\.env[^/]*|id_[a-z0-9]+|[^/]*\.(pem|key|p12|pfx|keystore|jks|kdbx)|[^/]*(secret|credential|password|senha|token)[^/]*)$/i;

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Tipo de visualização e Content-Type, ou undefined se a extensão não é de ver. */
export function fileType(path: string): { kind: DeliveryAttachmentKind; type: string } | undefined {
  return TYPES[extensionOf(path)];
}

/** Caminho absoluto do Windows, com letra de unidade (C:\... ou C:/...). */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/** As funções de caminho do formato do caminho: as do Windows para C:\..., as do POSIX para o resto. */
export function pathFlavor(path: string): typeof posix {
  return WINDOWS_ABSOLUTE.test(path) ? win32 : posix;
}

/**
 * Absoluto e local: /... (uma barra só) ou C:\... sem outro ":" (no Windows, ":" depois da unidade é um fluxo de dados
 * alternativo, como "a.txt:x.png" ou ".ssh::$INDEX_ALLOCATION"). Duas barras no começo, de qualquer tipo, são um
 * caminho de rede no Windows (\\servidor\pasta): abrir um faria o computador se conectar a outro.
 */
function isLocalAbsolute(path: string): boolean {
  if (/^[\\/]{2}/.test(path)) return false;
  return path.startsWith('/') || (WINDOWS_ABSOLUTE.test(path) && !path.includes(':', 2));
}

/** Motivo para NÃO mostrar o caminho (só olhando o texto), ou undefined. */
export function pathProblem(path: string): string | undefined {
  if (!path || path.includes('\0') || !isLocalAbsolute(path) || /(^|[\\/])\.\.([\\/]|$)/.test(path)) return tr('caminho inválido');
  if (!fileType(path)) return tr('tipo de arquivo que não se mostra aqui');
  // As listas de segredos usam "/": no Windows, "\" também separa pastas.
  const slashed = path.replace(/\\/g, '/');
  if (SECRET_DIRS.test(slashed) || SECRET_NAMES.test(slashed)) return tr('arquivo protegido');
  return undefined;
}

/**
 * Caminho real. No Windows, o do sistema (realpathSync.native): o realpathSync do Node mantém os nomes curtos 8.3
 * (C:\Users\ana\JGENTS~1 é a .jgents) e o "::$INDEX_ALLOCATION", e com eles uma pasta protegida passaria pelas listas.
 */
export const realPath: (p: string) => string = process.platform === 'win32' ? realpathSync.native : realpathSync;

/** Confere no disco (links resolvidos, tamanho, arquivo comum). Devolve o caminho real ou o motivo. */
export function checkFile(
  path: string,
  fs: { realpath(p: string): string; stat(p: string): { isFile(): boolean; size: number } } = { realpath: realPath, stat: statSync },
): { path: string; size: number } | { error: string } {
  const bad = pathProblem(path);
  if (bad) return { error: bad };
  let real: string;
  let st: { isFile(): boolean; size: number };
  try {
    real = fs.realpath(path);
    st = fs.stat(real);
  } catch {
    return { error: tr('arquivo não encontrado') };
  }
  const realBad = pathProblem(real);
  if (realBad) return { error: realBad };
  if (!st.isFile()) return { error: tr('não é um arquivo') };
  if (st.size > DELIVERY_FILE_MAX_BYTES) return { error: tr('arquivo grande demais para ver aqui') };
  return { path: real, size: st.size };
}

/** Pastas temporárias onde os agentes guardam rascunhos e prints (a do sistema e as de sempre no macOS e no Linux). */
export function tempRoots(): string[] {
  const out = new Set<string>(['/tmp', '/private/tmp', '/var/folders', '/private/var/folders']);
  try {
    out.add(realPath(tmpdir()));
  } catch {
    out.add(tmpdir());
  }
  return [...out];
}

/**
 * O arquivo (caminho real) está numa pasta que o auxiliar do host pode ler: uma pasta de projeto que alguma conta do
 * Claude Code conhece (ela, ou uma acima dela, tem <conta>/projects/<pasta codificada>) ou uma das `roots` (pastas
 * temporárias, anexos do JGENTS). Assim um pedido vindo do container não alcança o resto do computador.
 */
export function insideKnownFolder(
  path: string,
  opts: { accountDirs: readonly string[]; roots: readonly string[]; exists?: (p: string) => boolean },
): boolean {
  const p = pathFlavor(path);
  const file = p.normalize(path);
  if (opts.roots.some((r) => r && file.startsWith(`${p.normalize(r).replace(/[\\/]+$/, '')}${p.sep}`))) return true;
  const exists = opts.exists ?? existsSync;
  // Pastas abaixo da raiz (/ ou C:\): nunca "/Users" ou "C:\Users" inteira.
  const depth = (dir: string) => dir.slice(p.parse(dir).root.length).split(p.sep).filter(Boolean).length;
  // Mesma codificação de sources/watcher.ts (encodeCwd): todo caractere não alfanumérico vira "-" (D:\obra = D--obra).
  for (let dir = p.dirname(file); depth(dir) >= 2; dir = p.dirname(dir)) {
    const encoded = dir.replace(/[^a-zA-Z0-9]/g, '-');
    if (opts.accountDirs.some((acc) => exists(p.join(acc, 'projects', encoded)))) return true;
  }
  return false;
}
