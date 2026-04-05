# 代码库结构与可维护性收敛蓝图

**版本**: 1.0.0
**创建日期**: 2026-04-05
**最后更新**: 2026-04-06
**状态**: Implemented

---

## 1. 目标

这轮里程碑不是新增用户能力，而是对当前仓库做一次**结构收敛**：

- 降低代码、Skill、Plugin、包装层之间的重复
- 明确源码、分发包装、运行态、项目态四类资产的边界
- 提升脚本层、文档层和产品事实层的一致性与可读性
- 在不重写整套系统的前提下，收敛出更稳定的长期维护结构

一句话说：

> 把已经做出来的能力从“能工作”收敛到“边界清晰、来源单一、可维护、可再生成”。

---

## 2. 当前评审结论

本次 review 覆盖了：

- `src/**`
- `plugins/**`
- `skills/**`
- `.codex/**`
- `.claude/**`
- `.specify/**`
- `specs/products/**`
- `docs/shared/**`
- `tests/**`

### 2.1 当前最主要的结构问题

#### A. 源码与包装层仍然存在多处平行副本

当前至少存在三类重复源：

- `reverse-spec` Skill 同时存在于：
  - `plugins/reverse-spec/skills/**`
  - `src/skills-global/**`
  - `skills/**`
- `spec-driver` Skill 源存在于：
  - `plugins/spec-driver/skills/**`
  - `.codex/skills/**`（安装包装）
- Claude 侧命令/包装存在于：
  - `plugins/spec-driver/.claude-plugin/**`
  - `.claude/commands/**`

这类重复不是 bug，但会持续放大：

- 文档漂移
- 版本漂移
- 包装遗漏
- 测试覆盖碎片化

#### B. 运行态、项目态、分发态目录边界还不够硬

虽然 `071` 已经把 `specs/products/**` 收干净，但仓库根目录仍同时承载：

- `plugins/**`：源码与模板源
- `.codex/**`：Codex 包装产物
- `.claude/**`：Claude 包装与本地配置
- `.specify/**`：项目覆盖层 + 运行态 + 建议产物

当前这些目录“能解释”，但还不够“强约束”：

- 哪些文件必须从源码生成
- 哪些文件允许项目覆盖
- 哪些文件只属于运行态
- 哪些应该纳入版本库

这套合同还没完全固化。

#### C. `plugins/spec-driver/scripts/*.mjs` 仍有明显的 mini-framework 重复

已经有共享层：

- `scripts/lib/simple-yaml.mjs`
- `scripts/lib/product-artifact-paths.mjs`
- `scripts/lib/project-profile-resolver.mjs`

但目前仍有多个脚本保留各自的：

- `parseYamlDocument`
- `stringifyYaml`
- markdown render helper
- index patch 逻辑
- report IO 逻辑

这说明脚本层已经从“少量工具脚本”长成了“半个平台层”，但共享抽象还没跟上。

#### D. 技术栈边界是合理的，但组织方式还不够统一

当前仓库实际上有 3 种主要实现风格：

- `src/**`: TypeScript 核心实现
- `plugins/spec-driver/scripts/*.mjs`: Node ESM 脚本
- `*.sh`: Bash 入口与生命周期脚本

这本身并不一定错误。问题在于：

- 哪些逻辑应留在 Bash
- 哪些逻辑应进入可测试的 Node/TS 共享层
- 哪些只是入口壳，不应再塞业务逻辑

这些规则还没有形成统一工程约束。

#### E. 文档与产品事实层已经有体系，但同步机制还可以更收口

当前已经有：

- `docs/shared/**` 共享片段
- `current-spec.md`
- `entity / workflow / quality / scorecard / adoption`
- `project-context.suggestions.*`

但仍存在这些改进空间：

- `AGENTS.md / CLAUDE.md` 依赖 `docs:sync:agents`，机制是对的，但还未推广到其它共享文档片段
- 版本号同步仍通过多文件手工 bump
- 产品事实与 Plugin 分发元数据之间还缺更统一的发布合同

#### F. 可读性热点已经从“业务逻辑”转移到“编排和生成基础设施”

当前最难维护的部分，不是 `src/panoramic/**` 的单个 generator，而是这些跨层机制：

- install / postinstall / lifecycle
- workflow / catalog / scorecard / quality / adoption 生成链
- skill 文档、包装、产品事实三方同步
- Project Context resolver / suggestions / init 模板

也就是说，下一轮优化最该聚焦的，不是“新算法”，而是“结构性维护成本”。

---

## 3. 设计原则

### 3.1 不重写，不大迁移，只收敛边界

这轮不做：

- 全量把 `.mjs` 改成 TypeScript
- 全量移除 Bash
- 重写 Plugin 分发体系
- 重命名现有对外目录合同

