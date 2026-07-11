import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { scanProject } from '../src/scan.js';
import { FIXTURES, normalizeScanResult, removeDir, tempDir } from './helpers.js';

const NPM_PROJECT = join(FIXTURES, 'npm-project');
const NPM_PROJECT_CONFIG = join(FIXTURES, 'npm-project-config');

async function golden(name: string) {
  return JSON.parse(await readFile(join(FIXTURES, 'golden', name), 'utf-8'));
}

describe('scanProject — npm fixture (offline)', () => {
  test('matches the v0.3.1 golden output', async () => {
    const result = await scanProject(NPM_PROJECT, {});
    expect(normalizeScanResult(result)).toEqual(await golden('npm-project.json'));
  });

  test('with .lguardrc: violations, overrides, ignore match golden', async () => {
    const config = await loadConfig(NPM_PROJECT_CONFIG);
    const result = await scanProject(NPM_PROJECT_CONFIG, { config });
    expect(normalizeScanResult(result)).toEqual(await golden('npm-project-config.json'));
  });

  test('public JSON schema: exact key sets are frozen', async () => {
    const result = await scanProject(NPM_PROJECT, {});
    expect(Object.keys(result)).toEqual([
      'path',
      'ecosystems',
      'dependencies',
      'summary',
      'hasConfig',
    ]);
    const first = result.dependencies[0];
    if (!first) throw new Error('scan returned no dependencies');
    expect(Object.keys(first)).toEqual([
      'name',
      'version',
      'license',
      'risk',
      'ecosystem',
      'direct',
      'chain',
      'violation',
      'violationReason',
      'overrideReason',
    ]);
    expect(Object.keys(result.summary)).toEqual([
      'total',
      'high',
      'medium',
      'low',
      'unknown',
      'violations',
      'overrides',
    ]);
  });

  test('transitive chain is computed via BFS from direct deps', async () => {
    const result = await scanProject(NPM_PROJECT, {});
    const transitive = result.dependencies.find((d) => d.name === 'transitive-gpl');
    expect(transitive?.direct).toBe(false);
    expect(transitive?.chain).toEqual(['parent-pkg', 'transitive-gpl']);
    const unreachable = result.dependencies.find((d) => d.name === 'no-license-pkg');
    expect(unreachable?.direct).toBe(false);
    expect(unreachable?.chain).toBeNull();
  });

  test('ignore via options merges with config ignore', async () => {
    const result = await scanProject(NPM_PROJECT, {
      ignore: ['mit-pkg'],
      config: { ignore: ['gpl-pkg'] },
    });
    const names = result.dependencies.map((d) => d.name);
    expect(names).not.toContain('mit-pkg');
    expect(names).not.toContain('gpl-pkg');
    expect(result.summary.total).toBe(7);
  });

  test('allow-mode policy: not-in-list and missing licenses are violations', async () => {
    const result = await scanProject(NPM_PROJECT, {
      config: { allow: ['MIT', 'Apache-2.0', 'ISC'] },
    });
    const dep = (name: string) => {
      const found = result.dependencies.find((d) => d.name === name);
      if (!found) throw new Error(`dependency not found: ${name}`);
      return found;
    };
    expect(dep('gpl-pkg').violation).toBe(true);
    expect(dep('gpl-pkg').violationReason).toBe('not in allow list');
    expect(dep('no-license-pkg').violation).toBe(true);
    expect(dep('no-license-pkg').violationReason).toBe('no license specified');
    // OR expression escapes via the allowed branch
    expect(dep('dual-pkg').violation).toBe(false);
    expect(dep('legacy-pkg').violation).toBe(false);
    expect(dep('mit-pkg').violation).toBe(false);
    expect(result.summary.violations).toBe(4);
  });

  test('hasConfig reflects whether a config was passed', async () => {
    expect((await scanProject(NPM_PROJECT, {})).hasConfig).toBe(false);
    expect((await scanProject(NPM_PROJECT, { config: { deny: ['X'] } })).hasConfig).toBe(true);
  });
});

describe('scanProject — ecosystem selection and errors', () => {
  test('unknown forced ecosystem throws', () => {
    expect(scanProject(NPM_PROJECT, { ecosystem: 'maven' })).rejects.toThrow(
      'Unknown ecosystem: maven. Supported: npm, cargo, python, ruby, go, swift',
    );
  });

  test('no ecosystem detected throws', () => {
    expect(scanProject(join(FIXTURES, 'empty-project'), {})).rejects.toThrow(
      'No supported package ecosystem detected. Supported: npm, cargo, python, ruby, go, swift',
    );
  });

  test('forced ecosystem failure propagates', () => {
    expect(scanProject(join(FIXTURES, 'npm-no-modules'), { ecosystem: 'npm' })).rejects.toThrow(
      'node_modules not found — run npm/bun/pnpm install first',
    );
  });

  describe('multi-ecosystem partial failure', () => {
    let dir: string;

    afterEach(async () => {
      await removeDir(dir);
    });

    test('failed ecosystem warns on stderr and the rest continue', async () => {
      dir = await tempDir();
      await cp(NPM_PROJECT, dir, { recursive: true });
      // Swift detects via Package.swift but fails without Package.resolved.
      await writeFile(join(dir, 'Package.swift'), '// swift-tools-version:5.9\n');

      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
      try {
        const result = await scanProject(dir, {});
        expect(result.ecosystems).toEqual(['npm', 'swift']);
        expect(result.summary.total).toBe(9);
        expect(errorSpy).toHaveBeenCalledWith(
          'Warning: swift scan failed — Package.resolved not found — run swift package resolve first',
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
