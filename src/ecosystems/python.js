import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const FETCH_TIMEOUT = 10_000;

function normalizeName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export const python = {
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
    const packages = new Map();

    await parseRequirements(join(dir, 'requirements.txt'), packages);
    await parsePipfileLock(join(dir, 'Pipfile.lock'), packages);
    await parsePyproject(join(dir, 'pyproject.toml'), packages);

    if (packages.size === 0) throw new Error('No Python dependencies found');

    const resolved = await resolveLocal(dir, packages);

    const unresolved = [...packages.keys()].filter(name => !resolved.has(name));
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

async function parseRequirements(path, packages) {
  try {
    const content = await readFile(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || /^(https?:|git[+@])/.test(trimmed)) continue;
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)/);
      if (match) packages.set(normalizeName(match[1]), 'latest');
    }
  } catch {}
}

async function parsePipfileLock(path, packages) {
  try {
    const content = JSON.parse(await readFile(path, 'utf-8'));
    for (const section of ['default', 'develop']) {
      if (!content[section] || typeof content[section] !== 'object') continue;
      for (const [name, info] of Object.entries(content[section])) {
        packages.set(normalizeName(name), info.version?.replace('==', '') || 'latest');
      }
    }
  } catch {}
}

async function parsePyproject(path, packages) {
  try {
    const content = await readFile(path, 'utf-8');
    const depMatch = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depMatch) {
      const deps = depMatch[1].match(/"([^"]+)"/g) || [];
      for (const dep of deps) {
        const match = dep.replace(/"/g, '').match(/^([a-zA-Z0-9._-]+)/);
        if (match) packages.set(normalizeName(match[1]), 'latest');
      }
    }
  } catch {}
}

async function resolveLocal(dir, packages) {
  const resolved = new Map();
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
              if (nameMatch) {
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

async function fetchFromPyPI(names) {
  const results = [];
  const BATCH = 10;

  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const promises = batch.map(async name => {
      try {
        const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (!res.ok) return { name, version: 'unknown', license: null };
        const data = await res.json();
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