只做：

- 明确 source-of-truth
- 抽共享层
- 降低重复
- 让入口更薄、共享逻辑更集中

### 3.2 保持现有用户合同不变

以下外部合同默认保持不变：

- `reverse-spec` CLI
- `spec-driver-*` Skill 名称
- `specs/<feature>/...` 目录合同
- `specs/products/<product>/current-spec.md`
- `specs/products/<product>/_generated/**`
- `.specify/project-context.yaml`

### 3.3 把“业务逻辑”从包装层和入口层往共享层收

原则：

- Bash 只保留环境发现、调用、轻量复制
- `.mjs` 入口只保留参数解析与 orchestration
- 真正的解析、渲染、patch、report 逻辑进入共享库

### 3.4 先统一来源，再谈自动化

如果同一事实有多个来源：

- 先确定 canonical source
- 再决定生成链和测试
- 最后再加自动同步或发布逻辑

### 3.5 优化必须服务长期稳定，而不是短期好看

判断标准不是“目录更漂亮”，而是：

- 变更时需要同步改的地方更少
- 包装和产物更容易再生成
- 测试可以覆盖更多共享逻辑
- 新成员更容易理解“应该改哪层”

---

## 4. 目标结构

### 4.1 层次划分

```text
plugins/**                  # 插件源码、模板源、workflow/scorecard 定义源
src/**                      # reverse-spec / panoramic / CLI 核心实现
scripts/**                  # 仓库级轻量生命周期与同步入口
docs/shared/**              # 共享文档片段 source-of-truth
specs/**                    # blueprint / feature 制品与产品事实正文
specs/products/_generated/**              # 跨产品生成索引
specs/products/<product>/_generated/**    # 产品级机器生成产物
.codex/**                   # Codex 分发/安装包装层
.claude/**                  # Claude 分发/运行包装层
.specify/**                 # 项目覆盖层 + 运行态 + suggestions
```

### 4.2 收敛后的职责

#### `plugins/**`

只保留：

- Skill 源
- Agent 源
- 模板源
- workflow / scorecard / contract 定义源
- 包装生成脚本源

#### `.codex/**` / `.claude/**`

只保留：

- 安装或分发后需要存在的包装产物
- 必要的本地运行配置

要求：

- 尽量不手改
- 必须可从 source-of-truth 再生成

#### `.specify/**`

拆成三类：

- 覆盖层：`templates/`, `workflows/`, `scorecards/`
- 项目级长期配置：`project-context.yaml`
- 运行态与建议层：`runs/`, `project-context.suggestions.*`, `memory/`

---

## 5. 本里程碑编号

| 编号 | 类型 | 名称 | 说明 |
|------|------|------|------|
| 076 | BLUEPRINT | 代码库结构与可维护性收敛蓝图 | 当前文档 |
| 077 | FEATURE | 包装层与 source-of-truth 收拢 | 清理 Skill / Plugin / wrapper 副本关系 |
| 078 | FEATURE | Script Platform 共享层收敛 | 统一 YAML / report / patch / render 共享能力 |
| 079 | FEATURE | Reverse-Spec Skill 与分发结构收敛 | 收敛 `plugins` / `src/skills-global` / `skills` 三套来源 |
| 080 | FEATURE | 文档、版本与发布合同统一 | 统一版本 bump、共享文档片段、plugin metadata 同步 |
| 081 | FEATURE | 可读性与维护性热点重构 | 聚焦高复杂度脚本/编排器，做小范围结构重构 |

---

## 6. Feature 详情

### 6.1 Feature 077: 包装层与 source-of-truth 收拢

**目标**

明确并固化：

- 哪些文件是源码
- 哪些文件是包装产物
- 哪些文件必须再生成
- 哪些目录允许手工编辑

**重点处理**

- `plugins/spec-driver/skills/**` 与 `.codex/skills/**`
- `plugins/spec-driver/.claude-plugin/**` 与 `.claude/**`
- 包装生成链路的 source-of-truth 文档化和测试化

**验收标准**

1. `.codex/**` 与 `.claude/**` 的可编辑性规则明确
2. 安装脚本和包装测试覆盖 source-of-truth 约定
3. 手工改包装层的空间被最小化

### 6.2 Feature 078: Script Platform 共享层收敛

**目标**

把 `plugins/spec-driver/scripts/*.mjs` 里重复的解析、渲染、patch 和 IO 逻辑提到共享层。

**优先统一**

- YAML parse / stringify
- report file IO
- entity / catalog / index patch
- Markdown renderer helpers
- shared diagnostics / warning shape

**设计约束**

- 不要求一次迁完所有脚本
- 先处理 `entity / workflow / quality / scorecard / adoption / suggestions` 六条主链

**验收标准**

