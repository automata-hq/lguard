import { readFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export const cargo = {
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
    let stdout;
    try {
      ({ stdout } = await exec('cargo', ['metadata', '--format-version', '1'], {
        cwd: dir,
        maxBuffer: 50 * 1024 * 1024,
      }));
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('cargo not found — install Rust toolchain');
      throw new Error(`cargo metadata failed: ${err.message}`);
    }

    const metadata = JSON.parse(stdout);
    const rootPkgs = new Set((metadata.workspace_members || []).map(m => m.split(' ')[0]));

    // Build id-to-name map
    const idToName = {};
    for (const pkg of metadata.packages) idToName[pkg.id] = pkg.name;

    // Build graph and find direct deps from resolve
    const graph = {};
    const directDeps = new Set();

    if (metadata.resolve?.nodes) {
      for (const node of metadata.resolve.nodes) {
        const name = idToName[node.id];
        const nodeDeps = (node.deps || []).map(d => d.name || idToName[d.pkg]).filter(Boolean);
        graph[name] = nodeDeps;
        if (rootPkgs.has(name)) {
          for (const dep of nodeDeps) directDeps.add(dep);
        }
      }
    }

    const deps = metadata.packages
      .filter(pkg => !rootPkgs.has(pkg.name))
      .map(pkg => ({ name: pkg.name, version: pkg.version, license: pkg.license || null }));

    return { deps, graph, directDeps };
  },
};
