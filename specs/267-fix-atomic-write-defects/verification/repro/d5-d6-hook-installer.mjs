const { installClaudeHook, removeClaudeHook } = await import(process.env.REPO + '/dist/hooks/hook-installer.js');
import * as fs from 'node:fs';
import * as path from 'node:path';
const root = path.resolve('proj');
// 用户自设 0600 settings + 预置一份重要 .bak
fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
const sp = path.join(root, '.claude/settings.json');
fs.writeFileSync(sp, JSON.stringify({ mine: 'important' }, null, 2));
fs.chmodSync(sp, 0o600);
fs.writeFileSync(sp + '.bak', JSON.stringify({ precious: 'earlier-backup' }, null, 2));
// 用户自设 0700 的 hook 脚本
const hooksDir = path.join(root, 'specs/_meta/hooks');
fs.mkdirSync(hooksDir, { recursive: true });
const script = path.join(hooksDir, 'spectra-context.sh');
fs.writeFileSync(script, '#!/bin/bash\nexit 0\n');
fs.chmodSync(script, 0o700);
console.log('BEFORE settings mode=', (fs.statSync(sp).mode & 0o7777).toString(8));
console.log('BEFORE script   mode=', (fs.statSync(script).mode & 0o7777).toString(8));
console.log('BEFORE .bak content=', fs.readFileSync(sp + '.bak', 'utf-8').replace(/\s+/g,' '));
installClaudeHook(root);
console.log('AFTER  settings mode=', (fs.statSync(sp).mode & 0o7777).toString(8));
console.log('AFTER  script   mode=', (fs.statSync(script).mode & 0o7777).toString(8));
console.log('AFTER  .bak content=', fs.readFileSync(sp + '.bak', 'utf-8').replace(/\s+/g,' '));
// remove 是否备份
fs.rmSync(sp + '.bak');
removeClaudeHook(root);
console.log('AFTER remove: .bak exists=', fs.existsSync(sp + '.bak'));
console.log('AFTER remove: settings mode=', (fs.statSync(sp).mode & 0o7777).toString(8));
