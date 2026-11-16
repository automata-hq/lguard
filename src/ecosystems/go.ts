import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXEC_MAX_BUFFER, FS_CONCURRENCY, GO_OFFLINE_ENV, UNKNOWN_VERSION } from '../constants.js';
import { runCommand } from '../exec.js';
import { mapLimit } from '../limit.js';
import type { Dep, Ecosystem } from '../types.js';

interface GoModule {
  Path: string;
  Version?: string;
  Main?: boolean;
}

export const go: Ecosystem = {
  name: 'go',

  async detect(dir) {
    try {
      await readFile(join(dir, 'go.mod'));
      return true;
    } catch {
      return false;
    }
  },

  async scan(dir, context) {
    const env = context?.offline ? { ...process.env, ...GO_OFFLINE_ENV } : undefined;
    const withEnv = env ? { env } : {};
    let stdout: string;
    try {
      ({ stdout } = await runCommand('go', ['list', '-m', '-json', 'all'], {
        cwd: dir,
        maxBuffer: EXEC_MAX_BUFFER,
        ...withEnv,
      }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('go not found — install Go toolchain');
      throw new Error(`go list failed: ${(err as Error).message}`);
    }

    const modules = parseGoListOutput(stdout);

    let modCache = '';
    try {
      ({ stdout: modCache } = await runCommand('go', ['env', 'GOMODCACHE'], {
        cwd: dir,
        ...withEnv,
      }));
      modCache = modCache.trim();
    } catch {}

    // Build graph from go mod graph
    const { graph, directDeps } = await buildGraph(dir, modules, env);

    const deps = await mapLimit(
      modules.filter((mod) => !mod.Main),
      FS_CONCURRENCY,
      async (mod): Promise<Dep> => ({
        name: mod.Path,
        version: mod.Version || UNKNOWN_VERSION,
        license: modCache ? await findLicense(modCache, mod.Path, mod.Version) : null,
      }),
    );

    return { deps, graph, directDeps };
  },
};

async function buildGraph(
  dir: string,
  modules: GoModule[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<{ graph: Record<string, string[]>; directDeps: Set<string> }> {
  const graph: Record<string, string[]> = {};
  const directDeps = new Set<string>();

  try {
    const { stdout } = await runCommand('go', ['mod', 'graph'], {
      cwd: dir,
      maxBuffer: EXEC_MAX_BUFFER,
      ...(env ? { env } : {}),
    });

    let mainModule: string | null = null;
    const graphSets: Record<string, Set<string>> = {};
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [from = '', to = ''] = line.split(' ');
      const fromName = from.split('@')[0] ?? from;
      const toName = to.split('@')[0] ?? to;

      if (!mainModule && !from.includes('@')) mainModule = fromName;

      const entry = graphSets[fromName] ?? new Set<string>();
      graphSets[fromName] = entry;
      entry.add(toName);
    }

    for (const [key, val] of Object.entries(graphSets)) {
      graph[key] = [...val];
    }

    const mainDeps = mainModule ? graph[mainModule] : undefined;
    if (mainDeps) {
      for (const dep of mainDeps) directDeps.add(dep);
    }
  } catch {
    // go mod graph might fail — fall back to marking all as direct
    for (const mod of modules) {
      if (!mod.Main) directDeps.add(mod.Path);
    }
  }

  return { graph, directDeps };
}

function parseGoListOutput(stdout: string): GoModule[] {
  const modules: GoModule[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < stdout.length; i++) {
    const char = stdout[i];
    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        try {
          modules.push(JSON.parse(stdout.slice(start, i + 1)));
        } catch {}
      }
    }
  }

  return modules;
}

const LICENSE_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
];

async function findLicense(
  modCache: string,
  modPath: string,
  version: string | undefined,
): Promise<string | null> {
  if (!version) return null;
  const modDir = join(modCache, `${modPath}@${version}`);
  const files = new Set(await readdir(modDir).catch(() => [] as string[]));

  for (const name of LICENSE_FILES) {
    if (!files.has(name)) continue;
    try {
      return identifyLicense(await readFile(join(modDir, name), 'utf-8'));
    } catch {}
  }

  return null;
}

function identifyLicense(content: string): string | null {
  const t = content.toLowerCase();
  if (t.includes('gnu affero general public license')) return 'AGPL-3.0';
  if (t.includes('gnu lesser general public license') && t.includes('version 3')) return 'LGPL-3.0';
  if (t.includes('gnu lesser general public license') && t.includes('version 2')) return 'LGPL-2.1';
  if (t.includes('gnu lesser general public license')) return 'LGPL-2.1';
  if (t.includes('gnu general public license') && t.includes('version 3')) return 'GPL-3.0';
  if (t.includes('gnu general public license') && t.includes('version 2')) return 'GPL-2.0';
  if (t.includes('mozilla public license') && t.includes('2.0')) return 'MPL-2.0';
  if (t.includes('eclipse public license') && t.includes('2.0')) return 'EPL-2.0';
  if (t.includes('eclipse public license') && t.includes('1.0')) return 'EPL-1.0';
  if (t.includes('apache license') && t.includes('version 2.0')) return 'Apache-2.0';
  if (t.includes('mit license') || t.includes('permission is hereby granted, free of charge'))
    return 'MIT';
  if (t.includes('isc license')) return 'ISC';
  if (
    t.includes('redistribution and use in source and binary forms') &&
    t.includes('3. neither the name')
  )
    return 'BSD-3-Clause';
  if (t.includes('redistribution and use in source and binary forms')) return 'BSD-2-Clause';
  if (t.includes('the unlicense') || t.includes('this is free and unencumbered software'))
    return 'Unlicense';
  if (t.includes('boost software license')) return 'BSL-1.0';
  if (t.includes('creative commons') && t.includes('cc0')) return 'CC0-1.0';
  if (t.includes('do what the fuck you want')) return 'WTFPL';
  return null;
}
