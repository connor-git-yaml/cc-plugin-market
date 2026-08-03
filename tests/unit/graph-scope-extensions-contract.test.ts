/**
 * F254 跨语言合同：plugins 侧图消费决策的静态 fallback 覆盖面 ↔ 采集面 SSoT。
 *
 * 为什么需要这条测试（fix-report 的 Why 4/5）：
 * `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` 是零 import 的纯 `.mjs`
 * （Node 直跑、零 dist 依赖），**无法**在运行时引用 TS 侧的 `src/collector-surface.ts`。于是它的
 * `GRAPH_SCOPE_EXTENSIONS` 只能是一份手写副本——F241 时代那份副本在 d27ba75 扩面（`.mjs`/`.cjs`）
 * 之后静默失真，而当时的防漂移断言锁的是**它自己的快照**（"恰为这四项"），扩面后反而把失真固化
 * 下来，结构性地不可能报警。
 *
 * 本测试把这份副本钉死在 SSoT 上：任一侧扩面而忘了同步另一侧，这里立刻红。它是 fallback 一致性的
 * 唯一守护（生产路径优先消费图自述的 collector fingerprint，fallback 只在图无可信自述面时生效）。
 */
import { describe, expect, it } from 'vitest';

import { ALL_PRODUCER_SURFACES } from '../../src/collector-surface.js';
import { computeCollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';

// @ts-expect-error — .mjs 无类型声明，运行时可解析（同 graph-bootstrap-status.test.ts 先例）
import * as decisionModule from '../../plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs';
// @ts-expect-error — 同上；CLI 侧只取合同测试锚点常量，模块的自调用守卫在被 import 时不会触发
import * as cliModule from '../../plugins/spec-driver/scripts/graph-consumption-cli.mjs';

const GRAPH_SCOPE_EXTENSIONS = decisionModule.GRAPH_SCOPE_EXTENSIONS as readonly string[];
const FINGERPRINT_SURFACE_KEYS = cliModule.FINGERPRINT_SURFACE_KEYS as readonly string[];
const SUPPORTED_FINGERPRINT_FORMAT_VERSION = cliModule.SUPPORTED_FINGERPRINT_FORMAT_VERSION as number;

describe('F254 跨语言合同：plugins 侧 fallback 覆盖面 ↔ SSoT 采集面并集', () => {
  it('GRAPH_SCOPE_EXTENSIONS 与 ALL_PRODUCER_SURFACES 的扩展名并集逐项一致', () => {
    const expected = new Set<string>();
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) expected.add(extension);
    }

    expect([...new Set(GRAPH_SCOPE_EXTENSIONS)].sort()).toEqual([...expected].sort());
  });

  it('并集覆盖六条管线各自的全部扩展名（逐管线定位，便于一眼看出是哪条漏了）', () => {
    const fallback = new Set(GRAPH_SCOPE_EXTENSIONS);
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) {
        expect(fallback.has(extension), `fallback 覆盖面缺少 SSoT 声明的 ${extension}`).toBe(true);
      }
    }
  });

  it('fallback 不含任何 SSoT 之外的扩展名（宽于采集面会把图外改动误判为 in-scope）', () => {
    const declared = new Set<string>();
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) declared.add(extension);
    }

    expect(GRAPH_SCOPE_EXTENSIONS.filter((extension) => !declared.has(extension))).toEqual([]);
  });

  it('FINGERPRINT_SURFACE_KEYS 与 computeCollectorFingerprint().extensionSurface 的 key 集合一致', () => {
    // 第二处跨语言镜像（4b WARNING-2）：CLI 侧靠这份 key 列表逐条核验图自述指纹的结构。
    // 它漂移的失败方向是安全的（对不上 → 严格核验失败 → 整体回落静态面），但**静默**——
    // 动态面能力会永久丧失而不报任何错，因此必须由本断言锚定，不能靠"注释说了顺序对齐"。
    // SSoT 锚点取已导出的 computeCollectorFingerprint 返回值的 key，不为测试给私有常量加 export。
    const expected = Object.keys(computeCollectorFingerprint().extensionSurface);

    expect([...FINGERPRINT_SURFACE_KEYS].sort()).toEqual([...expected].sort());
  });

  it('SUPPORTED_FINGERPRINT_FORMAT_VERSION 与 computeCollectorFingerprint().formatVersion 一致', () => {
    // 第三处跨语言镜像（W-3）：CLI 侧靠这个版本号决定"认不认这份指纹"。它漂移的后果同样静默——
    // 版本对不上 → 所有指纹判不认识 → 永久回落静态面，动态面能力全失而不报错。
    // 同样从已导出的 computeCollectorFingerprint 返回值取，不给 TS 侧私有常量加 export。
    expect(SUPPORTED_FINGERPRINT_FORMAT_VERSION).toBe(computeCollectorFingerprint().formatVersion);
  });

  it('形态约束：小写、带前导点、无重复、且不可变（Object.freeze）', () => {
    for (const extension of GRAPH_SCOPE_EXTENSIONS) {
      expect(extension).toBe(extension.toLowerCase());
      expect(extension.startsWith('.')).toBe(true);
    }
    expect(new Set(GRAPH_SCOPE_EXTENSIONS).size).toBe(GRAPH_SCOPE_EXTENSIONS.length);
    expect(Object.isFrozen(GRAPH_SCOPE_EXTENSIONS)).toBe(true);
  });
});
