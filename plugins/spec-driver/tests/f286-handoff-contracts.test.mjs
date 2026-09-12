/**
 * F286 — P1-K / F277 移交承接的 prompt 层合同守护。对抗复审 B-W5 后改为**段落级**断言：取出目标章节正文、
 * 断言不在 HTML 注释里、关键句逐字存在且不含削弱词（建议 / 可豁免 / MAY / 可选）、SKILL 的派发前置段位于派发 Task 行之前、
 * artifact 合同的章节行不是注释行、插件模板与项目级模板逐字节相同（B-C2：项目级模板遮蔽插件模板）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(PLUGIN, '..', '..');
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, '');
/** 取 markdown 章节正文：从 `heading` 行到下一个同级或更高级标题。 */
function section(text, heading) {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, `章节缺席：${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(at + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}
const WEAKENERS = /建议(?!项)|可豁免|\bMAY\b|可选(?!章节)/;
/** 把换行 / 缩进折成单空格，供跨行句子的逐字断言 */
const flat = (text) => text.replace(/\s+/g, ' ');

describe('F286 · verify.md 承接 FR-010~013 与向后兼容类 SC 模板（段落级）', () => {
  const v = stripHtmlComments(read('agents/verify.md'));
  const l185 = section(v, '### Layer 1.85: 新增导出符号生产可达性');
  it('Layer 1.85：适用范围首句 / baseRef 唯一来源 = evidence-pack 首行 / 禁自行现推与默认 HEAD / 三支处置各带落点 / 未处置即 NEEDS FIX / 固定口径随行；无削弱词', () => {
    assert.ok(l185.includes('**适用范围**：feature / story / implement 模式**强制**'));
    assert.ok(l185.includes('scripts/export-reachability.mjs --project-root . --base <baseRef>'));
    assert.ok(l185.includes('`{feature_dir}/verification/evidence-pack.md` **首行** `baseRef:`'));
    assert.ok(l185.includes('**禁止自行现推、禁止默认为 `HEAD`**'));
    assert.ok(l185.includes('evidence-pack 缺席或无 `baseRef:` 行 ⇒ 本检查计「未执行（缺席）」'));
    assert.ok(!l185.includes('冻结字段记录的 commit sha'), 'B-C1：不得再引用 tasks.md 冻结字段（可选、注入块里没有）');
    assert.match(l185, /接线遗漏 → 指向本次补上的接线位置/);
    assert.match(l185, /有意的预留 → \*\*必须同时\*\*在 `tasks\.md` 派生一条归属明确 Phase 的延期承诺任务/);
    assert.match(l185, /应删除 → 指向删除动作/);
    assert.ok(l185.includes('任一报警未处置 ⇒ 合并律判不通过（NEEDS FIX）'));
    assert.ok(l185.includes('本检查仅拦无意遗漏，不拦有意规避'));
    assert.ok(l185.includes('import / re-export 行（含多行 `import {…} from` 块）不算使用'));
    assert.ok(!WEAKENERS.test(l185), `Layer 1.85 含削弱词：${l185.match(WEAKENERS)?.[0]}`);
  });
  it('Layer 1.86：先读 red-first-evidence.md / 禁钉绝对值快照 / 同时刻 A/B / 新测试 × 旧实现替代证明', () => {
    const l186 = section(v, '### Layer 1.86: 向后兼容 / 逐字节不变类 SC 的验证手段');
    assert.ok(l186.includes('**先读 `{feature_dir}/verification/red-first-evidence.md`**'));
    assert.ok(l186.includes('禁止钉死绝对值快照'));
    assert.ok(l186.includes('必用同时刻 A/B'));
    assert.ok(l186.includes('新测试 × 旧实现'));
  });
  it('合并律映射表登记 Layer 1.85 四取值（11–14 行）且换算式为 14；报告结构行与返回摘要含 1.85', () => {
    assert.ok(v.includes('| 11 | `无报警 / 全部已处置` | Layer 1.85 导出符号可达性（F286） | **通过侧** |'));
    assert.ok(v.includes('| 12 | `报警未处置` | Layer 1.85 | 不通过侧 | 报警未处置 |'));
    assert.ok(v.includes('| 13 | `未执行（缺席）` | Layer 1.85（evidence-pack 无 baseRef / 契约字段缺一） | 不通过侧 | 未执行（缺席） |'));
    assert.ok(v.includes('| 14 | `不适用` | Layer 1.85（doc / sync 模式） | **通过侧** |'));
    assert.ok(v.includes('**全部 14 个取值**') && v.includes('Layer 1.85 四取值 4 = **14**'));
    assert.ok(v.includes('Layer 1.85 导出符号生产可达性（含处置表）'));
    assert.ok(v.includes('### Layer 1.85: 导出符号生产可达性\n- 状态: {无报警 / 全部已处置 | 报警未处置 | 未执行（缺席） | 不适用}'));
  });
  it('artifact 合同登记两章节（非注释行）；插件模板含 1.85 / 1.86 槽位且与项目级模板逐字节相同（B-C2）', () => {
    const a = read('agents/verify.artifact.yaml');
    assert.match(a, /^\s*- "## Layer 1\.85: 导出符号生产可达性"\s*$/m);
    assert.match(a, /^\s*- "## Layer 1\.86: 向后兼容类 SC 的 A\/B 记录"\s*$/m);
    const tpl = read('templates/verification-report-template.md');
    assert.ok(tpl.includes('\n## Layer 1.85: 导出符号生产可达性\n'));
    assert.ok(tpl.includes('\n## Layer 1.86: 向后兼容类 SC 的 A/B 记录（如适用）\n'));
    // `.specify/templates/` 被 .gitignore（本地由 init-project.sh 拷贝，不入库）：存在时断言与插件模板同源（本机漂移即红），
    // CI 无该目录时跳过——同步机制本身（init-project 只在缺席时拷贝 / repo:sync 无模板步骤）登记 M11（fix-report §3）
    const projectTplPath = path.join(REPO, '.specify', 'templates', 'verification-report-template.md');
    if (fs.existsSync(projectTplPath)) {
      assert.equal(fs.readFileSync(projectTplPath, 'utf8'), tpl, 'verify.md 优先读取 .specify/templates/ 的项目级模板——两份必须同源，否则插件侧改动在本仓不可见');
    }
  });
});

describe('F286 · 审查子代理写盘 / 证据契约（spec-review + quality-review 对称）', () => {
  for (const [agent, report] of [['spec-review', 'spec-review-report.md'], ['quality-review', 'quality-review-report.md']]) {
    it(`${agent}：frontmatter tools 含 Write；正文限定唯一可写路径 ${report}；artifact output_path 指向真实路径`, () => {
      const s = read(`agents/${agent}.md`);
      const front = s.split('---')[1] ?? '';
      assert.match(front, /tools: \[Read, (?:Write, |Bash, Write, |Write, Bash, )/);
      const body = flat(s);
      const marker = `\`{feature_dir}/verification/${report}\`。`;
      assert.ok(body.includes(marker + ' `Write` 权限**仅限**该文件') || body.includes(marker + '`Write` 权限**仅限**该文件'), `${agent} 缺仅限该文件的落盘约束`);
      assert.ok(body.includes('不得写任何源码、spec / plan / tasks 制品或其它路径'));
      const art = read(`agents/${agent}.artifact.yaml`);
      assert.ok(art.includes(`output_path: "{feature_dir}/verification/${report}"`));
      assert.ok(!art.includes('无文件输出'));
    });
  }
  it('spec-review：证据包来源 + 缺席处置（全局受限声明、依赖实测的 FR 归未核验）', () => {
    const s = stripHtmlComments(read('agents/spec-review.md'));
    assert.ok(s.includes('`{feature_dir}/verification/evidence-pack.md`'));
    assert.ok(s.includes('证据包缺席时'));
    assert.ok(s.includes('归入\n  「未核验」') || s.includes('归入「未核验」'));
  });
});

