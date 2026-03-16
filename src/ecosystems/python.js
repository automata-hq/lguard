import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

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

    // Try local venv metadata first
    const resolved = await resolveLocal(dir, packages);

    // Fetch remaining from PyPI
    const unresolved = [...packages.keys()].filter(name => !resolved.has(name));
    if (unresolved.length > 0) {
      const fetched = await fetchFromPyPI(unresolved);
      for (const dep of fetched) resolved.set(dep.name.toLowerCase(), dep);
    }

    return [...resolved.values()];
  },
};

async function parseRequirements(path, packages) {
  try {
    const content = await readFile(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)/);
      if (match) packages.set(match[1].toLowerCase(), 'latest');
    }
  } catch {}
}

async function parsePipfileLock(path, packages) {
  try {
    const content = JSON.parse(await readFile(path, 'utf-8'));
    for (const section of ['default', 'develop']) {
      if (!content[section]) continue;
      for (const [name, info] of Object.entries(content[section])) {
        packages.set(name.toLowerCase(), info.version?.replace('==', '') || 'latest');
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
        if (match) packages.set(match[1].toLowerCase(), 'latest');
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
                const name = nameMatch[1].trim().toLowerCase();
                if (packages.has(name)) {
                  resolved.set(name, {
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
        const res = await fetch(`https://pypi.org/pypi/${name}/json`);
        if (!res.ok) return { name, version: 'unknown', license: null };
        const data = await res.json();
        let license = data.info.license || null;
        // PyPI sometimes has very long license text instead of SPDX ID — skip those
        if (license && license.length > 100) license = null;
        return { name: data.info.name || name, version: data.info.version || 'unknown', license };
      } catch {
        return { name, version: 'unknown', license: null };
      }
    });
    results.push(...(await Promise.all(promises)));
  }

  return results;
}
