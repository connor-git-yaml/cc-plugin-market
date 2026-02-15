# Verification Report: {FEATURE_NAME}

**特性分支**: `{BRANCH_NAME}`
**验证日期**: {DATE}
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 2 (原生工具链)

## Layer 1: Spec-Code Alignment

### 功能需求对齐

| FR | 描述 | 状态 | 对应 Task | 说明 |
|----|------|------|----------|------|
| FR-001 | {描述} | ✅ 已实现 / ❌ 未实现 / ⚠️ 部分实现 | T{XXX} | {说明} |

### 覆盖率摘要

- **总 FR 数**: {N}
- **已实现**: {M}
- **未实现**: {K}
- **部分实现**: {L}
- **覆盖率**: {M/N × 100}%

## Layer 2: Native Toolchain

{以下各节按检测到的语言/构建系统动态生成}

### {语言} ({构建系统})

**检测到**: {特征文件路径}
**项目目录**: {根目录或子项目目录}

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `{命令}` | ✅ PASS / ❌ FAIL / ⏭️ 工具未安装 | {输出摘要} |
| Lint | `{命令}` | ✅ PASS / ⚠️ {N} warnings / ❌ FAIL / ⏭️ 工具未安装 | {输出摘要} |
| Test | `{命令}` | ✅ {N}/{M} passed / ❌ {K} failed / ⏭️ 工具未安装 | {输出摘要} |

### Monorepo 子项目汇总（如适用）

| 子项目 | 路径 | 语言 | Build | Lint | Test |
|--------|------|------|-------|------|------|
| {name} | {path} | {lang} | ✅/❌ | ✅/⚠️/❌ | ✅/❌ |

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | {N}% ({M}/{K} FR) |
| Build Status | ✅ PASS / ❌ FAIL |
| Lint Status | ✅ PASS / ⚠️ {N} warnings / ❌ FAIL |
| Test Status | ✅ PASS ({N}/{M}) / ❌ FAIL ({K} failed) |
| **Overall** | **✅ READY FOR REVIEW / ❌ NEEDS FIX** |

### 需要修复的问题（如有）

1. {问题 1}: {描述和建议}
2. {问题 2}: {描述和建议}

### 未验证项（工具未安装）

- {工具 1}: {安装建议}
