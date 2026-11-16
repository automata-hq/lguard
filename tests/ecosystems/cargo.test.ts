import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cargo } from '../../src/ecosystems/cargo.js';
import { FIXTURES } from '../helpers.js';
import { execMock } from '../preload.js';

const CARGO_PROJECT = join(FIXTURES, 'cargo-project');
const METADATA = join(FIXTURES, 'exec-output', 'cargo-metadata.json');

afterEach(() => {
  execMock.handler = null;
});

describe('cargo.detect', () => {
  test('true only when Cargo.toml exists', async () => {
    expect(await cargo.detect(CARGO_PROJECT)).toBe(true);
    expect(await cargo.detect(join(FIXTURES, 'empty-project'))).toBe(false);
  });
});

describe('cargo.scan', () => {
  test('workspace members excluded; graph and direct deps from resolve', async () => {
    const calls: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
    execMock.handler = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      if (cmd !== 'cargo') throw new Error(`unexpected command: ${cmd}`);
      return { stdout: await readFile(METADATA, 'utf-8'), stderr: '' };
    };

    const { deps, graph = {}, directDeps = new Set<string>() } = await cargo.scan(CARGO_PROJECT);

    expect(deps).toEqual([
      { name: 'serde', version: '1.0.200', license: 'MIT OR Apache-2.0' },
      { name: 'gpl-crate', version: '0.3.0', license: 'GPL-3.0' },
      { name: 'itoa', version: '1.0.11', license: 'MIT' },
    ]);

    expect(graph['my-app']).toEqual(['serde', 'gpl-crate']);
    expect(graph.serde).toEqual(['itoa']);
    expect(graph['gpl-crate']).toEqual([]);
    expect([...directDeps].sort()).toEqual(['gpl-crate', 'serde']);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('cargo was never invoked');
    expect(call.args).toEqual(['metadata', '--format-version', '1']);
    const opts = call.opts as { cwd: string; maxBuffer: number };
    expect(opts.cwd).toBe(CARGO_PROJECT);
    expect(opts.maxBuffer).toBe(50 * 1024 * 1024);
  });

  test('null license passes through', async () => {
    execMock.handler = async () => ({
      stdout: JSON.stringify({
        packages: [
          { id: 'root 1.0.0 (path+file:///r)', name: 'root', version: '1.0.0', license: null },
          { id: 'dep 2.0.0 (registry+x)', name: 'dep', version: '2.0.0', license: null },
        ],
        workspace_members: ['root 1.0.0 (path+file:///r)'],
        resolve: null,
      }),
      stderr: '',
    });
    const { deps, graph = {}, directDeps = new Set<string>() } = await cargo.scan(CARGO_PROJECT);
    expect(deps).toEqual([{ name: 'dep', version: '2.0.0', license: null }]);
    expect(graph).toEqual({});
    expect(directDeps.size).toBe(0);
  });

  test('missing cargo binary → friendly error', async () => {
    execMock.handler = () => {
      const err = new Error('spawn cargo ENOENT') as Error & { code: string };
      err.code = 'ENOENT';
      return Promise.reject(err);
    };
    expect(cargo.scan(CARGO_PROJECT)).rejects.toThrow('cargo not found — install Rust toolchain');
  });

  test('cargo metadata failure → wrapped error', async () => {
    execMock.handler = () => Promise.reject(new Error('boom'));
    expect(cargo.scan(CARGO_PROJECT)).rejects.toThrow('cargo metadata failed: boom');
  });

  test('offline: cargo metadata gets --offline', async () => {
    const calls: string[][] = [];
    execMock.handler = async (_cmd, args) => {
      calls.push(args);
      return { stdout: await readFile(METADATA, 'utf-8'), stderr: '' };
    };

    await cargo.scan(CARGO_PROJECT, { offline: true });

    expect(calls).toEqual([['metadata', '--format-version', '1', '--offline']]);
  });
});
