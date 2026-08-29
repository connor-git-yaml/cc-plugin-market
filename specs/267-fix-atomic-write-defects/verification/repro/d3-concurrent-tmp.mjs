import * as fs from 'node:fs';
import * as path from 'node:path';
function writeAtomicJson(filePath, data) {
  const p = path.resolve(filePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmpPath = `${p}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, p);
}
const tag = process.argv[2];
const target = path.resolve('real/race.json');
// 大 payload：让 writeFileSync 跨多次 write(2)，制造互截窗口
const payload = { who: tag, pad: Array.from({ length: 200000 }, () => tag) };
let errs = 0, mixed = 0;
for (let i = 0; i < 40; i++) {
  try { writeAtomicJson(target, payload); }
  catch (e) { errs++; console.log(`${tag} WRITE-ERR ${e.code}`); }
  try {
    const t = fs.readFileSync(target, 'utf-8');
    JSON.parse(t);
    if (t.includes('"A"') && t.includes('"B"')) { mixed++; console.log(`${tag} MIXED-CONTENT`); }
  } catch (e) { console.log(`${tag} READBACK-CORRUPT ${e.message.slice(0,60)}`); mixed++; }
}
console.log(`${tag} done errs=${errs} corrupt/mixed=${mixed}`);