describe('F286 · implement.md RED 级取证（append-only 独立文件）', () => {
  it('每个红先行任务转绿即 append 到 verification/red-first-evidence.md；与覆盖写的 implementation-notes.md 分离；F279 SOP 兜底', () => {
    const s = stripHtmlComments(read('agents/implement.md'));
    const start = s.indexOf('**RED 级取证落盘');
    const end = s.indexOf('**Phase 级进度落盘');
    assert.ok(start >= 0 && end > start, 'RED 级取证段缺席或不在 Phase 级进度段之前');
    const seg = flat(s.slice(start, end));
    assert.ok(seg.includes('**立即**把本任务的红先行证据 append 到 `{feature_dir}/verification/red-first-evidence.md`'));
    assert.ok(seg.includes('**append-only** 文件'));
    assert.ok(seg.includes('新测试 × `git show <baseRef>:<src>` 旧实现应 FAIL'));
    assert.ok(!seg.includes('append 到 `{feature_dir}/implementation-notes.md`'), 'B-W3：不得与覆盖写入的进度文件同文件');
  });
});

describe('F286 · 四个 SKILL 的 spec-review 派发前置（编排器预跑注入证据包 + baseRef 首行 + 返回处理）', () => {
  for (const skill of ['feature', 'story', 'implement', 'fix']) {
    const s = stripHtmlComments(read(`skills/spec-driver-${skill}/SKILL.md`));
    it(`${skill}：前置段含 evidence-pack.md / baseRef 首行 / 不开 Bash 白名单 / 返回处理（缺席 + 越界）且为 MUST`, () => {
      const at = s.indexOf('spec-review 的派发前置（F286') >= 0 ? s.indexOf('spec-review 的派发前置（F286') : s.indexOf('spec-review 派发前置（F286');
      assert.ok(at >= 0, `${skill} 缺前置段`);
      const seg = s.slice(at, at + 2000);
      assert.ok(seg.includes('编排器 MUST 先**预跑注入**证据包'));
      assert.ok(seg.includes('`{feature_dir}/verification/evidence-pack.md`（**首行** `baseRef: $(git merge-base origin/master HEAD)`'));
      assert.ok(seg.includes('不开 Bash 白名单'));
      assert.ok(seg.includes('export-reachability.mjs --base <baseRef>'));
      assert.ok(seg.includes('**返回处理（B-W4）**：(1) `test -f` 两份报告'));
      assert.ok(seg.includes('`git status --porcelain`'));
      assert.ok(!/编排器 (MAY|可以|建议)/.test(seg), `${skill} 前置段被削弱`);
    });
  }
  it('story / implement / fix：前置段位于 spec-review 派发 Task 之前；spec-review 与 verify 的派发块都注入 evidence-pack 路径', () => {
    for (const skill of ['story', 'implement', 'fix']) {
      const s = stripHtmlComments(read(`skills/spec-driver-${skill}/SKILL.md`));
      const pre = s.indexOf('派发前置（F286');
      const dispatch = s.indexOf('调用 Task(description: "Spec 合规审查"');
      assert.ok(pre >= 0 && dispatch > pre, `${skill}：前置段（${pre}）必须在派发行（${dispatch}）之前`);
      assert.ok(s.includes('"{上下文注入 + evidence-pack.md 路径 + '), `${skill} spec-review 派发未注入 evidence-pack 路径`);
      assert.ok(s.includes('evidence-pack.md 路径（含 baseRef）'), `${skill} verify 派发未注入 evidence-pack 路径`);
    }
  });
});
