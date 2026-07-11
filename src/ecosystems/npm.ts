import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dep, Ecosystem } from '../types.js';

interface PkgInfo extends Dep {
  deps: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<string | { type?: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export const npm: Ecosystem = {
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
    const rootPkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8')) as PackageJson;
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
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('node_modules not found — run npm/bun/pnpm install first');
      throw err;
    }

    const seen = new Map<string, Dep>();
    const graph: Record<string, string[]> = {};
    await scanNodeModules(nodeModules, seen, graph);

    return { deps: [...seen.values()], graph, directDeps };
  },
};

async function scanNodeModules(
  nmDir: string,
  seen: Map<string, Dep>,
  graph: Record<string, string[]>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(nmDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    if (entry.startsWith('@')) {
      const scopedEntries = await readdir(join(nmDir, entry)).catch(() => [] as string[]);
      for (const scopedEntry of scopedEntries) {
        await processPackage(join(nmDir, entry, scopedEntry), seen, graph);
      }
    } else {
      await processPackage(join(nmDir, entry), seen, graph);
    }
  }
}

async function processPackage(
  pkgDir: string,
  seen: Map<string, Dep>,
  graph: Record<string, string[]>,
): Promise<void> {
  const pkg = await readPkg(join(pkgDir, 'package.json'));
  if (!pkg) return;
  const key = `${pkg.name}@${pkg.version}`;
  if (!seen.has(key)) {
    seen.set(key, { name: pkg.name, version: pkg.version, license: pkg.license });
    if (!(pkg.name in graph)) graph[pkg.name] = pkg.deps;
  }
  await scanNodeModules(join(pkgDir, 'node_modules'), seen, graph);
}

async function readPkg(path: string): Promise<PkgInfo | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const pkg = JSON.parse(raw) as PackageJson;

    let license = pkg.license;
    if (license && typeof license === 'object') license = license.type;
    if (!license && Array.isArray(pkg.licenses)) {
      license = pkg.licenses.map((l) => (typeof l === 'object' ? l.type : l)).join(' OR ');
    }

    return {
      // Quirk preserved from 0.3.1: a nameless package.json (never produced by
      // real installers) flows through as undefined and its JSON entry omits
      // the name key. No fallback is applied, unlike version below.
      name: pkg.name as string,
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
