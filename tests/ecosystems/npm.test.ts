import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { npm } from '../../src/ecosystems/npm.js';
import { FIXTURES } from '../helpers.js';

const NPM_PROJECT = join(FIXTURES, 'npm-project');

describe('npm.detect', () => {
  test('true when package.json exists', async () => {
    expect(await npm.detect(NPM_PROJECT)).toBe(true);
  });

  test('false otherwise', async () => {
    expect(await npm.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('npm.scan', () => {
  test('walks node_modules recursively and dedupes by name@version', async () => {
    const { deps } = await npm.scan(NPM_PROJECT);
    // mit-pkg@1.0.0 exists both top-level and nested under parent-pkg — one entry.
    const names = deps.map((d) => d.name).sort();
    expect(names).toEqual([
      '@scope/pkg',
      'dual-pkg',
      'gpl-pkg',
      'legacy-pkg',
      'lgpl-pkg',
      'mit-pkg',
      'no-license-pkg',
      'parent-pkg',
      'transitive-gpl',
    ]);
  });

  test('normalizes license shapes: object, legacy array, missing', async () => {
    const { deps } = await npm.scan(NPM_PROJECT);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d] as const));
    expect(byName['lgpl-pkg']?.license).toBe('LGPL-3.0');
    expect(byName['legacy-pkg']?.license).toBe('MIT OR Apache-2.0');
    expect(byName['no-license-pkg']?.license).toBeNull();
    expect(byName['dual-pkg']?.license).toBe('(MIT OR GPL-3.0)');
  });

  test('direct deps come from all dependency sections of the root package.json', async () => {
    const { directDeps = new Set<string>() } = await npm.scan(NPM_PROJECT);
    expect([...directDeps].sort()).toEqual([
      '@scope/pkg',
      'dual-pkg',
      'gpl-pkg',
      'legacy-pkg',
      'lgpl-pkg',
      'mit-pkg',
      'parent-pkg',
    ]);
  });

  test('graph maps each package to its declared deps', async () => {
    const { graph = {} } = await npm.scan(NPM_PROJECT);
    expect(graph['parent-pkg']).toEqual(['transitive-gpl', 'mit-pkg']);
    expect(graph['mit-pkg']).toEqual([]);
    expect(graph['transitive-gpl']).toEqual([]);
  });

  test('missing node_modules → exact error message', () => {
    expect(npm.scan(join(FIXTURES, 'npm-no-modules'))).rejects.toThrow(
      'node_modules not found — run npm/bun/pnpm install first',
    );
  });
});
