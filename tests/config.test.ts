import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initConfig, loadConfig } from '../src/config.js';
import { FIXTURES, removeDir, tempDir } from './helpers.js';

const CONFIGS = join(FIXTURES, 'configs');

describe('loadConfig', () => {
  test('valid config parses and validates', async () => {
    expect(await loadConfig(join(CONFIGS, 'valid'))).toEqual({
      deny: ['AGPL-3.0', 'GPL-3.0'],
      ignore: ['some-pkg'],
      failOn: 'high',
      overrides: { 'other-pkg': 'reviewed' },
    });
  });

  test('missing file → null', async () => {
    const dir = await tempDir();
    try {
      expect(await loadConfig(dir)).toBeNull();
    } finally {
      await removeDir(dir);
    }
  });

  test('malformed JSON → error prefixed with .lguardrc:', async () => {
    expect(loadConfig(join(CONFIGS, 'malformed'))).rejects.toThrow(/^\.lguardrc: /);
  });

  test('allow and deny together are rejected', async () => {
    expect(loadConfig(join(CONFIGS, 'allow-and-deny'))).rejects.toThrow(
      '.lguardrc: Cannot set both "allow" and "deny" — use one or the other',
    );
  });

  test('bad failOn value is rejected', async () => {
    expect(loadConfig(join(CONFIGS, 'bad-failon'))).rejects.toThrow(
      '.lguardrc: "failOn" must be one of: high, medium, unknown',
    );
  });

  test('non-string override value is rejected', async () => {
    expect(loadConfig(join(CONFIGS, 'bad-overrides'))).rejects.toThrow(
      '.lguardrc: "overrides.pkg" must be a string reason',
    );
  });

  test('non-array deny is rejected', async () => {
    expect(loadConfig(join(CONFIGS, 'bad-deny'))).rejects.toThrow(
      '.lguardrc: "deny" must be an array of license identifiers',
    );
  });

  test('allow-only config is accepted', async () => {
    expect(await loadConfig(join(CONFIGS, 'allow-only'))).toEqual({
      allow: ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause'],
    });
  });
});

describe('initConfig', () => {
  let dir: string;

  afterEach(async () => {
    await removeDir(dir);
  });

  test('creates the default config and returns its path', async () => {
    dir = await tempDir();
    const path = await initConfig(dir);
    expect(path).toBe(join(dir, '.lguardrc'));
    const written = JSON.parse(await readFile(path, 'utf-8'));
    expect(written).toEqual({
      deny: [
        'AGPL-3.0',
        'AGPL-3.0-only',
        'AGPL-3.0-or-later',
        'GPL-2.0',
        'GPL-2.0-only',
        'GPL-2.0-or-later',
        'GPL-3.0',
        'GPL-3.0-only',
        'GPL-3.0-or-later',
        'SSPL-1.0',
      ],
      ignore: [],
      failOn: 'high',
      overrides: {},
    });
    expect(await readFile(path, 'utf-8')).toEndWith('\n');
  });

  test('refuses to overwrite an existing config', async () => {
    dir = await tempDir();
    await initConfig(dir);
    expect(initConfig(dir)).rejects.toThrow('.lguardrc already exists');
  });
});
