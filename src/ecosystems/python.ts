import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FETCH_BATCH_SIZE, FETCH_TIMEOUT_MS } from '../constants.js';
import type { Dep, Ecosystem } from '../types.js';

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export const python: Ecosystem = {
  name: 'python',

  async detect(dir) {
    for (const marker of ['requirements.txt', 'Pipfile.lock', 'pyproject.toml']) {
      try {
        await readFile(join(dir, marker));
        return true;
      } catch {}
    }
    return false;
  },

  async scan(dir) {
    const packages = new Map<string, string>();

    await parseRequirements(join(dir, 'requirements.txt'), packages);
    await parsePipfileLock(join(dir, 'Pipfile.lock'), packages);
    await parsePyproject(join(dir, 'pyproject.toml'), packages);

    if (packages.size === 0) throw new Error('No Python dependencies found');

    const resolved = await resolveLocal(dir, packages);

    const unresolved = [...packages.keys()].filter((name) => !resolved.has(name));
    if (unresolved.length > 0) {
      const fetched = await fetchFromPyPI(unresolved);
      for (const dep of fetched) resolved.set(normalizeName(dep.name), dep);
    }

    const deps = [...resolved.values()];
    // Python: all declared packages are considered direct, no graph available
    const directDeps = new Set(packages.keys());
    return { deps, graph: {}, directDeps };
  },
};

async function parseRequirements(path: string, packages: Map<string, string>): Promise<void> {
  try {
    const content = await readFile(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('-') ||
        /^(https?:|git[+@])/.test(trimmed)
      )
        continue;
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)/);
      if (match?.[1]) packages.set(normalizeName(match[1]), 'latest');
    }
  } catch {}
}

interface PipfileLock {
  default?: Record<string, { version?: string }>;
  develop?: Record<string, { version?: string }>;
}

async function parsePipfileLock(path: string, packages: Map<string, string>): Promise<void> {
  try {
    const content = JSON.parse(await readFile(path, 'utf-8')) as PipfileLock;
    for (const section of ['default', 'develop'] as const) {
      const entries = content[section];
      if (!entries || typeof entries !== 'object') continue;
      for (const [name, info] of Object.entries(entries)) {
        packages.set(normalizeName(name), info.version?.replace('==', '') || 'latest');
      }
    }
  } catch {}
}

async function parsePyproject(path: string, packages: Map<string, string>): Promise<void> {
  try {
    const content = await readFile(path, 'utf-8');
    const depMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depMatch?.[1]) {
      const deps = depMatch[1].match(/"([^"]+)"/g) || [];
      for (const dep of deps) {
        const match = dep.replace(/"/g, '').match(/^([a-zA-Z0-9._-]+)/);
        if (match?.[1]) packages.set(normalizeName(match[1]), 'latest');
      }
    }
  } catch {}
}

async function resolveLocal(dir: string, packages: Map<string, string>): Promise<Map<string, Dep>> {
  const resolved = new Map<string, Dep>();
  const venvPaths = [join(dir, '.venv', 'lib'), join(dir, 'venv', 'lib'), join(dir, 'env', 'lib')];

  for (const venvLib of venvPaths) {
    try {
      const pythonDirs = await readdir(venvLib);
      for (const pyDir of pythonDirs) {
        if (!pyDir.startsWith('python')) continue;
        const sitePackages = join(venvLib, pyDir, 'site-packages');
        try {
          const entries = await readdir(sitePackages);
          for (const entry of entries) {
            if (!entry.endsWith('.dist-info')) continue;
            try {
              const metadata = await readFile(join(sitePackages, entry, 'METADATA'), 'utf-8');
              const nameMatch = metadata.match(/^Name:\s*(.+)/m);
              const versionMatch = metadata.match(/^Version:\s*(.+)/m);
              const licenseMatch = metadata.match(/^License:\s*(.+)/m);
              if (nameMatch?.[1]) {
                const normalized = normalizeName(nameMatch[1].trim());
                if (packages.has(normalized)) {
                  resolved.set(normalized, {
                    name: nameMatch[1].trim(),
                    version: versionMatch?.[1]?.trim() || 'unknown',
                    license: licenseMatch?.[1]?.trim() || null,
                  });
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  return resolved;
}

interface PyPIResponse {
  info?: { name?: string; version?: string; license?: string | null };
}

async function fetchFromPyPI(names: string[]): Promise<Dep[]> {
  const results: Dep[] = [];

  for (let i = 0; i < names.length; i += FETCH_BATCH_SIZE) {
    const batch = names.slice(i, i + FETCH_BATCH_SIZE);
    const promises = batch.map(async (name): Promise<Dep> => {
      try {
        const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return { name, version: 'unknown', license: null };
        const data = (await res.json()) as PyPIResponse;
        let license = data.info?.license || null;
        if (license && license.length > 100) license = null;
        return { name: data.info?.name || name, version: data.info?.version || 'unknown', license };
      } catch {
        return { name, version: 'unknown', license: null };
      }
    });
    results.push(...(await Promise.all(promises)));
  }

  return results;
}
