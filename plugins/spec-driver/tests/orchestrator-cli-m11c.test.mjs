/**
 * orchestrator-cli-m11c.test.mjs
 * M11 卡 C（簇④ 引擎 / CLI 小补合集）· orchestrator-cli 两项小补的守护：
 *   C1  get-phases 输出必须带 gates_before / gates_after（此前被 map 投影丢掉，编排器看不到门挂在哪个 phase）
 *   C6  generate-template 吐出的 phase id 必须是带引号的字符串（`0.5` 曾被序列化成数字，存成 override 即 schema-fallback）
 *
 * 运行方式: node --test plugins/spec-driver/tests/orchestrator-cli-m11c.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs';
import { yamlScalar } from '../lib/orchestration-output-serializer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'scripts', 'orchestrator-cli.mjs');
const BASE_YAML_PATH = path.join(__dirname, '..', 'config', 'orchestration.yaml');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { cwd, encoding: 'utf-8' });
}

function makeEmptyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-m11c-'));
  fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
  return dir;
}

/** base yaml 里每个 mode 的 phase → { gates_before, gates_after }（独立于 CLI 的取数路径） */
function readBaseGateMounts(mode) {
  const base = parseYamlDocument(fs.readFileSync(BASE_YAML_PATH, 'utf-8'));
  return new Map(base.modes[mode].phases.map((p) => [String(p.id), {
    gates_before: p.gates_before ?? null,
    gates_after: p.gates_after ?? null,
  }]));
}

describe('C1 get-phases 输出携带门挂载字段', () => {
  it('feature 模式：每个 phase 都有 gates_before / gates_after 键，且与 base yaml 逐 phase 一致', () => {
    const cwd = makeEmptyProject();
    const res = runCli(['get-phases', 'feature', '--project-root', cwd], cwd);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.success, true);
    const expected = readBaseGateMounts('feature');
    assert.equal(out.phases.length, expected.size);
    for (const phase of out.phases) {
      assert.ok(Object.hasOwn(phase, 'gates_before'), `phase ${phase.id} 缺 gates_before`);
      assert.ok(Object.hasOwn(phase, 'gates_after'), `phase ${phase.id} 缺 gates_after`);
      assert.deepEqual(
        { gates_before: phase.gates_before, gates_after: phase.gates_after },
        expected.get(String(phase.id)),
        `phase ${phase.id} 的门挂载与 base yaml 不一致`,
      );
    }
  });

  it('feature 模式至少有一个 phase 真的挂了 GATE_DESIGN（防「键在但全 null」的空守护）', () => {
    const cwd = makeEmptyProject();
    const out = JSON.parse(runCli(['get-phases', 'feature', '--project-root', cwd], cwd).stdout);
    const mounted = out.phases.filter((p) =>
      [...(p.gates_before || []), ...(p.gates_after || [])].includes('GATE_DESIGN'));
    assert.ok(mounted.length >= 1, 'feature 模式应有 phase 挂载 GATE_DESIGN');
  });

  it('没有门的 phase 输出 null 而不是 undefined / 缺键（JSON 消费方按键存在性判断）', () => {
    const cwd = makeEmptyProject();
    const out = JSON.parse(runCli(['get-phases', 'fix', '--project-root', cwd], cwd).stdout);
    const bare = out.phases.find((p) => p.gates_before === null && p.gates_after === null);
    assert.ok(bare, 'fix 模式应存在无门 phase，且两键显式为 null');
  });
});

describe('C6 generate-template phase id 字符串化', () => {
  it('yamlScalar 对小数形态 / 前导零 / 指数形态的字符串都加引号（解析回来仍是 string）', () => {
    for (const s of ['0.5', '3.5', '007', '1e3', '.5', '5.', '-1', '+1', '0x1f', 'yes', 'no', 'on', 'off', '~', 'Null', 'TRUE']) {
      const emitted = yamlScalar(s);
      const parsed = parseYamlDocument(`v: ${emitted}`).v;
      assert.equal(typeof parsed, 'string', `yamlScalar(${JSON.stringify(s)}) 输出 ${emitted}，解析回来不是 string`);
      assert.equal(parsed, s);
    }
  });

  it('yamlScalar 对真正的数字仍不加引号（不把 number 变成 string）', () => {
    assert.equal(yamlScalar(0.5), '0.5');
    assert.equal(yamlScalar(7), '7');
    assert.equal(parseYamlDocument(`v: ${yamlScalar(0.5)}`).v, 0.5);
  });

  it('feature 模板全部 phase id 解析回来都是 string，与 base yaml 的 id 逐一相等', () => {
    const cwd = makeEmptyProject();
    const res = runCli(['generate-template', 'feature'], cwd);
    assert.equal(res.status, 0, res.stderr);
    const doc = parseYamlDocument(res.stdout);
    const ids = doc.modes.feature.phases.map((p) => p.id);
    const baseIds = parseYamlDocument(fs.readFileSync(BASE_YAML_PATH, 'utf-8')).modes.feature.phases.map((p) => p.id);
    assert.deepEqual(ids, baseIds);
    for (const id of ids) assert.equal(typeof id, 'string', `phase id ${id} 不是 string`);
  });

  it('模板原样存为 override 后，resolver 不再报 schema-fallback（feature 含 0.5 / 3.5 / 5.5 / 6.5）', () => {
    const cwd = makeEmptyProject();
    const template = runCli(['generate-template', 'feature'], cwd).stdout;
    fs.writeFileSync(path.join(cwd, '.specify', 'orchestration-overrides.yaml'), template);
    const res = runCli(['effective-orchestration', 'feature', '--format', 'json', '--project-root', cwd], cwd);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    const fallback = (out.diagnostics || []).filter((d) => d.code === 'orchestration-overrides.schema-fallback');
    assert.deepEqual(fallback, [], `模板回灌触发 schema-fallback: ${JSON.stringify(fallback)}`);
  });
});