1. 不再保留多份功能等价的 `parseYamlDocument` / `stringifyYaml`
2. 主要生成脚本共享同一套基础 IO 与 diagnostics 合同
3. 共享层有专门单测

### 6.3 Feature 079: Reverse-Spec Skill 与分发结构收敛

**目标**

收敛 `reverse-spec` 的三套 Skill 来源：

- `plugins/reverse-spec/skills/**`
- `src/skills-global/**`
- `skills/**`

**设计约束**

- 必须保留现有对外发布能力
- 先做 source-of-truth 明确，再决定是否保留中间产物目录

**验收标准**

1. `reverse-spec` Skill 只有一个明确的源码来源
2. 其余目录要么成为生成产物，要么退出主维护路径
3. 打包清单与测试同步调整

### 6.4 Feature 080: 文档、版本与发布合同统一

**目标**

统一这些同步点：

- `plugin.json`
- `.claude-plugin/marketplace.json`
- README / Plugin README 版本文字
- `current-spec.md`
- `product-mapping.yaml`
- `docs/shared/**`

**方向**

- 让“版本 bump + 文档同步 + 分发元数据同步”更接近单链路
- 降低手工多文件维护

**验收标准**

1. 版本升级不再依赖多处手工修改
2. 共享文档片段机制可复用到更多稳定规则
3. Plugin 元数据与产品事实层关系更清晰

### 6.5 Feature 081: 可读性与维护性热点重构

**目标**

针对当前最复杂、最容易继续膨胀的结构做小范围重构，而不是大改。

**优先热点**

- `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- `plugins/spec-driver/scripts/init-project.sh`

**重构方向**

- 缩短单文件长度
- 降低工具函数内联数量
- 明确“参数解析 / 主流程 / 共享能力 / 渲染器”分层

**验收标准**

1. 重点热点文件复杂度下降
2. 新增测试不会更难写
3. 文档与实现的入口关系更清楚

---

## 7. 推荐实施顺序

### Phase 0: 先收 source-of-truth

`077 -> 079`

原因：

- 不先明确来源，就无法安全收共享层
- `reverse-spec` 与 `spec-driver` 的分发结构需要分别收口

### Phase 1: 再收脚本平台

`078 -> 081`

原因：

- 共享层先到位，再做热点重构，才不会把重复结构重构两遍

### Phase 2: 最后统一文档和发布合同

`080`

原因：

- 版本、文档、发布元数据必须建立在稳定目录和共享层之上

---

## 8. 非目标

这轮明确不做：

- 全量迁移到 monorepo 或 workspace
- 全量把 Bash 重写成 TypeScript
- 重命名所有现有目录
- 新增 portal / dashboard / server
- 推翻现有 `Spec Driver` 或 `Reverse Spec` 用户合同

---

## 9. 完成定义

本里程碑可视为完成，当且仅当：

1. Skill / Plugin / wrapper 的 source-of-truth 明确且被测试保护
2. 主要生成脚本共享一套基础平台，而不是各写各的 mini-framework
3. `reverse-spec` 与 `spec-driver` 的 Skill 来源不再三处平行维护
4. 文档、版本、发布元数据同步链路更接近单一入口
5. 高复杂度脚本的结构明显更易读、更易维护

---

## 10. 一句话总结

下一轮优化的核心不是“再做更多能力”，而是：

> 把现有能力收敛成一套来源单一、边界清晰、包装可再生成、脚本可维护的长期稳定结构。

---

## 11. 完成结论

本蓝图定义的主体目标已经完成：

- `077`：spec-driver wrapper source-of-truth 收拢
- `078`：script platform 共享层收敛
- `079`：reverse-spec Skill 与分发结构收敛
- `080`：文档、版本与发布合同统一
- `081`：可读性与维护性热点重构

收口过程中额外补了一轮仓库级 follow-up：

- `082`：新增 `repo:sync / repo:check`、运行态边界 contract 与 validator，并把 `check-plugin-sync.sh` 收敛为薄壳调用

当前已达成的维护性结果：

1. source-of-truth、wrapper / mirror / release contract / runtime boundary 都有显式合同与校验入口
2. 仓库维护者可以通过 `npm run repo:sync` 与 `npm run repo:check` 完成主要同步与验收
3. `.codex/`、`.claude/`、`.specify/` 的项目层、分发层和运行态边界已经被文档与 validator 双重固定
4. 复杂脚本的主流程已从“散落命令记忆”收敛到可测试的共享编排链

已知边界：

- `init-project.sh` 与 `codex-skills.sh` 仍保留 Bash 壳层；本轮只把 repo 级校验入口薄壳化，未继续重写全部生命周期脚本
- 产品级 `current-spec` 仍依赖既有 sync/聚合体系维护，本蓝图没有新增自动化聚合器
