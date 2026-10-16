// Onde está o `claude` do Claude Code neste computador. Usado pelo terminal interativo (pty/manager.ts), pelo Novo
// agente (spawn/spawn.ts) e pelo auxiliar do host (scripts/codex-bridge.ts). Node puro e sem dependências.
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

/** O arquivo existe e pode ser executado (no Windows basta existir: lá não há permissão de execução). */
export function isExecutableFile(file: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Procura um executável no PATH (no Windows, também com as extensões de PATHEXT, se o nome não tiver uma). */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const sep = platform === 'win32' ? ';' : ':';
  const exts =
    platform === 'win32' && !extname(name) ? ['.exe', ...(env.PATHEXT ?? '.COM;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase())] : [''];
  const dirs = (env.PATH ?? env.Path ?? '').split(sep).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = resolve(dir, name + ext);
      if (isExecutableFile(file, platform)) return file;
    }
  }
  return undefined;
}

/**
 * No Windows, o npm instala cada comando como um shim `.cmd` (`"%dp0%\node_modules\...\claude.exe" %*`), que o Node
 * não roda sem shell (spawn dá EINVAL). Quando o shim chama um .exe que existe, vale o .exe; senão, o próprio arquivo.
 */
export function unwrapNpmShim(file: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || extname(file).toLowerCase() !== '.cmd') return file;
  try {
    const target = /"%dp0%\\([^"%]+\.exe)"/i.exec(readFileSync(file, 'utf8'))?.[1];
    if (target) {
      const exe = join(dirname(file), ...target.split('\\'));
      if (isExecutableFile(exe, platform)) return exe;
    }
  } catch {
    // ilegível: fica o próprio .cmd
  }
  return file;
}

/** Um caminho (vale como está) ou um nome procurado no PATH, já sem o shim `.cmd` do npm. undefined se não achar. */
export function resolveExecutable(nameOrPath: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const file = /[\\/]/.test(nameOrPath) ? resolve(nameOrPath) : findExecutable(nameOrPath, env, platform);
  return file && unwrapNpmShim(file, platform);
}

/**
 * O executável do Claude Code: JGENTS_CLAUDE_BIN (um caminho, ou um nome procurado
 * no PATH) ou o `claude` do PATH. undefined se não achar.
 */
export function claudeBinFrom(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  return resolveExecutable(env.JGENTS_CLAUDE_BIN?.trim() || 'claude', env, platform);
}

/** O `claude` que dá para rodar: o de claudeBinFrom, se o arquivo existe e é executável. */
export function runnableClaudeBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const bin = claudeBinFrom(env, platform);
  return bin && isExecutableFile(bin, platform) ? bin : undefined;
}
