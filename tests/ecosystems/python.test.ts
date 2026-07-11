import { afterEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { python } from '../../src/ecosystems/python.js';
import { FIXTURES, jsonResponse, removeDir, stubFetch, tempDir } from '../helpers.js';

const PY_PROJECT = join(FIXTURES, 'python-project');

const PYPI: Record<string, { name: string; version: string; license: string | null }> = {
  flask: { name: 'Flask', version: '3.0.2', license: 'BSD-3-Clause' },
  sqlalchemy: { name: 'SQLAlchemy', version: '2.0.30', license: 'MIT' },
  django: { name: 'Django', version: '5.0.1', license: 'x'.repeat(150) },
  pytest: { name: 'pytest', version: '8.0.0', license: 'MIT' },
};

let restoreFetch: (() => void) | null = null;
let tmp: string | null = null;

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = null;
  if (tmp) {
    await removeDir(tmp);
    tmp = null;
  }
});

describe('python.detect', () => {
  test('each marker file triggers detection', async () => {
    for (const marker of ['requirements.txt', 'Pipfile.lock', 'pyproject.toml']) {
      tmp = await tempDir();
      await writeFile(join(tmp, marker), '');
      expect(await python.detect(tmp)).toBe(true);
      await removeDir(tmp);
      tmp = null;
    }
    expect(await python.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('python.scan', () => {
  test('merges requirements/Pipfile.lock/pyproject, venv wins over PyPI', async () => {
    const requested: string[] = [];
    restoreFetch = stubFetch((url) => {
      const m = url.match(/pypi\.org\/pypi\/([^/]+)\/json/);
      const name = decodeURIComponent(m?.[1] ?? '');
      requested.push(name);
      const info = PYPI[name];
      if (!info) return jsonResponse({ message: 'not found' }, 404);
      return jsonResponse({ info });
    });

    const { deps, graph = {}, directDeps = new Set<string>() } = await python.scan(PY_PROJECT);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d] as const));

    // requests resolves locally from .venv dist-info METADATA — never fetched.
    expect(byName.requests).toEqual({
      name: 'requests',
      version: '2.31.0',
      license: 'Apache-2.0',
    });
    expect(requested).not.toContain('requests');

    // URL/option/comment lines in requirements.txt are skipped.
    expect(deps).toHaveLength(7);

    // PyPI fallback: canonical name/version from the API.
    expect(byName.Flask).toEqual({ name: 'Flask', version: '3.0.2', license: 'BSD-3-Clause' });
    expect(byName.SQLAlchemy?.license).toBe('MIT');

    // License strings longer than 100 chars are treated as full text → null.
    expect(byName.Django?.license).toBeNull();

    // 404 → name falls back to the requested (normalized) name.
    expect(byName['foo-bar-baz']).toEqual({
      name: 'foo-bar-baz',
      version: 'unknown',
      license: null,
    });
    expect(byName.pydantic?.license).toBeNull();

    // No dependency graph for python: everything declared is direct.
    expect(graph).toEqual({});
    expect([...directDeps].sort()).toEqual([
      'django',
      'flask',
      'foo-bar-baz',
      'pydantic',
      'pytest',
      'requests',
      'sqlalchemy',
    ]);
  });

  test('package names are normalized (lowercase, [-_.] runs → -)', async () => {
    restoreFetch = stubFetch(() => jsonResponse({ message: 'nope' }, 404));
    tmp = await tempDir();
    await writeFile(join(tmp, 'requirements.txt'), 'Foo_Bar.baz==1.0\n');
    const { directDeps = new Set<string>() } = await python.scan(tmp);
    expect([...directDeps]).toEqual(['foo-bar-baz']);
  });

  test('no dependencies found → error', async () => {
    tmp = await tempDir();
    await writeFile(join(tmp, 'requirements.txt'), '# only comments\n');
    expect(python.scan(tmp)).rejects.toThrow('No Python dependencies found');
  });
});
