import { ecosystems } from './ecosystems/index.js';
import { classifyExpression } from './licenses.js';

export async function scanProject(targetPath, options = {}) {
  const detected = [];

  if (options.ecosystem) {
    const eco = ecosystems.find(e => e.name === options.ecosystem);
    if (!eco) throw new Error(`Unknown ecosystem: ${options.ecosystem}. Supported: ${ecosystems.map(e => e.name).join(', ')}`);
    detected.push(eco);
  } else {
    for (const eco of ecosystems) {
      if (await eco.detect(targetPath)) detected.push(eco);
    }
  }

  if (detected.length === 0) {
    throw new Error('No supported package ecosystem detected. Supported: ' + ecosystems.map(e => e.name).join(', '));
  }

  const allDeps = [];
  const ignoreSet = new Set(options.ignore || []);

  for (const eco of detected) {
    try {
      const deps = await eco.scan(targetPath);
      for (const dep of deps) {
        if (ignoreSet.has(dep.name)) continue;
        const { risk } = classifyExpression(dep.license);
        allDeps.push({ ...dep, risk, ecosystem: eco.name });
      }
    } catch (err) {
      console.error(`Warning: ${eco.name} scan failed — ${err.message}`);
    }
  }

  const summary = { total: allDeps.length, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const dep of allDeps) summary[dep.risk]++;

  return { path: targetPath, ecosystems: detected.map(e => e.name), dependencies: allDeps, summary };
}
