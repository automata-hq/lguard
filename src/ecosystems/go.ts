import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXEC_MAX_BUFFER } from '../constants.js';
import { runCommand } from '../exec.js';
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

  async scan(dir) {
    let stdout: string;
    try {
      ({ stdout } = await runCommand('go', ['list', '-m', '-json', 'all'], {
        cwd: dir,
        maxBuffer: EXEC_MAX_BUFFER,
      }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('go not found — install Go toolchain');
      throw new Error(`go list failed: ${(err as Error).message}`);
    }

    const modules = parseGoListOutput(stdout);

    let modCache = '';
    try {
      ({ stdout: modCache } = await runCommand('go', ['env', 'GOMODCACHE'], { cwd: dir }));
      modCache = modCache.trim();
    } catch {}

    // Build graph from go mod graph
    const { graph, directDeps } = await buildGraph(dir, modules);

    const deps: Dep[] = [];
    for (const mod of modules) {
      if (mod.Main) continue;
      const license = modCache ? await findLicense(modCache, mod.Path, mod.Version) : null;
      deps.push({ name: mod.Path, version: mod.Version || 'unknown', license });
    }

    return { deps, graph, directDeps };
  },
};

async function buildGraph(
  dir: string,
  modules: GoModule[],
): Promise<{ graph: Record<string, string[]>; directDeps: Set<string> }> {
  const graph: Record<string, string[]> = {};
  const directDeps = new Set<string>();

  try {
    const { stdout } = await runCommand('go', ['mod', 'graph'], {
      cwd: dir,
      maxBuffer: EXEC_MAX_BUFFER,
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
  let current = '';

  for (const char of stdout) {
    if (char === '{') depth++;
    if (depth > 0) current += char;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          modules.push(JSON.parse(current));
        } catch {}
        current = '';
      }
    }
  }

  return modules;
}

async function findLicense(
  modCache: string,
  modPath: string,
  version: string | undefined,
): Promise<string | null> {
  if (!version) return null;
  const modDir = join(modCache, `${modPath}@${version}`);
  const names = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENCE',
    'LICENCE.md',
    'LICENCE.txt',
    'COPYING',
    'COPYING.md',
  ];

  for (const name of names) {
    try {
      const content = await readFile(join(modDir, name), 'utf-8');
      return identifyLicense(content);
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
