/**
 * F189 prototype —— 全仓路线（OpenLore 式）最小 demo（GATE_DESIGN 新增，US4/FR-012）。
 *
 * 仅 demo 级：用 fixture 模拟「改动文件集」+「spec→Source files 映射」，分类：
 *   - gap：改动文件在某 domain 的 sourceFiles 内，且该 domain 的 spec 未改 → spec 落后实现
 *   - uncovered：改动文件不在任何 domain 映射内 → 覆盖空洞
 *   - stale-ref：某 domain 的 sourceFiles 列了已不存在的文件 → spec 指向死实现
 *
 * 边界（spec 非目标 #2）：不接真实 git diff、不建生产分类引擎、不做语义矛盾推理。
 */
import type { WholeRepoInput, WholeRepoReport } from './types.js';

export function classifyWholeRepo(input: WholeRepoInput): WholeRepoReport {
  const existing = new Set(input.existingFiles);

  // 文件 → 覆盖它的 domain 列表
  const fileToDomains = new Map<string, string[]>();
  for (const m of input.mappings) {
    for (const f of m.sourceFiles) {
      const arr = fileToDomains.get(f) ?? [];
      arr.push(m.domain);
      fileToDomains.set(f, arr);
    }
  }
  const specChangedByDomain = new Map(input.mappings.map((m) => [m.domain, m.specChanged]));

  const gap: WholeRepoReport['gap'] = [];
  const uncovered: string[] = [];

  for (const file of input.changedFiles) {
    const domains = fileToDomains.get(file);
    if (!domains || domains.length === 0) {
      uncovered.push(file);
      continue;
    }
    // 改了文件、但覆盖它的 domain 的 spec 没改 → gap
    for (const domain of domains) {
      if (specChangedByDomain.get(domain) === false) {
        gap.push({ file, domain });
      }
    }
  }

  // stale-ref：映射里列了磁盘上不存在的文件
  const staleRef: WholeRepoReport['staleRef'] = [];
  for (const m of input.mappings) {
    for (const f of m.sourceFiles) {
      if (!existing.has(f)) {
        staleRef.push({ domain: m.domain, missingFile: f });
      }
    }
  }

  return { gap, uncovered, staleRef };
}
