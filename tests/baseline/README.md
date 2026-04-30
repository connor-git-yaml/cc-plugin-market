# Baseline Fixtures（Feature 143）

本目录存储 Spectra 在真实开源项目上的性能/成本/质量基线数据，作为 F140（panoramic 大改）和 F146（LLM 并发优化）等后续工作的 perf regression guard。

## 用法

```bash
# 跑某个项目某个 mode 的 baseline，自动写入 tests/baseline/<project>/<mode>.json
npm run baseline:collect -- --target self-dogfood --mode full
npm run baseline:collect -- --target karpathy/micrograd --mode full
npm run baseline:collect -- --target continuedev/continue --mode full --commit v0.9.245

# 验证 SC-001（≥ 2 个 500+ 项目的 full mode fixture 存在 + schema 完整）
npm run baseline:collect -- --verify-artifacts

# 跨 commit 比较（regression）
npm run baseline:diff -- tests/baseline/continue/full.json /tmp/continue-full-new.json

# 同 commit 重跑（reproducibility，FAIL 即 collector 不可信）
npm run baseline:diff -- /tmp/run1.json tests/baseline/micrograd/full.json --mode reproducibility
```

## 已知 target

| target spec | 类型 | 说明 |
|-------------|------|------|
| `self-dogfood` | 本仓库 | 不 clone，直接用 `process.cwd()` |
| `karpathy/micrograd` | clone | 极小 Python 项目，锚点用 |
| `continuedev/continue` | clone | TS 800+ 文件，Wave 1 大目标 |
| `khoj-ai/khoj` | clone | Python + TS 混合，Wave 2 满足双语言 SC |

## 目录结构

```
tests/baseline/
├── README.md             # 本文件
├── <project>/
│   └── <mode>.json       # fixture，schemaVersion 1.0
└── .workspaces/          # gitignored，clone 目标项目的 scratch 目录
    └── .gitkeep
```

## Fixture schema（schemaVersion 1.0 摘要）

完整定义见 [plan.md §5.3](../../specs/143-large-project-e2e-baseline/plan.md)。关键字段：

- `meta.spectraVersion / collectorVersion / targetCommit`：reproducibility 所需
- `meta.targetFileCountsByType / targetLocEstimate`：项目规模标注（spec §5.1 必含）
- `meta.command / args / envAllowlist`：完整运行命令，可重现
- `dryRun.estimatedTokens / actualTokens / biasRatio`：dry-run vs 实跑对比
- `perf.totalWallMs / llmCall* / tokens* / memoryPeakKb`：性能维度
- `output.graph* / spec*`：产出规模
- `phases.*`：阶段耗时占比（schemaVersion 1.0 可能为 null + extractionMethod="unavailable"）
- `quality`：placeholder（F140 后续回填，届时 schemaVersion 升 1.1）

## 注意事项

- **不要直接编辑 fixture**：通过 `npm run baseline:collect` 重跑产生
- **所有 LLM 调用强制 sonnet 4.6**：collector 内置（避免高成本 model 干扰基线）
- **Continue / khoj 跑 full mode 耗时 30-60 分钟，cost ~$1-2**：Wave 1 / Wave 2 实跑前确保 ANTHROPIC_API_KEY 可用 + 预算允许
- **schemaVersion 升级规则**：minor add → 老 fixture 自动补 null；major break → diff 工具拒绝跨版本比较（除非 `--ignore-quality`）
