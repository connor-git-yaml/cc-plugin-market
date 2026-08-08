/**
 * F261 T013/T014（T-R6a/T-R6b）— `plugins/spec-driver/agents/implement.md` 的两条契约。
 *
 * ① 新增：Phase 级进度落盘约定必须在场（缺陷② 的落地判据）；
 * ② 回归防线：本次改动 MUST 是 additive——既有委派硬约束 / F208 依从性判定 / 三层验证体系 /
 *    改动后一致性自检的关键字面量一个都不许消失。任何一条被误删即红。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPLEMENT_MD = resolve(PROJECT_ROOT, 'plugins/spec-driver/agents/implement.md');

function readImplementMd(): string {
  return fs.readFileSync(IMPLEMENT_MD, 'utf-8');
}

/** 取第 5 节「进度追踪」的正文切片（约定必须落在此节内，不新增章节号、不散落到其他节）。 */
function readProgressSection(): string {
  const content = readImplementMd();
  const start = content.indexOf('5. **进度追踪**');
  const end = content.indexOf('6. **改动后一致性自检**');
  if (start < 0 || end <= start) {
    throw new Error(`第 5 节边界未找到：start=${start} end=${end}`);
  }
  return content.slice(start, end);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 必填项的**结构锚**：该项必须作为一条独立的列表项（`- **<字段名>**：…`）存在。
 *
 * 为什么不能用裸子串断言（F261 第五轮 W-1 的实证教训）：
 * 本节散文里恰好含 `下一步` / `已知偏差` / `覆盖` 等同名子串，于是删掉对应 bullet 后
 * 连 section-scoped 的 `toContain` 也照样满足 —— 变异测试实测 20 条用例全绿存活，
 * 即"粗粒度有守护、细粒度有缺口"。锚到 bullet 结构后，散文里的同名提及不再算数。
 */
function fieldBulletAnchor(label: string): RegExp {
  return new RegExp(String.raw`^[ \t]*[-*][ \t]+\*\*${escapeRegExp(label)}\*\*[ \t]*[：:]`, 'm');
}

/** 带值约束的 bullet 锚：字段行自身还必须携带指定内容（同一行内）。 */
function fieldBulletAnchorWithValue(label: string, valuePattern: string): RegExp {
  return new RegExp(
    String.raw`^[ \t]*[-*][ \t]+\*\*${escapeRegExp(label)}\*\*[ \t]*[：:][^\n]*${valuePattern}`,
    'm',
  );
}

interface RequiredItem {
  /** 契约要求出现的字面量（人读口径） */
  readonly literal: string;
  /** 该字面量必须落在的结构位置 */
  readonly anchor: RegExp;
}

/** 落盘契约的六个必填项，逐一锚到 bullet 结构（不是"该节任意位置出现过"）。 */
const REQUIRED_ITEMS: readonly RequiredItem[] = [
  {
    literal: 'implementation-notes.md',
    anchor: fieldBulletAnchorWithValue(
      '落盘文件',
      String.raw`\x60\{feature_dir\}/implementation-notes\.md\x60`,
    ),
  },
  { literal: '当前 Phase', anchor: fieldBulletAnchor('当前 Phase') },
  { literal: '已完成任务 ID', anchor: fieldBulletAnchor('已完成任务 ID') },
  { literal: '下一步', anchor: fieldBulletAnchor('下一步') },
  { literal: '已知偏差', anchor: fieldBulletAnchor('已知偏差') },
  { literal: '覆盖', anchor: fieldBulletAnchorWithValue('写入方式', '覆盖') },
];

/** 「每次写入 MUST 包含以下四项」这条列表里的四个字段名（顺序即文档顺序）。 */
const SNAPSHOT_FIELD_LABELS = ['当前 Phase', '已完成任务 ID', '下一步', '已知偏差'] as const;

describe('implement.md — Phase 级进度落盘约定（T-R6a）', () => {
  it('约定落在第 5 节「进度追踪」之内（不新增章节号，不散落到其他节）', () => {
    const section = readProgressSection();
    expect(section).toContain('Phase 级进度落盘（默认约定）');
  });

  for (const { literal, anchor } of REQUIRED_ITEMS) {
    it(`必填项以独立 bullet 形式在场（散文提及不算数）：${literal}`, () => {
      const section = readProgressSection();
      // 前置：字面量确实还在本节（弱条件），随后才是真正的结构断言
      expect(section).toContain(literal);
      expect(section).toMatch(anchor);
    });
  }

  it('四项快照字段同属「MUST 包含以下四项」那一条列表，且顺序不变', () => {
    const section = readProgressSection();
    const leadIn = section.indexOf('每次写入 MUST 包含以下四项');
    expect(leadIn).toBeGreaterThan(-1);

    const list = section.slice(leadIn);
    let cursor = -1;
    for (const label of SNAPSHOT_FIELD_LABELS) {
      const match = fieldBulletAnchor(label).exec(list);
      expect(match, `字段 ${label} 未以 bullet 形式出现在四项列表中`).not.toBeNull();
      const index = match!.index;
      expect(index, `字段 ${label} 的 bullet 顺序错位`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });
});

describe('implement.md — 既有硬约束未被削弱（T-R6b 回归防线）', () => {
  const PRESERVED_LITERALS = [
    'MUST 在声称任何任务完成之前',
    '禁止的推测性表述',
    '完成声明模板',
    '严格按 tasks.md 执行',
    '不修改 spec.md 或 plan.md',
    'Layer 3: 失败路径验证',
    'Layer 1: 工具链验证',
    'Layer 2: 行为验证',
    '改动后一致性自检',
    '逐阶段实现',
    'NEVER 可以用推测性表述替代实际验证',
  ];

  for (const literal of PRESERVED_LITERALS) {
    it(`既有字面量仍在场：${literal}`, () => {
      expect(readImplementMd()).toContain(literal);
    });
  }

  it('preference-rules 生成块边界完好（repo:sync 的同步锚点未被破坏）', () => {
    const content = readImplementMd();
    expect(content).toContain(
      '<!-- BEGIN preference-rules (generated from templates/preference-rules.md; do not edit) -->',
    );
    expect(content).toContain('<!-- END preference-rules -->');
  });

  it('frontmatter 的 goal_loop 接线（spectra impact / context 工具）未被改动', () => {
    const content = readImplementMd();
    expect(content).toContain('mcp__plugin_spectra_spectra__impact');
    expect(content).toContain('mcp__plugin_spectra_spectra__context');
  });
});
