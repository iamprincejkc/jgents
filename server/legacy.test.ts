import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeStateMigration, legacyEnvVars, legacyEnvWarning, migrateLegacyStateDir } from './legacy';
import { tempDir } from './test/fixtures';

describe('variáveis do nome antigo', () => {
  it('lista só as HABBLAUD_*, com o nome novo, em ordem', () => {
    expect(legacyEnvVars(['PATH', 'HABBLAUD_PORT', 'JGENTS_BIND', 'HABBLAUD_BIND'])).toEqual([
      { from: 'HABBLAUD_BIND', to: 'JGENTS_BIND' },
      { from: 'HABBLAUD_PORT', to: 'JGENTS_PORT' },
    ]);
  });

  it('avisa só quando há alguma', () => {
    expect(legacyEnvWarning(['PATH', 'JGENTS_PORT'])).toBeUndefined();
    expect(legacyEnvWarning(['HABBLAUD_PORT'], 'no .env')).toBe(
      'variável do nome antigo ignorada no .env: HABBLAUD_PORT → JGENTS_PORT. Renomeie para valer de novo.',
    );
  });
});

describe('migrateLegacyStateDir', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  const write = (rel: string, text: string) => {
    mkdirSync(join(home, rel, '..'), { recursive: true });
    writeFileSync(join(home, rel), text);
  };
  const read = (rel: string) => readFileSync(join(home, rel), 'utf8');

  beforeEach(() => {
    tmp = tempDir('jgents-legacy-');
    home = tmp.dir;
  });
  afterEach(() => tmp.cleanup());

  it('sem a pasta antiga, não faz nada', () => {
    expect(migrateLegacyStateDir(home)).toEqual({ moved: [] });
    expect(existsSync(join(home, '.jgents'))).toBe(false);
  });

  it('sem a pasta nova, renomeia a antiga inteira', () => {
    write('.habblaud/names.json', '{"a":"Marina"}');
    write('.habblaud/usage/.claude.json', '{}');
    const r = migrateLegacyStateDir(home);
    expect(r).toEqual({ moved: ['.'] });
    expect(read('.jgents/names.json')).toBe('{"a":"Marina"}');
    expect(existsSync(join(home, '.jgents/usage/.claude.json'))).toBe(true);
    expect(existsSync(join(home, '.habblaud'))).toBe(false);
    expect(describeStateMigration(r)).toBe('~/.habblaud (nome antigo) agora é ~/.jgents.');
  });

  it('com a pasta nova já criada, move o que falta e, nos arquivos dos dois lados, fica o mais recente', () => {
    const at = (rel: string, minutes: number) => {
      const t = new Date(2026, 9, 8, 18, minutes);
      utimesSync(join(home, rel), t, t);
    };
    write('.habblaud/names.json', 'antigo');
    write('.habblaud/usage/.claude.json', 'antigo');
    write('.habblaud/usage/.claude-conta2.json', 'antigo, mas mais recente');
    write('.jgents/usage/.claude.json', 'novo');
    write('.jgents/usage/.claude-conta2.json', 'novo, mas parado');
    at('.habblaud/usage/.claude.json', 10);
    at('.jgents/usage/.claude.json', 20);
    at('.habblaud/usage/.claude-conta2.json', 30);
    at('.jgents/usage/.claude-conta2.json', 20);
    const r = migrateLegacyStateDir(home);
    expect(r.moved.sort()).toEqual(['names.json', 'usage/.claude-conta2.json']);
    expect(read('.jgents/names.json')).toBe('antigo');
    expect(read('.jgents/usage/.claude.json')).toBe('novo');
    expect(read('.jgents/usage/.claude-conta2.json')).toBe('antigo, mas mais recente');
    // O que perdeu para um arquivo mais novo fica na pasta antiga, que então não some.
    expect(read('.habblaud/usage/.claude.json')).toBe('antigo');
    expect(describeStateMigration(r)).toContain('names.json, usage/.claude-conta2.json');
  });

  it('pasta antiga sem nada que falte: some', () => {
    mkdirSync(join(home, '.habblaud'));
    mkdirSync(join(home, '.jgents'));
    expect(migrateLegacyStateDir(home)).toEqual({ moved: [] });
    expect(existsSync(join(home, '.habblaud'))).toBe(false);
  });

  it('não lança: devolve o erro (ex.: ~/.jgents é um arquivo)', () => {
    write('.habblaud/names.json', '{}');
    write('.jgents', 'arquivo');
    const r = migrateLegacyStateDir(home);
    expect(r).toEqual({ moved: [], error: `${join(home, '.jgents')} existe e não é uma pasta` });
    expect(existsSync(join(home, '.habblaud/names.json'))).toBe(true);
    expect(describeStateMigration(r)).toMatch(/^não consegui levar ~\/\.habblaud para ~\/\.jgents/);
  });
});