// ════════════════════════════════════════
// M11 卡 C · 对抗审查（CLI / 序列化半）后的回归钉：W-1 / W-2 / W-3 yamlScalar 两个方向按**输出文本**断言；W-5 get-phases 带 diagnostics
// ════════════════════════════════════════
describe('yamlScalar 漏引 / 过度引两个方向（对抗审查 W-1 / W-2 / W-3）', () => {
  it('会被标准 YAML 读成非 string 的 22 种形态输出文本一律带双引号（不依赖 simple-yaml 的强制转换面当 oracle）', () => {
    const forms = ['0.5', '3.5', '007', '-1', '1e3', '.5', '5.', '+1', '0x1f', '0o17', '0b1010', '0B1_0', '1_000', 'yes', 'no', 'on', 'off', '~', 'Null', 'TRUE', '.inf', '.NaN', '2001-01-01', '2001-12-14t21:59:43.10-05:00', '2002-12-14 21:59'];
    for (const s of forms) {
      const emitted = yamlScalar(s);
      assert.ok(emitted.startsWith('"') && emitted.endsWith('"'), `yamlScalar(${JSON.stringify(s)}) 输出 ${emitted}，应带引号`);
      assert.equal(parseYamlDocument(`v: ${emitted}`).v, s);
    }
  });
  it('普通标识符 / 版本样式 / 单独的符号不加引号（判据恒真的过度引会在这里红）', () => {
    for (const s of ['feature', 'spec-review', 'implement_x', 'v1', '1a', 'a1', 'phase0.5x', 'e5', '-', '+', '.', 'x-1', 'GATE_DESIGN', '零']) {
      assert.equal(yamlScalar(s), s, `yamlScalar(${JSON.stringify(s)}) 不应加引号`);
    }
  });
  it('锚点：形态只在整串匹配时才加引号（`1e3x` / `x0.5` 是普通字符串）', () => {
    assert.equal(yamlScalar('1e3x'), '1e3x');
    assert.equal(yamlScalar('x0.5'), 'x0.5');
    assert.equal(yamlScalar('yes-no'), 'yes-no');
  });
});

describe('get-phases 带 resolver diagnostics（对抗审查 W-5）', () => {
  it('无 overrides 的项目 diagnostics 为空数组；overrides 抽掉 feature 的 GATE_DESIGN 被整份回退时 diagnostics 含 gate-mounting-lost 且 gates_* 仍是 base 的挂载', () => {
    const cwd = makeEmptyProject();
    const clean = runCli(['get-phases', 'feature', '--project-root', cwd], cwd);
    assert.equal(clean.status, 0, clean.stderr);
    assert.deepEqual(JSON.parse(clean.stdout).diagnostics, []);

    const tpl = runCli(['generate-template', 'feature'], cwd);
    assert.equal(tpl.status, 0, tpl.stderr);
    // 把模板里所有 GATE_DESIGN 挂载换成别的门再存成 override（数组仍合法，不落 schema-fallback）⇒ 强制 mode 失去 GATE_DESIGN 挂载 ⇒ resolver 整份回退 base
    const stripped = tpl.stdout.replace(/GATE_DESIGN/g, 'GATE_VERIFY');
    fs.mkdirSync(path.join(cwd, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.specify', 'orchestration-overrides.yaml'), stripped);
    const res = runCli(['get-phases', 'feature', '--project-root', cwd], cwd);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.ok(out.diagnostics.some((d) => d.code === 'orchestration-overrides.gate-mounting-lost'), JSON.stringify(out.diagnostics));
    const mounts = out.phases.flatMap((p) => [...(p.gates_before || []), ...(p.gates_after || [])]);
    assert.ok(mounts.includes('GATE_DESIGN'), 'override 被回退 ⇒ 输出的是 base 的门挂载');
  });
});
