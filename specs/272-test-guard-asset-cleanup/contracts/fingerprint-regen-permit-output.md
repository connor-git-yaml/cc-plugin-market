# 契约：fingerprint regen 放行分支差异输出（FR-005 / 决策 4）

**载体**：`scripts/regen-collector-fingerprint-fixtures.ts` 放行分支（第 588-591 行附近）
**格式一致性要求**：与拒绝分支（第 570-580 行）保持同样的逐行打印格式，便于消费方（人工阅读或未来的日志解析工具）统一处理。

## 处置前行为

```ts
console.log(
  `[regen] 放行：contentMismatch=${aTrack.mismatch || bTrack.mismatch}、` +
    `fingerprintUnchanged=${fingerprintUnchanged}、inputHashChanged=${inputHashChanged}`,
);
```

`aTrack.differences` / `bTrack.differences` 已计算完成但未被使用。

## 处置后行为

```ts
console.log(
  `[regen] 放行：contentMismatch=${aTrack.mismatch || bTrack.mismatch}、` +
    `fingerprintUnchanged=${fingerprintUnchanged}、inputHashChanged=${inputHashChanged}`,
);
if (aTrack.mismatch || bTrack.mismatch) {
  for (const difference of [...aTrack.differences, ...bTrack.differences]) {
    console.log(`[regen]   - ${difference}`);
  }
}
```

**无差异场景约束**：`aTrack.mismatch === false && bTrack.mismatch === false` 时不进入上述 `if` 分支，不新增任何输出行（SC-004）。

## 差异文案格式（复用 `compareGraphOnlyStructure` / `compareModuleGraphSnapshot` 既有确定性文案，不新造格式）

| 场景 | 文案 |
|---|---|
| 节点仅存在于重建产物 | `节点仅存在于重建产物: <id>` |
| 节点仅存在于 pinned 期望 | `节点仅存在于 pinned 期望: <id>` |
| 节点计数不一致 | `节点计数不一致（重建 <left> vs pinned <right>）: <id>` |
| 边计数不一致 | `边计数不一致（重建 <left> vs pinned <right>）: <source>\|<relation>\|<target>` |
| module-graph 数组长度不一致 | `<pathLabel>: 数组长度不一致（重建 <left> vs pinned <right>）` |
| module-graph 值不一致 | `<pathLabel>: 值不一致（重建 <JSON> vs pinned <JSON>）` |

## 新增端到端测试场景契约（避免制造恒真/恒假断言）

**载体**：`tests/integration/collector-fingerprint-regen-script.test.ts`（新增用例，MUST NOT 修改第 157 行既有的"仅指纹变化"放行用例）

**双变量构造**：
1. Fixture 源码变化：在 `stageFixtureRoot()` 产出的临时目录里，对 `src/ts/foo.ts` 做一处会改变图结构的最小编辑（如新增一个可被 AST 解析到的顶层导出函数），使重建产物真的偏离 pinned（`aTrack.mismatch === true` 或 `bTrack.mismatch === true`）。
2. 指纹变化：复用既有 `downgradeBehaviorVersionInBothAssets()`，确保 `fingerprintUnchanged === false`（否则落入拒绝分支，测不出本次新增的放行分支行为）。

**断言**：
```ts
expect(run.status).toBe(0);
expect(run.stdout).toContain('放行');
expect(run.stdout).toContain('节点仅存在于重建产物:'); // 或按实际编辑内容对应的确定性文案
```

MUST 断到具体差异文案（如上表任一确定性格式），MUST NOT 仅断言"输出包含 'differences' 字样"这类空泛匹配。

## 变异验证记录点（verify 阶段）

临时删除处置后新增的打印循环（还原为处置前行为），重跑上述新增用例，确认断言变红（证明打印真的发生在放行分支代码路径里，而非恰好被其它输出满足）；确认后恢复打印循环。
