# Spec — F205 scaffold-kb 实战示例扩充

> 模式：story（跳过调研）｜范围：SMALL（纯文档，2 文件）
> 目标读者：集成商（integrator）/ 厂商（vendor）——照着 guide 就能上手"导入文档 + 构建知识库"。

## 背景与问题

`docs/scaffold-kb-guide.md` 写于 F190 期（151 行），结构完整（When to use / Build / Package /
Query / Layer project knowledge），但**示例密度不足**：

- `build` 仅 2 行最小示例，未覆盖 `--sdk-version` / `--lang` / `--no-llm` 组合
- F192 的**三方文档导入（ingest）**只有 3 行裸命令，缺少：office / url / minutes 三类源的
  分别说明、预览→确认（`--dry-run`→`--yes`）两步安全流的真实输出、退出码语义
- 缺少 **KB MCP 工具在 agent 里的调用示例**与厂商库/项目库双层命中的直观展示
- 缺少 **F191 预查注入**（KB 如何在 spec-driver specify 前自动注入）的接入说明
- 缺少一条**端到端 worked example**——用一个真实公开开源 SDK 走通 build→ingest→query→在
  spec-driver flow 里用上

用户明确要"如何导入文档和知识库"的实例。

## User Stories

- **US1（集成商导入文档）**：作为集成商，我想照着 guide 把一份厂商规格（docx/网页/会议纪要）
  导入到可写项目库，并先预览再确认落库，避免误写。
- **US2（厂商构建 KB）**：作为厂商，我想看到 `build` 在不同输入（文档目录 / llms.txt）和不同
  开关（`--sdk-version` / `--lang` / `--no-llm`）下的真实用法。
- **US3（agent 查询）**：作为在 agent 里工作的开发者，我想知道 `kb_search` / `kb_doc_lookup` /
  `kb_api_lookup` 各自何时调用，以及厂商库+项目库双层命中长什么样。
- **US4（流程接入）**：作为 spec-driver 用户，我想知道配置 `knowledge_sources` 后，KB 命中如何
  在 specify 阶段前自动注入需求上下文。
- **US5（端到端）**：作为新用户，我想跟着一条完整链路（真实公开 SDK）跑一遍，建立整体心智。

## Functional Requirements

- **FR-001** guide 扩充 `build` 示例：文档目录 / llms.txt URL / 带 `--sdk-version --lang` /
  `--no-llm` 纯检索，并展示真实成功输出行（`[scaffold-kb] 构建完成：N 文档 / N chunk / N 实体（method）→ path`）。
- **FR-002** guide 新增**导入文档（ingest）**实战段，覆盖三类源：
  - office 文件：`ingest --file <doc>.docx --project-kb kb/ --dry-run` →（确认后）`--yes`
  - 网页：`ingest --url https://<public-docs> --project-kb kb/ --dry-run`（SSRF 安全）
  - 会议纪要：`ingest --minutes <notes>.md --project-kb kb/`
  - 必须讲清**预览→确认两步安全流**、真实预览输出、退出码（0 成功 / 1 全失败 / 2 部分失败）、
    `--project-kb` 默认值（`.spectra/kb`）、三方内容按 **untrusted evidence** 消费。
- **FR-003** guide 扩充**查询**段：`scaffold-kb query`（markdown/json/`--probe`）真实输出 +
  KB MCP 三工具在 agent 里的典型调用链 + **厂商库/项目库双层命中**真实示例（含 `src=vendor|project` provenance）。
- **FR-004** guide 新增**接入工作流（F191）**段：`.specify/project-context.yaml` 的
  `knowledge_sources` 配置（`enabled/vendor_kb/project_kb/top_k/max_inject_chars`）+ specify 前
  预查注入行为（exit 恒 0、非阻断、untrusted evidence）。
- **FR-005** guide 新增**端到端 worked example**：用仓内 Hono（MIT 公开 SDK）demo fixture 走通
  build →（或直接用已构建 fixture）ingest 一份合成纪要 → query 双层命中 → 指向 spec-driver 接入。
- **FR-006** `docs/spectra-cli-reference.md` 与 guide 的交叉链接保持一致（已存在双向链接，按需补 ingest 源/退出码要点）。

## 回归护栏（硬约束）

- **G1 命令真实可跑**：所有示例命令与输出必须在本仓库 / 公开 SDK 上实测过，**不编造 flag / 输出**。
- **G2 通用定位红线**：worked example 用公开开源 SDK（Hono），**不写**任何具体客户 / 公司名 / 行业绑定。
- **G3 增量不破坏**：现有正确段落不重写，只增量扩充 / 必要微调。
- **G4 语言一致**：扩充段与现有 guide 一致用**英文**（开源 user-facing）。
- **G5 纯文档**：无生产代码改动；不动 `docs/shared/`（不触发 sync 链路）。

## Edge Cases

- ingest 全部源失败 → exit 1 + "所有源均失败，未落库"（不落库）。
- ingest 部分源失败 → exit 2（已落成功部分）。
- query KB 不可用 / 无命中 → exit 0 + 空 stdout（降级，不阻断）。
- office 文件解析：streaming + zip-bomb 守护；url 抓取：SSRF allow-list + IP-literal + 重定向重校验。
- F191 预查：未配 / 未装 spectra / 无命中 → 跳过注入，exit 恒 0。

## 验收标准（Acceptance Criteria）

- AC1：guide 含可照做的"导入文档（office/url/minutes）"段，含真实预览输出 + 两步安全流 + 退出码。【FR-002, G1】
- AC2：guide 含扩充的 build + query 示例（含 json/probe/双层命中真实输出）。【FR-001, FR-003, G1】
- AC3：guide 含 F191 接入工作流段（knowledge_sources 配置 + 预查行为）。【FR-004】
- AC4：guide 含端到端 worked example，命令实测跑通。【FR-005, G1】
- AC5：通用定位（无客户绑定）；现有结构不破坏；语言一致英文。【G2, G3, G4】
- AC6：`repo:check` + docs 同步链路绿；cli-reference 交叉链接一致。【FR-006, G5】
- AC7：收尾含 dogfooding 四维度反馈节（自己照 guide 跑一遍 ingest/build/query）。
