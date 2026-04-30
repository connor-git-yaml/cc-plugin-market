/**
 * Feature 140 T20 — graph.html 始终生成 + 极小图 banner 集成测试
 *
 * 本文件覆盖 spec FR-011 的契约层断言：
 * 1. graph.html 默认生成（移除 `if (options.generateHtml)` 跳过条件）
 * 2. 极小图（< 3 节点）注入说明 banner
 *
 * **fixture-based 端到端 case** （micrograd / nanoGPT / ky / empty-project 在
 * 真实 batch 流程下生成 graph.html 并断言文件 + banner）依赖 Phase 1a (T10-T14)
 * 创建 fixture，故先以 it.todo 标记，待 Phase 1a 落地后填充。
 *
 * 本 step 通过：(a) src 层 grep 断言验证 batch-orchestrator 已移除跳过条件；
 * (b) html-template.test.ts 中 8 个 banner 用例覆盖文案、阈值边界、可访问性。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BATCH_ORCHESTRATOR_PATH = path.join(REPO_ROOT, 'src/batch/batch-orchestrator.ts');
const HTML_TEMPLATE_PATH = path.join(REPO_ROOT, 'src/panoramic/exporters/html-template.ts');

describe('Feature 140 FR-011 — graph.html 始终生成（契约层断言）', () => {
  it('batch-orchestrator 使用 `?? true` 默认生成 graph.html（无 `--html` flag opt-in 也生效）', () => {
    const source = fs.readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');
    // 关键 invariant：`if (options.generateHtml)` 之类的旧 opt-in 跳过条件应被替换
    expect(source).toContain('options.generateHtml ?? true');
    // 反向断言：不再出现裸 `if (options.generateHtml) {` 旧形式
    expect(source).not.toMatch(/if\s*\(\s*options\.generateHtml\s*\)\s*{/);
  });

  it('batch-orchestrator 把 nodeCount 透传给 buildHtmlTemplate（T19 banner 数据流）', () => {
    const source = fs.readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');
    // buildHtmlTemplate 调用应包含 nodeCount 字段
    expect(source).toMatch(/buildHtmlTemplate\(\s*graphDataJson\s*,\s*\{[\s\S]*?nodeCount:/);
  });

  it('html-template 定义了极小图阈值常量与文案常量', () => {
    const source = fs.readFileSync(HTML_TEMPLATE_PATH, 'utf-8');
    expect(source).toContain('SMALL_GRAPH_THRESHOLD = 3');
    // 文案与 spec FR-011 锁定一致（英文）
    expect(source).toContain('too few cross-module references for meaningful visualization');
    expect(source).toContain('--include-docs');
  });

  it('html-template buildFullHtml 接收 nodeCount 并基于 SMALL_GRAPH_THRESHOLD 决定注入', () => {
    const source = fs.readFileSync(HTML_TEMPLATE_PATH, 'utf-8');
    // 关键判断逻辑：typeof opts?.nodeCount === 'number' && < SMALL_GRAPH_THRESHOLD
    expect(source).toMatch(/typeof\s+opts\?\.nodeCount\s*===\s*['"]number['"]/);
    expect(source).toContain('SMALL_GRAPH_THRESHOLD');
  });

  // ============================================================================
  // 以下 fixture-based 端到端断言依赖 Phase 1a (T10-T14) 创建 fixture，先 todo。
  // 落地后改为 .it() 即可启用。
  // ============================================================================

  it.todo('fixture micrograd（4 模块）→ batch 完成后 _meta/graph.html 文件存在 + 不含 small-graph banner');
  it.todo('fixture empty-project（0 模块）→ batch 完成后 _meta/graph.html 文件存在 + 含 small-graph banner');
  it.todo('fixture ky（~30 模块）→ batch 完成后 _meta/graph.html 文件存在 + 不含 small-graph banner');
  it.todo('fixture 集 batch 末尾的 generateHtml 默认 undefined，仍生成 graph.html（验证 ?? true 默认）');
});
