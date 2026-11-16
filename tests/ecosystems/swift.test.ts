import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { swift } from '../../src/ecosystems/swift.js';
import { FIXTURES, jsonResponse, stubFetch } from '../helpers.js';

const SWIFT_V2 = join(FIXTURES, 'swift-project');
const SWIFT_V1 = join(FIXTURES, 'swift-project-v1');

const GH_LICENSES: Record<string, string> = {
  'apple/swift-algorithms': 'Apache-2.0',
  'Alamofire/Alamofire': 'MIT',
};

let restoreFetch: (() => void) | null = null;
const savedToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
});

function stubGitHub(onRequest?: (url: string, init?: RequestInit) => void) {
  return stubFetch((url, init) => {
    onRequest?.(url, init);
    const m = url.match(/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/license/);
    const repo = `${decodeURIComponent(m?.[1] ?? '')}/${decodeURIComponent(m?.[2] ?? '')}`;
    const spdx = GH_LICENSES[repo];
    if (!spdx) return jsonResponse({ message: 'Not Found' }, 404);
    return jsonResponse({ license: { spdx_id: spdx } });
  });
}

describe('swift.detect', () => {
  test('true only when Package.swift exists', async () => {
    expect(await swift.detect(SWIFT_V2)).toBe(true);
    expect(await swift.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('swift.scan — v2 Package.resolved', () => {
  test('pins resolve to name/version/license; all deps are direct', async () => {
    delete process.env.GITHUB_TOKEN;
    restoreFetch = stubGitHub();

    const { deps, graph = {}, directDeps = new Set<string>() } = await swift.scan(SWIFT_V2);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d] as const));

    expect(byName['swift-algorithms']).toEqual({
      name: 'swift-algorithms',
      version: '1.2.0',
      license: 'Apache-2.0',
    });
    // Revision-only pin: version is the first 8 chars of the revision; 404 → null.
    expect(byName['revision-pkg']?.version).toBe('abcdef12');
    expect(byName['revision-pkg']?.license).toBeNull();
    // Non-GitHub host: no license lookup at all.
    expect(byName['nongh-pkg']).toEqual({ name: 'nongh-pkg', version: '0.1.0', license: null });

    expect(graph).toEqual({});
    expect([...directDeps].sort()).toEqual(['nongh-pkg', 'revision-pkg', 'swift-algorithms']);
  });

  test('non-GitHub URLs are never fetched', async () => {
    delete process.env.GITHUB_TOKEN;
    const urls: string[] = [];
    restoreFetch = stubGitHub((url) => urls.push(url));
    await swift.scan(SWIFT_V2);
    expect(urls.some((u) => u.includes('gitlab'))).toBe(false);
    expect(urls).toHaveLength(2);
  });

  test('GITHUB_TOKEN is sent as an Authorization header when set, absent otherwise', async () => {
    const authHeaders: Array<string | undefined> = [];
    const record = (_url: string, init?: RequestInit) => {
      authHeaders.push((init?.headers as Record<string, string> | undefined)?.Authorization);
    };

    process.env.GITHUB_TOKEN = 'test-token-123';
    restoreFetch = stubGitHub(record);
    await swift.scan(SWIFT_V2);
    expect(authHeaders.every((h) => h === 'token test-token-123')).toBe(true);

    restoreFetch();
    authHeaders.length = 0;

    delete process.env.GITHUB_TOKEN;
    restoreFetch = stubGitHub(record);
    await swift.scan(SWIFT_V2);
    expect(authHeaders.every((h) => h === undefined)).toBe(true);
  });
});

describe('swift.scan — v1 Package.resolved (object.pins)', () => {
  test('reads package/repositoryURL fields', async () => {
    delete process.env.GITHUB_TOKEN;
    restoreFetch = stubGitHub();
    const { deps } = await swift.scan(SWIFT_V1);
    expect(deps).toEqual([{ name: 'Alamofire', version: '5.8.0', license: 'MIT' }]);
  });
});

describe('swift.scan — errors', () => {
  test('missing Package.resolved → friendly error', () => {
    expect(swift.scan(join(FIXTURES, 'swift-no-resolved'))).rejects.toThrow(
      'Package.resolved not found — run swift package resolve first',
    );
  });

  test('offline: no GitHub call; pins kept, licenses null', async () => {
    const urls: string[] = [];
    restoreFetch = stubGitHub((url) => urls.push(url));

    const { deps } = await swift.scan(SWIFT_V2, { offline: true });

    expect(urls).toEqual([]);
    expect(deps.find((d) => d.name === 'swift-algorithms')).toEqual({
      name: 'swift-algorithms',
      version: '1.2.0',
      license: null,
    });
  });
});
