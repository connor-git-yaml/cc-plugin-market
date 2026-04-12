# 问题修复报告

## 问题描述

Feature 099 spectra-rebrand 完成后，`.specify/` 运行时目录和 `.codex/skills/` 中仍残留 `reverse-spec` 品牌引用，未被本次重命名覆盖。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为什么这些文件仍有 reverse-spec 引用？ | 这些路径未被 Feature 099 的实施范围覆盖 |
| Why 2 | 为什么未被覆盖？ | `scripts/audit-rename.sh` 豁免了 `.specify/` 和 `.codex/` 目录（按 plan.md 排除运行时/缓存目录） |
| Why 3 | 为什么这些目录被排除？ | audit-rename.sh 设计时将 `.specify/` 归类为"运行时态"，`.codex/` 归类为"本地安装目录" |
| Why 4 | 这些文件实际上属于运行时态吗？ | 不完全是：constitution.md 是长期事实源，project-context.yaml 是 canonical 项目配置，.codex/skills/ 是已安装技能文件，均需随品牌更新 |
| Why 5 | 为何验证阶段未发现？ | verify agent 做了 audit-rename.sh 扫描，但扫描范围与 audit 脚本相同，同样排除了上述目录 |

**Root Cause**: audit-rename.sh 和 verify 验证范围将 `.specify/`、`.codex/` 归类为豁免，但这些目录中有非运行时的品牌事实文件未同步更新。

**Root Cause Chain**: 品牌文件残留 → 被 audit 脚本豁免 → 未进入 099 实施范围 → 验证阶段同样未覆盖 → 遗漏

## 影响范围扫描

### 需修复文件（同源）

| 文件 | 行号 | 引用数 | 修复动作 |
|------|------|--------|----------|
| `.specify/memory/constitution.md` | 11,13,57,59,84,85,104,197,218 | 9 | 品牌名替换为 Spectra / spectra |
| `.specify/project-context.yaml` | 22 | 1 | 路径 `specs/products/reverse-spec/` → `specs/products/spectra/` |
| `.specify/project-context.suggestions.yaml` | 27-29,36,39,42,115,116 | 8 | 路径 + 品牌名同步替换 |
| `.specify/project-context.suggestions.md` | 24,27,28,29,77 | 5 | 路径 + 品牌名同步替换 |
| `.codex/skills/spec-driver-doc/SKILL.md` | 111 | 1 | `npx reverse-spec prepare` → `npx spectra prepare` |

### 豁免（不修复）

| 文件 | 原因 |
|------|------|
| `src/config/project-config.ts` | `.reverse-spec.yaml` 配置文件名，用户兼容期保留 |
| `src/batch/checkpoint.ts` | 检查点文件名，运行时兼容 |
| `src/cli/index.ts` | deprecation 检测字符串 |
| `package.json` bin alias | 向后兼容别名 |
| `plugins/reverse-spec/` 整体 | 废弃过渡容器 |
| 测试文件 `generatedBy` fixture | 模拟旧版输出，改了反而不准确 |

## 修复策略

### 方案 A（推荐）：直接替换
对 5 个文件逐一执行精确替换，无架构变更。预计修改量：约 24 处字符串。

## Spec 影响
无需更新 spec 文件（修复纯属品牌字符串同步，无功能变更）。
