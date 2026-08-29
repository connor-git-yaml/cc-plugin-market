const { runDoctor } = await import(process.env.REPO + '/plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs');
import * as path from 'node:path';
const r = runDoctor({ projectRoot: path.resolve('.'), codexHome: path.resolve('home'), exec: () => ({ kind: 'error', errorClass: 'ENOENT' }) });
const c = r.checks['plugin-build.spec-driver'];
const probe = (c.details.probedSources ?? []).find(p => p.id === 'codex-plugin-manifest');
console.log('  codex-plugin-manifest probe =', JSON.stringify(probe));
console.log('  activeInstallPath =', JSON.stringify(c.details.activeInstallPath ?? null));
console.log('  status =', c.status);
