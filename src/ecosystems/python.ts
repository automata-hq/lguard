import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FETCH_CONCURRENCY,
  FETCH_TIMEOUT_MS,
  FS_CONCURRENCY,
  UNKNOWN_VERSION,
} from '../constants.js';
import { limiter, mapLimit } from '../limit.js';
import type { Dep, Ecosystem } from '../types.js';

const LATEST = 'latest';

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

  async scan(dir, context) {
    const packages = new Map<string, string>();

    await parseRequirements(join(dir, 'requirements.txt'), packages);
    await parsePipfileLock(join(dir, 'Pipfile.lock'), packages);
    await parsePyproject(join(dir, 'pyproject.toml'), packages);

    if (packages.size === 0) throw new Error('No Python dependencies found');

    const resolved = await resolveLocal(dir, packages);

    const unresolved = [...packages.keys()].filter((name) => !resolved.has(name));
    if (unresolved.length > 0 && context?.offline) {
      for (const name of unresolved)
        resolved.set(name, unresolvedOffline(name, packages.get(name)));
    } else if (unresolved.length > 0) {
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
      if (match?.[1]) packages.set(normalizeName(match[1]), LATEST);
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
        packages.set(normalizeName(name), info.version?.replace('==', '') || LATEST);
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
        if (match?.[1]) packages.set(normalizeName(match[1]), LATEST);
      }
    }
  } catch {}
}

async function resolveLocal(dir: string, packages: Map<string, string>): Promise<Map<string, Dep>> {
  const resolved = new Map<string, Dep>();
  const venvPaths = [join(dir, '.venv', 'lib'), join(dir, 'venv', 'lib'), join(dir, 'env', 'lib')];
  const io = limiter(FS_CONCURRENCY);
  const list = (path: string) => io(() => readdir(path)).catch(() => [] as string[]);

  const sitePackages = (
    await Promise.all(
      venvPaths.map(async (venvLib) =>
        (
          await list(venvLib)
        )
          .filter((pyDir) => pyDir.startsWith('python'))
          .map((pyDir) => join(venvLib, pyDir, 'site-packages')),
      ),
    )
  ).flat();

  const metadataFiles = (
    await Promise.all(
      sitePackages.map(async (site) =>
        (
          await list(site)
        )
          .filter((entry) => entry.endsWith('.dist-info'))
          .map((entry) => join(site, entry, 'METADATA')),
      ),
    )
  ).flat();

  const metadata = await Promise.all(
    metadataFiles.map((path) => io(() => readFile(path, 'utf-8')).catch(() => null)),
  );

  for (const text of metadata) {
    const name = text?.match(/^Name:\s*(.+)/m)?.[1]?.trim();
    if (!text || !name) continue;
    const normalized = normalizeName(name);
    if (!packages.has(normalized)) continue;
    resolved.set(normalized, {
      name,
      version: text.match(/^Version:\s*(.+)/m)?.[1]?.trim() || UNKNOWN_VERSION,
      license: text.match(/^License:\s*(.+)/m)?.[1]?.trim() || null,
    });
  }

  return resolved;
}

function unresolvedOffline(name: string, declared: string | undefined): Dep {
  const version = declared === undefined || declared === LATEST ? UNKNOWN_VERSION : declared;

  return { name, version, license: null };
}

interface PyPIResponse {
  info?: { name?: string; version?: string; license?: string | null };
}

const MAX_LICENSE_LENGTH = 100;

function fetchFromPyPI(names: string[]): Promise<Dep[]> {
  return mapLimit(names, FETCH_CONCURRENCY, async (name): Promise<Dep> => {
    try {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { name, version: UNKNOWN_VERSION, license: null };
      const data = (await res.json()) as PyPIResponse;
      let license = data.info?.license || null;
      if (license && license.length > MAX_LICENSE_LENGTH) license = null;
      return {
        name: data.info?.name || name,
        version: data.info?.version || UNKNOWN_VERSION,
        license,
      };
    } catch {
      return { name, version: UNKNOWN_VERSION, license: null };
    }
  });
}
