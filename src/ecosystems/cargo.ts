import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXEC_MAX_BUFFER } from '../constants.js';
import { runCommand } from '../exec.js';
import type { Ecosystem } from '../types.js';

interface CargoMetadata {
  packages: Array<{ id: string; name: string; version: string; license?: string | null }>;
  workspace_members?: string[];
  resolve?: {
    nodes?: Array<{ id: string; deps?: Array<{ name?: string; pkg: string }> }>;
  } | null;
}

export const cargo: Ecosystem = {
  name: 'cargo',

  async detect(dir) {
    try {
      await readFile(join(dir, 'Cargo.toml'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    let stdout: string;
    try {
      ({ stdout } = await runCommand('cargo', ['metadata', '--format-version', '1'], {
        cwd: dir,
        maxBuffer: EXEC_MAX_BUFFER,
      }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('cargo not found — install Rust toolchain');
      throw new Error(`cargo metadata failed: ${(err as Error).message}`);
    }

    const metadata = JSON.parse(stdout) as CargoMetadata;
    const rootPkgs = new Set((metadata.workspace_members || []).map((m) => m.split(' ')[0]));

    // Build id-to-name map
    const idToName: Record<string, string> = {};
    for (const pkg of metadata.packages) idToName[pkg.id] = pkg.name;

    // Build graph and find direct deps from resolve
    const graph: Record<string, string[]> = {};
    const directDeps = new Set<string>();

    if (metadata.resolve?.nodes) {
      for (const node of metadata.resolve.nodes) {
        const name = idToName[node.id];
        if (!name) continue;
        const nodeDeps = (node.deps || [])
          .map((d) => d.name || idToName[d.pkg])
          .filter((n): n is string => Boolean(n));
        graph[name] = nodeDeps;
        if (rootPkgs.has(name)) {
          for (const dep of nodeDeps) directDeps.add(dep);
        }
      }
    }

    const deps = metadata.packages
      .filter((pkg) => !rootPkgs.has(pkg.name))
      .map((pkg) => ({ name: pkg.name, version: pkg.version, license: pkg.license || null }));

    return { deps, graph, directDeps };
  },
};
