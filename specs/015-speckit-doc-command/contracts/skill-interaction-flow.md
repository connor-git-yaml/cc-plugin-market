# 契约: Skill 交互流程

**Branch**: `015-speckit-doc-command` | **Date**: 2026-02-15

## 概述

定义 speckit-doc Skill prompt 与用户之间的交互协议。交互采用"先收集后生成"模式——所有用户输入在步骤 1-3 完成，步骤 4-5 为自动执行。

## 端到端交互流程

```text
Step 1: 项目元信息自动提取（无交互）
  ├── 执行 scan-project.sh
  ├── 可选: 执行 reverse-spec prepare（AST 分析）
  └── 输出: 项目概要摘要

Step 2: 文档组织模式选择（交互）
  ├── 展示选项列表
  └── 等待用户回复

Step 3: 开源协议选择（交互）
  ├── 展示 8 种协议列表（高亮推荐项）
  └── 等待用户回复

Step 4: 批量文件生成（无交互）
  └── 根据 Step 2-3 的选择生成所有文件

Step 5: 逐文件冲突检测与处理（条件交互）
  ├── 对每个已存在的目标文件:
  │   ├── 展示 diff 预览
  │   └── 等待用户选择: 覆盖(备份) / 跳过
  └── 对不存在的目标文件: 直接写入
```

## Step 2: 文档模式选择交互

### Skill 输出格式

```markdown
请选择文档组织模式:

1. **Minimal（精简模式）** — README.md + LICENSE
   适合个人项目、实验性项目或内部工具

2. **Full（完整模式）** — README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md
   适合面向社区的正式开源项目

请回复 1 或 2（或输入模式名称）:
```

### 用户输入格式

接受以下输入格式（不区分大小写）:
- `1` / `2`
- `minimal` / `full`
- `精简` / `完整`

### 无效输入处理

```markdown
未识别的输入 "{user_input}"。请回复 1（精简模式）或 2（完整模式）:
```

最多重试 2 次，仍无效则默认使用精简模式并提示用户。

## Step 3: 协议选择交互

### Skill 输出格式

```markdown
请选择开源协议:

{recommended_marker} 1. **MIT** — 最宽松，几乎无限制，适合大多数项目
   2. **Apache-2.0** — 宽松 + 专利保护，适合企业级项目
   3. **GPL-3.0** — 强 Copyleft，衍生作品必须同协议开源
   4. **BSD-2-Clause** — 极简宽松，仅保留版权声明和免责声明
   5. **BSD-3-Clause** — BSD-2 + 禁止未授权使用作者名字推广
   6. **ISC** — 类似 MIT，更简洁，Node.js 项目常用
   7. **MPL-2.0** — 文件级 Copyleft，修改的文件需开源，新文件可闭源
   8. **Unlicense** — 公共领域，放弃所有权利

请回复编号（1-8）或协议名称:
```

**`recommended_marker` 规则**:
- 若 `ProjectMetadata.license` 非 null 且匹配 8 种之一: 在对应项前添加 `[推荐]` 标记
- 若不匹配或为 null: 无特殊标记

### 用户输入格式

接受以下输入格式（不区分大小写）:
- `1` 到 `8` 的编号
- SPDX ID: `MIT`、`Apache-2.0`、`GPL-3.0`、`BSD-2-Clause`、`BSD-3-Clause`、`ISC`、`MPL-2.0`、`Unlicense`

### 无效输入处理

同 Step 2，最多重试 2 次。

## Step 5: 冲突处理交互

### Skill 输出格式（每个已存在文件）

```markdown
检测到已有文件: {fileName}

--- 已有内容预览 ---
{前 20 行内容}
--- 预览结束 ---

操作选项:
  A) 覆盖（原文件备份为 {fileName}.bak）
  B) 跳过（保留已有文件）

请选择 A 或 B:
```

### 用户输入格式

接受: `A` / `B` / `a` / `b` / `覆盖` / `跳过`

## 完成报告格式

```markdown
speckit-doc 文档生成完成!

生成文件:
  {status_icon} {fileName} — {action_description}
  ...

{warning_section if any missing fields}

提示: 请检查生成的文件，补充标记为 [待补充] 的内容。
```

**status_icon 规则**:
- 新建: `+`（加号）
- 覆盖（已备份）: `~`（波浪号）
- 跳过: `-`（减号）
