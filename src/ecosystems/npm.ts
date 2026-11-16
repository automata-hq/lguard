import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FS_CONCURRENCY, UNKNOWN_VERSION } from '../constants.js';
import { type Limiter, limiter } from '../limit.js';
import type { Dep, Ecosystem } from '../types.js';

interface PkgInfo extends Dep {
  deps: string[];
}

interface Installed {
  pkg: PkgInfo;
  nested: Installed[];
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
    record(await listInstalled(nodeModules, limiter(FS_CONCURRENCY)), seen, graph);

    return { deps: [...seen.values()], graph, directDeps };
  },
};

async function listInstalled(nmDir: string, io: Limiter): Promise<Installed[]> {
  const list = (dir: string) => io(() => readdir(dir)).catch(() => [] as string[]);

  const pkgDirs = (
    await Promise.all(
      (
        await list(nmDir)
      )
        .filter((entry) => !entry.startsWith('.'))
        .map(async (entry) =>
          entry.startsWith('@')
            ? (await list(join(nmDir, entry))).map((scoped) => join(nmDir, entry, scoped))
            : [join(nmDir, entry)],
        ),
    )
  ).flat();

  const installed = await Promise.all(
    pkgDirs.map(async (pkgDir): Promise<Installed | null> => {
      const pkg = await io(() => readPkg(join(pkgDir, 'package.json')));
      if (!pkg) return null;
      return { pkg, nested: await listInstalled(join(pkgDir, 'node_modules'), io) };
    }),
  );

  return installed.filter((item): item is Installed => item !== null);
}

function record(installed: Installed[], seen: Map<string, Dep>, graph: Record<string, string[]>) {
  for (const { pkg, nested } of installed) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.set(key, { name: pkg.name, version: pkg.version, license: pkg.license });
      if (!(pkg.name in graph)) graph[pkg.name] = pkg.deps;
    }
    record(nested, seen, graph);
  }
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
      version: pkg.version || UNKNOWN_VERSION,
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
