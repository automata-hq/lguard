import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export const npm = {
  name: 'npm',

  async detect(dir) {
    try {
      await readFile(join(dir, 'package.json'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir) {
    const rootPkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
    const directDeps = new Set([
      ...Object.keys(rootPkg.dependencies || {}),
      ...Object.keys(rootPkg.devDependencies || {}),
      ...Object.keys(rootPkg.optionalDependencies || {}),
      ...Object.keys(rootPkg.peerDependencies || {}),
    ]);

    const nodeModules = join(dir, 'node_modules');
    try {
      await readdir(nodeModules);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('node_modules not found — run npm/bun/pnpm install first');
      throw err;
    }

    const seen = new Map();
    const graph = {};
    await scanNodeModules(nodeModules, seen, graph);

    return { deps: [...seen.values()], graph, directDeps };
  },
};

async function scanNodeModules(nmDir, seen, graph) {
  let entries;
  try {
    entries = await readdir(nmDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    if (entry.startsWith('@')) {
      const scopedEntries = await readdir(join(nmDir, entry)).catch(() => []);
      for (const scopedEntry of scopedEntries) {
        await processPackage(join(nmDir, entry, scopedEntry), seen, graph);
      }
    } else {
      await processPackage(join(nmDir, entry), seen, graph);
    }
  }
}

async function processPackage(pkgDir, seen, graph) {
  const pkg = await readPkg(join(pkgDir, 'package.json'));
  if (!pkg) return;
  const key = `${pkg.name}@${pkg.version}`;
  if (!seen.has(key)) {
    seen.set(key, { name: pkg.name, version: pkg.version, license: pkg.license });
    if (!(pkg.name in graph)) graph[pkg.name] = pkg.deps;
  }
  await scanNodeModules(join(pkgDir, 'node_modules'), seen, graph);
}

async function readPkg(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    const pkg = JSON.parse(raw);

    let license = pkg.license;
    if (license && typeof license === 'object') license = license.type;
    if (!license && Array.isArray(pkg.licenses)) {
      license = pkg.licenses.map(l => (typeof l === 'object' ? l.type : l)).join(' OR ');
    }

    return {
      name: pkg.name,
      version: pkg.version || 'unknown',
      license: license || null,
      deps: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.optionalDependencies || {}),
      ],
    };
  } catch {
    return null;
  }
}
