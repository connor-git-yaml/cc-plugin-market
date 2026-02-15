# 快速上手: speckit-doc 命令

**Branch**: `015-speckit-doc-command` | **Date**: 2026-02-15

## 前置条件

- reverse-spec 项目已 clone 并安装依赖（`npm install`）
- Claude Code CLI 已安装且可用
- 当前项目中已安装 spec-driver plugin

## 实现概览

speckit-doc 是一个纯 Skill prompt 驱动的命令，**不涉及任何 TypeScript 源码修改**。所有实现文件位于 `plugins/spec-driver/` 目录内。

## 文件清单

需要创建的文件（全部为新增，无修改）:

```text
plugins/spec-driver/
├── skills/
│   └── speckit-doc/
│       └── SKILL.md                    # 主 Skill prompt（~400-600 行）
├── scripts/
│   └── scan-project.sh                 # 项目元信息收集脚本
└── templates/
    └── licenses/                       # 8 个 LICENSE 静态模板文件
        ├── MIT.txt
        ├── Apache-2.0.txt
        ├── GPL-3.0.txt
        ├── BSD-2-Clause.txt
        ├── BSD-3-Clause.txt
        ├── ISC.txt
        ├── MPL-2.0.txt
        └── Unlicense.txt
```

共 10 个新增文件，0 个修改文件。

## 开发顺序

### Step 1: 创建 LICENSE 模板文件

从 SPDX 官方（https://spdx.org/licenses/）或 choosealicense.com 获取 8 种协议的标准文本，替换版权信息为占位符 `[year]` 和 `[fullname]`，保存到 `plugins/spec-driver/templates/licenses/` 目录。

这一步是纯文件复制操作，无需编码，但需要确保文本 100% 与 SPDX 标准一致。

### Step 2: 创建 scan-project.sh 脚本

编写 Bash 脚本，收集项目元信息并输出 JSON。脚本逻辑:
1. 检查 package.json 是否存在
2. 解析 package.json 提取关键字段（使用 `node -e` 或 `python3 -c` 解析 JSON）
3. 收集 git 信息（`git config`、`git remote`）
4. 生成目录树（`find` 或 `ls -R`，深度限制 2）
5. 检测已有文档文件
6. 组装 JSON 输出

可参考现有的 `plugins/spec-driver/scripts/init-project.sh` 作为模板。

### Step 3: 编写 SKILL.md 主 Skill prompt

这是核心工作。SKILL.md 需要定义:
1. Skill 元数据（frontmatter）
2. 交互流程编排（模式选择 -> 协议选择 -> 文件生成 -> 冲突处理）
3. README.md 生成模板（含 8+ 个标准章节）
4. CONTRIBUTING.md 生成模板
5. CODE_OF_CONDUCT.md 处理逻辑（读取 Contributor Covenant 模板）
6. LICENSE 处理逻辑（读取静态文件 + 占位符替换）
7. 已有文件冲突处理逻辑
8. 错误和降级处理

可参考 `plugins/spec-driver/skills/speckit-feature/SKILL.md` 作为 Skill prompt 结构参考。

### Step 4: 集成测试

在 3 种不同类型的 Node.js 项目上执行 `/spec-driver:speckit-doc` 命令:
1. CLI 工具项目（有 bin 字段）
2. npm 库项目（有 main 字段）
3. Web 应用项目（有 dev 脚本，无 main/bin）

验证:
- 生成的 README.md 包含 8+ 个标准章节
- LICENSE 文件与 SPDX 标准文本一致
- CONTRIBUTING.md 包含项目特定的命令
- 已有文件冲突处理正确触发
- 降级场景（无 package.json）正常工作

## 运行命令

```bash
# 在目标项目中执行
/spec-driver:speckit-doc

# 或通过 Claude Code CLI
claude code "/spec-driver:speckit-doc"
```

## 常见问题

**Q: 如何调试 scan-project.sh?**
A: 直接在项目根目录执行 `bash plugins/spec-driver/scripts/scan-project.sh --json`，检查 JSON 输出。

**Q: Skill prompt 太长怎么办?**
A: SKILL.md 预计 400-600 行，在 Claude Code Skill 的正常范围内。如果超过 800 行，考虑将 README 章节模板拆分为独立文件由 Skill 按需读取。

**Q: 如何添加新的协议类型?**
A: 在 `plugins/spec-driver/templates/licenses/` 下添加 `{SPDX-ID}.txt` 文件，并在 SKILL.md 的协议选择列表中新增对应条目。
