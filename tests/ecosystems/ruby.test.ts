import { afterEach, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ruby } from '../../src/ecosystems/ruby.js';
import { FIXTURES, jsonResponse, removeDir, stubFetch, tempDir } from '../helpers.js';

const RUBY_PROJECT = join(FIXTURES, 'ruby-project');

const GEM_LICENSES: Record<string, string[]> = {
  rails: ['MIT'],
  actionpack: ['MIT'],
  activesupport: ['MIT', 'Apache-2.0'],
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

describe('ruby.detect', () => {
  test('true only when Gemfile.lock exists', async () => {
    expect(await ruby.detect(RUBY_PROJECT)).toBe(true);
    expect(await ruby.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('ruby.scan', () => {
  test('parses Gemfile.lock and resolves licenses via RubyGems', async () => {
    const requested: string[] = [];
    restoreFetch = stubFetch((url) => {
      requested.push(url);
      const m = url.match(/rubygems\/([^/]+)\/versions\/(.+)\.json$/);
      const name = decodeURIComponent(m?.[1] ?? '');
      const licenses = GEM_LICENSES[name];
      if (!licenses) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ licenses });
    });

    const { deps, graph = {}, directDeps = new Set<string>() } = await ruby.scan(RUBY_PROJECT);

    const byName = Object.fromEntries(deps.map((d) => [d.name, d] as const));
    expect(deps).toHaveLength(4);
    expect(byName.rails).toEqual({ name: 'rails', version: '7.1.0', license: 'MIT' });
    expect(byName.activesupport?.license).toBe('MIT OR Apache-2.0');
    // 404 → license null
    expect(byName.nokogiri?.license).toBeNull();

    // Graph from Gemfile.lock indentation; direct deps from Gemfile.
    expect(graph.rails).toEqual(['actionpack', 'activesupport']);
    expect(graph.actionpack).toEqual(['activesupport']);
    expect(graph.nokogiri).toEqual([]);
    expect([...directDeps].sort()).toEqual(['nokogiri', 'rails']);

    expect(requested).toContain('https://rubygems.org/api/v2/rubygems/rails/versions/7.1.0.json');
  });

  test('network failure → license null, scan still succeeds', async () => {
    restoreFetch = stubFetch(() => {
      throw new Error('network down');
    });
    const { deps } = await ruby.scan(RUBY_PROJECT);
    expect(deps).toHaveLength(4);
    for (const dep of deps) expect(dep.license).toBeNull();
  });

  test('empty Gemfile.lock → error', async () => {
    tmp = await tempDir();
    await writeFile(join(tmp, 'Gemfile.lock'), 'GEM\n  specs:\n');
    expect(ruby.scan(tmp)).rejects.toThrow('No gems found in Gemfile.lock');
  });

  test('offline: no RubyGems call; versions and graph kept, licenses null', async () => {
    const requested: string[] = [];
    restoreFetch = stubFetch((url) => {
      requested.push(url);
      return jsonResponse({}, 500);
    });

    const {
      deps,
      graph = {},
      directDeps = new Set<string>(),
    } = await ruby.scan(RUBY_PROJECT, {
      offline: true,
    });

    expect(requested).toEqual([]);
    expect(deps).toHaveLength(4);
    expect(deps.find((d) => d.name === 'rails')).toEqual({
      name: 'rails',
      version: '7.1.0',
      license: null,
    });
    expect(deps.every((d) => d.license === null)).toBe(true);
    expect(graph.rails).toEqual(['actionpack', 'activesupport']);
    expect([...directDeps].sort()).toEqual(['nokogiri', 'rails']);
  });
});
