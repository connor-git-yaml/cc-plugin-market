# F194 before/after 文件集 diff 结果（T005 步骤 3/4）

执行时间：2026-06-13（fix 实现完成后，工作区 = 194-fix-python-adapter-gitignore 分支未提交改动）
执行方式：`npx tsx capture-py-graph.mjs <root>` / `npx tsx capture-collect-paths.mjs <root>`，与 before-*.json 逐字段 diff

## 步骤 3 — baseline 回归对比

| 项目 | 路径 | before | after | diff |
|------|------|--------|-------|------|
| micrograd | 路径1 module graph（moduleCount/sources/edges/symbols） | 4 modules | 4 modules | **零差异 ✓** |
| micrograd | 路径2 collectPythonCodeSkeletons | 5 files | 5 files | **零差异 ✓** |
| nanoGPT | 路径1 module graph | 15 modules | 15 modules | **零差异 ✓** |
| nanoGPT | 路径2 collectPythonCodeSkeletons | 15 files | 15 files | **零差异 ✓** |
| self-dogfood（本仓） | 路径2 py | 30 files | 30 files | 零差异 ✓ |
| self-dogfood（本仓） | 路径3 tsJs | 690 files | 691 files | removed=0；added=1：`tests/unit/batch-orchestrator-gitignore.test.ts`（本 fix 新建的测试文件本身，非过滤行为变化）✓ |

**结论**：micrograd/nanoGPT 全口径零差异 → baseline fixture（tests/baseline/{micrograd,nanoGPT}/spectra/full.json）无需重采集；self-dogfood 无任何文件被新过滤层移除（本仓 .gitignore 排除项均已被硬编码集覆盖），与 fix-report 预判一致。

## 步骤 4 — 合成项目复现转正

`/tmp/f193-repro`（.gitignore: `generated/` + `local_*.py`；文件 pkg/core.py + generated/auto_stub.py + local_scratch.py）：

| 指标 | fix 前（诊断阶段实测） | fix 后 |
|------|----------------------|--------|
| moduleCount | 3 | **1** ✓ |
| moduleSources | generated/auto_stub.py, local_scratch.py, pkg/core.py | **仅 pkg/core.py** ✓ |
| symbolFiles | 同上 3 项 | **仅 pkg/core.py** ✓ |

目录模式（`generated/`）与通配模式（`local_*.py`）均生效，根因修复实证闭环。
