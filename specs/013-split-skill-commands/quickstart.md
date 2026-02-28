# 快速上手: 拆分 Speckit Driver Pro 技能命令

**特性分支**: `013-split-skill-commands`
**前置条件**: 熟悉 Claude Code Plugin 的 SKILL.md 规范

## 目标

将 `plugins/speckit-driver-pro/skills/speckit-driver-pro/SKILL.md`（706 行单体文件）拆分为三个独立技能文件：

| 新技能 | 路径 | 预估行数 | 核心职责 |
|--------|------|---------|---------|
| run | `skills/run/SKILL.md` | ~350 行 | 10 阶段编排流程 + 初始化 + 重试 + 重跑 + 模型选择 |
| resume | `skills/resume/SKILL.md` | ~150 行 | 精简初始化 + 中断恢复（制品扫描 + 恢复执行） |
| sync | `skills/sync/SKILL.md` | ~120 行 | 产品规范聚合（扫描 + 合并 + 报告） |

## 实施步骤

### Step 1: 创建新技能目录

在 `plugins/speckit-driver-pro/skills/` 下创建三个目录：

```text
skills/
├── speckit-driver-pro/   # 旧（暂时保留）
│   └── SKILL.md
├── run/                  # 新
│   └── SKILL.md
├── resume/               # 新
│   └── SKILL.md
└── sync/                 # 新
    └── SKILL.md
```

### Step 2: 编写 run/SKILL.md

从原始 SKILL.md 提取以下段落，组装为 run 技能：

| 原始行范围 | 内容 | 处理方式 |
|-----------|------|---------|
| L1-L3 | 标题和角色描述 | 裁剪为 run 专用标题 |
| L5-L13 | 触发方式 | 仅保留 run 相关命令 |
| L15-L33 | 输入解析 | 保留 `--rerun`、`--preset`，移除 `--resume`、`--sync` |
| L36-L97 | 初始化阶段 | 完整保留（含特性目录准备） |
| L99-L491 | 工作流定义 + 完成报告 | 完整保留 |
| L580-L609 | 失败重试 | 完整保留 |
| L642-L663 | 选择性重跑 | 完整保留 |
| L666-L706 | 模型选择 + 阶段进度映射 | 完整保留 |

### Step 3: 编写 resume/SKILL.md

从原始 SKILL.md 提取以下段落：

| 原始行范围 | 内容 | 处理方式 |
|-----------|------|---------|
| L1-L3 | 标题 | 改写为 resume 专用标题 |
| L36-L88 | 初始化的环境检查+配置加载+prompt 映射 | 保留，排除 L90-L97（特性目录准备） |
| L610-L638 | 中断恢复机制 | 完整保留 |
| L666-L689 | 模型选择 | 仅保留配置加载部分（读取 spec-driver.config.yaml），不含完整决策表 |

额外新增内容：
- resume 专用触发方式和参数说明
- 恢复后的执行流程（从恢复点调用后续阶段）
- 无可恢复制品时的错误提示

### Step 4: 编写 sync/SKILL.md

从原始 SKILL.md 提取以下段落：

| 原始行范围 | 内容 | 处理方式 |
|-----------|------|---------|
| L493-L577 | 聚合模式 | 完整保留 |

额外新增内容：
- sync 专用 frontmatter 和标题
- specs/ 目录为空或不存在时的错误提示

### Step 5: 验证新技能（Strangler Fig 共存期）

1. 在 Claude Code 中输入 `/speckit-driver-pro:` 确认四个技能（旧+新）均可见
2. 执行 `/speckit-driver-pro:sync` 验证聚合流程
3. 确认每个新技能的 description 在补全菜单中正确显示

### Step 6: 删除旧技能

```bash
rm -rf plugins/speckit-driver-pro/skills/speckit-driver-pro/
```

验证：
- `/speckit-driver-pro:` 仅显示 run、resume、sync
- agents/、hooks/、scripts/、templates/ 不受影响

## Frontmatter 速查

```yaml
# run/SKILL.md
---
name: run
description: "执行 Spec-Driven Development 完整研发流程（10 阶段编排：调研-规范-规划-实现-验证）"
disable-model-invocation: true
---

# resume/SKILL.md
---
name: resume
description: "恢复中断的 Speckit 研发流程 — 扫描已有制品并从断点继续编排"
disable-model-invocation: true
---

# sync/SKILL.md
---
name: sync
description: "聚合功能规范为产品级活文档 — 将 specs/ 下的增量 spec 合并为 current-spec.md"
disable-model-invocation: false
---
```

## 注意事项

- 所有路径引用（如 `plugins/speckit-driver-pro/templates/...`、`plugins/speckit-driver-pro/agents/...`）保持不变
- resume 的初始化不包含"特性目录准备"步骤（Step 5 in 原始初始化）
- `--rerun` 仅在 run 技能中，resume 不包含重跑逻辑
- sync 的 `disable-model-invocation` 设为 false（允许自动触发）
