import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { go } from '../../src/ecosystems/go.js';
import { FIXTURES, removeDir, tempDir } from '../helpers.js';
import { execMock } from '../preload.js';

const GO_PROJECT = join(FIXTURES, 'go-project');
const EXEC_OUT = join(FIXTURES, 'exec-output');
const MODCACHE = join(EXEC_OUT, 'go-modcache');

interface ExecCall {
  cmd: string;
  args: string[];
  opts: unknown;
}

function installGoHandler(
  overrides: Partial<Record<string, () => Promise<{ stdout: string; stderr: string }>>> = {},
) {
  const calls: ExecCall[] = [];
  execMock.handler = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd !== 'go') throw new Error(`unexpected command: ${cmd}`);
    const key = args.join(' ');
    const override = overrides[key];
    if (override) return override();
    if (key === 'list -m -json all') {
      return { stdout: await readFile(join(EXEC_OUT, 'go-list.txt'), 'utf-8'), stderr: '' };
    }
    if (key === 'env GOMODCACHE') {
      return { stdout: `${MODCACHE}\n`, stderr: '' };
    }
    if (key === 'mod graph') {
      return { stdout: await readFile(join(EXEC_OUT, 'go-mod-graph.txt'), 'utf-8'), stderr: '' };
    }
    throw new Error(`unexpected go invocation: ${key}`);
  };
  return calls;
}

let tmp: string | null = null;

afterEach(async () => {
  execMock.handler = null;
  if (tmp) {
    await removeDir(tmp);
    tmp = null;
  }
});

describe('go.detect', () => {
  test('true only when go.mod exists', async () => {
    expect(await go.detect(GO_PROJECT)).toBe(true);
    expect(await go.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('go.scan', () => {
  test('parses go list stream, builds graph, identifies licenses from the module cache', async () => {
    const calls = installGoHandler();
    const { deps, graph = {}, directDeps = new Set<string>() } = await go.scan(GO_PROJECT);

    // Main module excluded from deps.
    expect(deps).toEqual([
      { name: 'github.com/pkg/errors', version: 'v0.9.1', license: 'BSD-2-Clause' },
      { name: 'golang.org/x/text', version: 'v0.14.0', license: 'BSD-3-Clause' },
    ]);

    expect(graph['example.com/myapp']).toEqual(['github.com/pkg/errors', 'golang.org/x/text']);
    expect(graph['github.com/pkg/errors']).toEqual(['golang.org/x/text']);
    expect([...directDeps].sort()).toEqual(['github.com/pkg/errors', 'golang.org/x/text']);

    const listCall = calls.find((c) => c.args[0] === 'list');
    if (!listCall) throw new Error('go list was never invoked');
    const opts = listCall.opts as { cwd: string; maxBuffer: number };
    expect(opts.cwd).toBe(GO_PROJECT);
    expect(opts.maxBuffer).toBe(50 * 1024 * 1024);
  });

  test('go mod graph failure → all non-main modules marked direct', async () => {
    installGoHandler({
      'mod graph': () => Promise.reject(new Error('graph failed')),
    });
    const { directDeps = new Set<string>(), graph = {} } = await go.scan(GO_PROJECT);
    expect([...directDeps].sort()).toEqual(['github.com/pkg/errors', 'golang.org/x/text']);
    expect(graph).toEqual({});
  });

  test('missing go binary → friendly error', async () => {
    execMock.handler = () => {
      const err = new Error('spawn go ENOENT') as Error & { code: string };
      err.code = 'ENOENT';
      return Promise.reject(err);
    };
    expect(go.scan(GO_PROJECT)).rejects.toThrow('go not found — install Go toolchain');
  });

  test('go list failure → wrapped error', async () => {
    execMock.handler = () => Promise.reject(new Error('boom'));
    expect(go.scan(GO_PROJECT)).rejects.toThrow('go list failed: boom');
  });

  test('license identification table (via a synthetic module cache)', async () => {
    tmp = await tempDir();
    const table: Array<[string, string, string | null]> = [
      ['lic-agpl', 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007', 'AGPL-3.0'],
      ['lic-lgpl3', 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007', 'LGPL-3.0'],
      ['lic-lgpl2', 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999', 'LGPL-2.1'],
      ['lic-gpl3', 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007', 'GPL-3.0'],
      ['lic-gpl2', 'GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991', 'GPL-2.0'],
      ['lic-mpl', 'Mozilla Public License Version 2.0', 'MPL-2.0'],
      ['lic-epl', 'Eclipse Public License - v 2.0', 'EPL-2.0'],
      ['lic-apache', 'Apache License\nVersion 2.0, January 2004', 'Apache-2.0'],
      ['lic-mit', 'Permission is hereby granted, free of charge, to any person', 'MIT'],
      ['lic-isc', 'ISC License\n\nCopyright (c) 2024', 'ISC'],
      [
        'lic-unlicense',
        'This is free and unencumbered software released into the public domain.',
        'Unlicense',
      ],
      ['lic-bsl', 'Boost Software License - Version 1.0', 'BSL-1.0'],
      ['lic-cc0', 'Creative Commons Legal Code\n\nCC0 1.0 Universal', 'CC0-1.0'],
      ['lic-wtfpl', 'DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE', 'WTFPL'],
      ['lic-none', 'Proprietary. All rights reserved.', null],
      ['lic-missing', '', null], // no LICENSE file at all
    ];

    const listObjects = [
      JSON.stringify({ Path: 'example.com/main', Main: true }),
      ...table.map(([name]) => JSON.stringify({ Path: `example.com/${name}`, Version: 'v1.0.0' })),
    ].join('\n');

    for (const [name, text] of table) {
      if (name === 'lic-missing') continue;
      const modDir = join(tmp, `example.com/${name}@v1.0.0`);
      await mkdir(modDir, { recursive: true });
      await writeFile(join(modDir, 'LICENSE'), text);
    }

    const modcache = tmp;
    execMock.handler = async (_cmd, args) => {
      const key = args.join(' ');
      if (key === 'list -m -json all') return { stdout: listObjects, stderr: '' };
      if (key === 'env GOMODCACHE') return { stdout: `${modcache}\n`, stderr: '' };
      if (key === 'mod graph') return { stdout: '', stderr: '' };
      throw new Error(`unexpected: ${key}`);
    };

    const { deps } = await go.scan(GO_PROJECT);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d.license] as const));
    for (const [name, , expected] of table) {
      expect(byName[`example.com/${name}`]).toBe(expected);
    }
  });

  test('offline: every go call runs with GOPROXY=off and GOSUMDB=off', async () => {
    const calls = installGoHandler();

    const { deps } = await go.scan(GO_PROJECT, { offline: true });

    expect(deps).toHaveLength(2);
    expect(calls.map((c) => c.args.join(' ')).sort()).toEqual([
      'env GOMODCACHE',
      'list -m -json all',
      'mod graph',
    ]);
    for (const call of calls) {
      const env = (call.opts as { env?: Record<string, string> }).env;
      expect(env?.GOPROXY).toBe('off');
      expect(env?.GOSUMDB).toBe('off');
      expect(env?.PATH).toBe(process.env.PATH);
    }
  });

  test('online: go calls keep the inherited environment', async () => {
    const calls = installGoHandler();

    await go.scan(GO_PROJECT);

    for (const call of calls) {
      expect((call.opts as { env?: unknown }).env).toBe(undefined);
    }
  });
});
