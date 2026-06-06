# 快速上手指南 — F175 Batch Incremental Wrapper

**适用版本**: F175 落地后（`spectra` batch 默认增量）  
**目标读者**: 使用 `spectra batch` 的开发者、CI 维护者、MCP 调用方

---

## 1. 最常见用法（默认增量，无需任何参数）

```bash
# 默认即增量模式：只重生成受变更影响的模块
spectra batch src/

# 等价于显式传 --incremental（通常不需要）
spectra batch src/ --incremental
```

**发生了什么**：spectra 计算每个模块的 skeleton-hash，与上次 batch 产物对比，只对有变化的模块（及依赖它们的上游模块）调用 LLM 重生成。未变化的模块的 `*.spec.md` 文件 mtime 不变。

---

## 2. 强制全量重生成（逃生口）

```bash
# 场景：cache 可能损坏 / 首次建立 baseline / 升级 LLM 后需全量刷新
spectra batch src/ --full

# --force 是 --full 的别名（向后兼容）
spectra batch src/ --force
```

**发生了什么**：完全忽略 DeltaRegenerator，对所有模块调用 `generateSpec`。

---

## 3. 组合 regen 轴 + 质量维度

```bash
# 全量重生成（regen 轴），但用轻量质量档（节省 token）
spectra batch src/ --full --mode reading

# 默认增量，同时切换到 code-only 质量档（注意：mode 切换会触发旧 spec 的 cache miss）
spectra batch src/ --mode code-only
```

**重要**：`--full` 是 regen 轴控制（重生成哪些模块）；`--mode` 是质量维度控制（生成什么详细度的 spec）。两者**正交**，可同时指定。

---

## 4. MCP 调用方

```typescript
// 默认增量（F175 后 incremental 默认 true）
await client.callTool('batch', { projectRoot: '/path/to/project' });

// 显式全量（SWE-Bench cohort 3、eval 基线等需要全量的场景）
await client.callTool('batch', {
  projectRoot: '/path/to/project',
  full: true,
});

// 显式 opt-out 增量（等同旧行为）
await client.callTool('batch', {
  projectRoot: '/path/to/project',
  incremental: false,
});
```

---

## 5. config 文件

```yaml
# spectra.config.yaml（或 .spectrarc）
incremental: true   # 默认（可省略）
# full: false       # 若需要每次全量，设为 true
```

---

## 6. 常见问题

**Q: F175 后 batch 行为变了，我能回到旧行为吗？**

可以。两种方式：
1. 每次传 `--full`（推荐，明确意图）
2. config 文件设 `incremental: false`（全局 opt-out）

**Q: `--full` 和 `--mode full` 有什么区别？**

- `--full`（regen 轴）：控制是否全量重生成所有模块（绕过增量 cache）
- `--mode full`（质量维度）：控制生成的 spec 文档详细程度（全量文档）

两者名字相似但完全不同维度，可同时使用。

**Q: 改了一个文件，为什么比预期多了几个模块重生成？**

这是 BFS 依赖传播：依赖你改动文件的上游模块也会被标记为受影响，触发重生成。这是正确行为，确保依赖方的 spec 与源码保持一致。

**Q: 无改动时 batch 还会执行任何操作吗？**

模块级 `generateSpec` 调用为 0，不产生模块级 LLM 调用。但项目级聚合（`_index.spec.md`、`graph.json`、debt 分析）仍执行，这是已知 cost，通常耗时较短。

**Q: baseline-collect 是否会被 cache 污染？**

不会。`baseline-collect.mjs` 在每次跑前清空 outputDir，DeltaRegenerator 无历史 spec 可比，自动退化为全量。无需修改 baseline 脚本。
