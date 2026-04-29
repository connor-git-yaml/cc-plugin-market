# Clarifications: Feature 146 — LLM 并发优化器

**生成时间**: 2026-04-29
**Spec 版本**: Draft（268 行）
**扫描结论**: 检测到 7 个歧义/缺失项，其中 1 个 CRITICAL，6 个 AUTO-RESOLVED

---

## CRITICAL 问题（需用户决策）

### C-001: 配置文件来源不明确——`spec-driver.config.yaml` 还是 `project-context.yaml`？

**位置**: FR-005（第 153 行）、User Story 1 场景 2（第 51 行）

**问题描述**:

FR-005 写的是「配置文件（spec-driver.config.yaml **或等效 batch 配置入口**）」，User Story 1 场景 2 写的是「`.specify/project-context.yaml`（或等效配置文件）」。两处引用了不同文件，且都用了模糊的"等效"兜底语。

`spec-driver.config.yaml` 是流程编排配置；`project-context.yaml` 是项目级长期偏好。`concurrency` 属于 batch 运行时参数，理论上两者都不理想——更可能应该在 `BatchOptions` 调用时由调用方传入，或放在一个专属 batch 配置节。

若实现时读错文件，行为会静默正确（仍走 CLI flag 路径），但测试用例 SC-002 会无法稳定复现。

**影响**:
- 直接影响 SC-002（可测量成果）的测试实现方式
- 影响 implement 阶段的文件改动范围（哪个 config 文件要新增 `concurrency` 字段支持）
- 若选错，可能污染不相关的配置文件结构

**选项**:

| 选项 | 描述 | 影响 |
|------|------|------|
| A | `concurrency` 字段读自 `spec-driver.config.yaml` 中的 `batch` 节 | 需在该 config schema 中新增字段；适合 batch 作为 spec-driver 子功能的场景 |
| B | `concurrency` 字段读自 `.specify/project-context.yaml` 中新增 `batch.concurrency` 节 | 沿用现有 project-context 入口；但混入运行时参数有一定 smell |
| C | 不支持配置文件，仅支持 CLI flag + `BatchOptions` 代码传参 | 范围最小；SC-002 / User Story 1 场景 2 需从验收标准中删除 |
| D | 新增独立 `batch.config.yaml`（或在 `package.json` 的 `spectra` 字段中） | 最干净但引入新文件约定，成本较高 |

**推荐**: 选项 A（`spec-driver.config.yaml` 的 `batch.concurrency` 节），理由是 concurrency 是 batch 模式的运行参数，与 spec-driver 的 batch 阶段直接关联，且 schema 已有扩展入口。但此决策影响配置 schema 合同，属于核心范围，需用户确认。

---

## 自动解决的澄清

| # | 问题 | 位置（行） | 自动选择 | 理由 |
|---|------|-----------|---------|------|
| 1 | "网络中断"如何在测试中检测/触发 | 第 128 行 Edge Cases | mock LLM 函数抛出 `new Error('Network error')` 即可模拟；不依赖真实网络中断 | JS 环境下网络中断等同于 `fetch` reject，单元测试只需 mock 抛错，无需真实断网 |
| 2 | `p-limit` 具体版本约束 | 第 177 行 FR-013 | `"p-limit": "^6.1.0"` | p-limit@6.x 是当前最新稳定主版本，原生 ESM，内置 TS 类型，兼容 Node.js 18+。`^6` 语义版本允许 patch/minor 升级，符合"版本约束与 Node.js 20.x 和纯 ESM 要求兼容"的要求。不使用 `^5`（5.x 仍为 ESM 但 API 略有差异）也不锁死 `=6.1.0` |
| 3 | `p-limit` 归属 `dependencies` 还是 `devDependencies` | 第 177 行 FR-013 | `dependencies` | spec 已明确写"非 devDependencies"；p-limit 在运行时 batch 路径中被调用，不仅用于测试 |
| 4 | SC-006 的 700ms 上限是否合理（每模块 100ms，10 个模块，concurrency=3） | 第 211 行 SC-006 | 合理，无需修改 | 理论最优：ceil(10/3)=4 批次 × 100ms = 400ms；700ms 留 75% 余量适合 CI 环境抖动；可执行性高 |
| 5 | FR-015 中 `concurrency=1` 是否保持独立 for-await 分支 | 第 183 行 FR-015 | 统一走 `p-limit(1)` 路径，移除分支 | `p-limit(1)` 语义上等同顺序执行，实测无性能差异；移除分支减少维护面；spec 本身已在 `[可选]` 注释中表明偏好 |
| 6 | SC-005 的"误差 < 1%"是否可执行 | 第 209 行 SC-005 | 改为严格相等断言（`=== 1000`） | tokenUsage 累加是整数加法，JS 单线程无浮点误差；"< 1%误差"的表述暗示有随机性，实际上 mock 场景下应该精确相等；保留"允许估算误差"的文字会使测试断言模糊 |

---

## 残留不确定项（无需决策，实现时注意）

以下为实现细节层面的模糊点，不影响架构决策，implement 阶段自行处理：

1. **CLI 入口文件路径**（第 229 行）：`src/cli/` 目录中具体修改哪个文件（可能是 `src/cli/commands/batch.ts` 或类似路径）——implement 阶段读文件确认后处理，无需 spec 级澄清。

2. **`ProgressReporter` 接口扩展方式**（第 170-171 行 FR-010/011）：注入 `activeCount getter` 是通过构造参数还是方法参数——FR-011 已约定"不修改现有接口签名"，具体注入方式留给实现阶段根据现有接口形态决定。

3. **SC-003 的"E2E mock 峰值计数断言"实现**（第 205 行）：需要在 mock LLM 函数内维护并发计数器，逻辑明确，无歧义，属实现细节。

---

## 扫描覆盖摘要

| 类别 | 状态 |
|------|------|
| 功能范围与行为 | Partial（C-001 配置文件来源待决） |
| 领域与数据模型 | Clear |
| 交互与 UX 流程 | Clear（progressMode 交互第 84 行已明确） |
| 非功能质量属性 | Clear（SC-006 量化断言可执行） |
| 集成与外部依赖 | Partial（p-limit 版本 AUTO-RESOLVED） |
| 边界条件与异常处理 | Clear（Edge Cases 表格覆盖完整） |
| 术语一致性 | Clear（concurrency/activeCount/progressMode 全文一致） |
| src/panoramic/ 交互边界 | Clear（第 237 行明确为"不可修改范围"） |
| src/core/llm-client.ts 交互边界 | Clear（第 236 行明确为"不可修改范围"，仅 FR-016 注释要求） |
