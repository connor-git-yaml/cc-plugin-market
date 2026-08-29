import * as fs from 'node:fs';
import * as path from 'node:path';
// 复刻当前 writeAtomicJson（src/utils/atomic-write.ts）
function writeAtomicJson(filePath, data) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmpPath = `${resolvedPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, resolvedPath);
}
const mode = process.argv[2];
if (mode === 'symlink') {
  const realFile = path.resolve('real/settings.json');
  const link = path.resolve('proj/.claude/settings.json');
  fs.writeFileSync(realFile, JSON.stringify({ origin: 'dotfiles' }, null, 2));
  try { fs.unlinkSync(link); } catch {}
  fs.symlinkSync(realFile, link);
  console.log('BEFORE isSymlink=', fs.lstatSync(link).isSymbolicLink());
  writeAtomicJson(link, { hooks: { PreToolUse: [{ matcher: 'Glob|Grep', command: 'bash x.sh' }] } });
  console.log('AFTER  isSymlink=', fs.lstatSync(link).isSymbolicLink());
  console.log('AFTER  real-file-content=', fs.readFileSync(realFile, 'utf-8').replace(/\s+/g, ' '));
}
if (mode === 'mode') {
  const f = path.resolve('real/perm.json');
  fs.writeFileSync(f, '{}');
  fs.chmodSync(f, 0o600);
  console.log('BEFORE mode=', (fs.statSync(f).mode & 0o7777).toString(8));
  writeAtomicJson(f, { a: 1 });
  console.log('AFTER  mode=', (fs.statSync(f).mode & 0o7777).toString(8));
}
if (mode === 'tmpname') {
  const f = path.resolve('real/tmpname.json');
  console.log('TMP PATH =', `${f}.tmp`, '(固定名，与 pid 无关)');
}
