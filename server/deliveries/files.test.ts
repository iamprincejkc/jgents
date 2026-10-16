import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { checkFile, DELIVERY_FILE_MAX_BYTES, fileType, insideKnownFolder, pathProblem, realPath } from './files';

describe('arquivos das entregas', () => {
  it('só tipos de ver e nada com cara de segredo', () => {
    expect(fileType('/a/b.PNG')).toEqual({ kind: 'image', type: 'image/png' });
    expect(fileType('/a/b.pdf')?.kind).toBe('pdf');
    expect(fileType('/a/b.json')).toBeUndefined();
    expect(pathProblem('/Users/a/p/relatorio.pdf')).toBeUndefined();
    for (const bad of ['/Users/a/.ssh/x.png', '/Users/a/p/.env.png', '/Users/a/p/secret-plan.pdf', '/Users/a/p/server.key', '/Users/a/.aws/c.txt', '/Users/a/.jgents/remote-tls/ca.pdf', 'rel.png', '/a/../b.png', '/a/b.sh', '/a/id_ed25519']) {
      expect(pathProblem(bad), bad).toBeDefined();
    }
  });

  it('caminhos do Windows: valem com \\ ou /; segredos, rede (\\\\servidor), ".." e fluxos com ":" não', () => {
    for (const ok of ['C:\\Users\\a\\p\\relatorio.pdf', 'D:/UNDER CONSTRUCTION/p/print.png', 'c:\\a\\b.PNG']) expect(pathProblem(ok), ok).toBeUndefined();
    const bad = [
      'C:\\Users\\a\\.ssh\\x.png',
      'C:\\Users\\a\\.SSH\\x.png',
      'C:/Users/a/.aws/c.txt',
      'C:\\Users\\a\\.jgents\\remote-tls\\ca.pdf',
      'C:\\Users\\a\\p\\.env.png',
      'C:\\Users\\a\\p\\server.key',
      'C:\\Users\\a\\p\\secret-plan.pdf',
      'C:\\a\\..\\b.png',
      'C:\\a\\..',
      'C:relativo.png',
      '\\a\\b.png',
      '\\\\servidor\\pasta\\x.png',
      '//servidor/pasta/x.png',
      '/\\servidor\\pasta\\x.png',
      'C:\\a\\b.txt:escondido.png',
      'C:\\Users\\a\\.ssh::$INDEX_ALLOCATION\\x.png',
    ];
    for (const p of bad) expect(pathProblem(p), p).toBeDefined();
    expect(pathProblem('C:\\Users\\a\\.ssh\\x.png')).toBe('arquivo protegido');
    expect(pathProblem('\\\\servidor\\pasta\\x.png')).toBe('caminho inválido');
  });

  it('checkFile: confere o caminho real (link para segredo cai), tamanho e tipo', () => {
    const fs = (real: string, size = 10, file = true) => ({ realpath: () => real, stat: () => ({ isFile: () => file, size }) });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png'))).toEqual({ path: '/Users/a/p/x.png', size: 10 });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/.ssh/x.png'))).toEqual({ error: 'arquivo protegido' });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', DELIVERY_FILE_MAX_BYTES + 1))).toHaveProperty('error');
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', 1, false))).toEqual({ error: 'não é um arquivo' });
    expect(checkFile('/nao/existe.png')).toEqual({ error: 'arquivo não encontrado' });
  });

  it('insideKnownFolder: só pastas de projeto que alguma conta conhece, as temporárias e os anexos', () => {
    const known = new Set(['/h/.claude/projects/-Users-ana-loja', '/h/.claude-2/projects/-Users-ana-x-y']);
    const opts = { accountDirs: ['/h/.claude', '/h/.claude-2'], roots: ['/tmp', '/h/.jgents/attachments'], exists: (p: string) => known.has(p) };
    expect(insideKnownFolder('/Users/ana/loja/docs/print.png', opts)).toBe(true);
    expect(insideKnownFolder('/Users/ana/x-y/a.pdf', opts)).toBe(true);
    expect(insideKnownFolder('/tmp/claude/scratch/tela.png', opts)).toBe(true);
    expect(insideKnownFolder('/h/.jgents/attachments/20261013-ab/foto.jpg', opts)).toBe(true);
    // Fora dos projetos: o resto da pasta pessoal, outra pasta de projeto que ninguém usou e o próprio "/Users".
    expect(insideKnownFolder('/Users/ana/Documents/extrato.pdf', opts)).toBe(false);
    expect(insideKnownFolder('/Users/ana/lojas/a.png', opts)).toBe(false);
    expect(insideKnownFolder('/tmpx/a.png', opts)).toBe(false);
  });

  it('insideKnownFolder no Windows: D:\\obra\\app vira D--obra-app, como o Claude Code grava; a temporária e os anexos com \\', () => {
    const projects = ['D--UNDER-CONSTRUCTION', 'D--UNDER-CONSTRUCTION-Personal', 'C--Users-ana-loja'];
    const known = new Set(projects.map((p) => `C:\\Users\\ana\\.claude\\projects\\${p}`));
    const opts = {
      accountDirs: ['C:\\Users\\ana\\.claude'],
      roots: ['/tmp', 'C:\\Users\\ana\\AppData\\Local\\Temp', 'C:\\Users\\ana\\.jgents\\attachments\\'],
      exists: (p: string) => known.has(p),
    };
    expect(insideKnownFolder('D:\\UNDER CONSTRUCTION\\Personal\\x\\print.png', opts)).toBe(true);
    expect(insideKnownFolder('D:/UNDER CONSTRUCTION/Personal/a.pdf', opts)).toBe(true);
    expect(insideKnownFolder('C:\\Users\\ana\\loja\\docs\\a.png', opts)).toBe(true);
    expect(insideKnownFolder('C:\\Users\\ana\\AppData\\Local\\Temp\\claude\\scratch\\tela.png', opts)).toBe(true);
    expect(insideKnownFolder('C:\\Users\\ana\\.jgents\\attachments\\20261013-ab\\foto.jpg', opts)).toBe(true);
    // Fora: uma pasta logo abaixo da unidade nunca vale inteira (como "/Users"), o resto da pasta pessoal, uma vizinha
    // com o mesmo começo e temporárias de mentira.
    expect(insideKnownFolder('D:\\UNDER CONSTRUCTION\\a.png', opts)).toBe(false);
    expect(insideKnownFolder('C:\\Users\\ana\\Documents\\extrato.pdf', opts)).toBe(false);
    expect(insideKnownFolder('D:\\UNDER CONSTRUCTION\\Personalx\\a.png', opts)).toBe(false);
    expect(insideKnownFolder('C:\\Users\\ana\\AppData\\Local\\Tempx\\a.png', opts)).toBe(false);
    expect(insideKnownFolder('C:\\tmp\\a.png', opts)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('no Windows, o caminho real é o do sistema: "::$INDEX_ALLOCATION" (e os nomes 8.3) viram o nome de verdade', () => {
    const tmp = tempDir();
    try {
      mkdirSync(join(tmp.dir, '.ssh'));
      writeFileSync(join(tmp.dir, '.ssh', 'x.png'), 'x');
      expect(realPath(join(tmp.dir, '.ssh::$INDEX_ALLOCATION', 'x.png'))).toBe(join(realPath(tmp.dir), '.ssh', 'x.png'));
      expect(checkFile(join(tmp.dir, '.ssh', 'x.png'))).toEqual({ error: 'arquivo protegido' });
      writeFileSync(join(tmp.dir, 'a.png'), 'png');
      expect(checkFile(join(tmp.dir, 'a.png'))).toEqual({ path: join(realPath(tmp.dir), 'a.png'), size: 3 });
    } finally {
      tmp.cleanup();
    }
  });
});
