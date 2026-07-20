# Requirements Checklist — Feature 213 Codex Plugin 一体分发（A1）

> 校验对象：`specs/213-codex-plugin-distribution/spec.md`（13 FR / 3 OQ / 6 SC）
> 生成方式：对照 `_grounding.md` 的 A1 权威范围与仓库实测事实逐条核验

## 1. 完整性（Completeness）

- [x] ✅ **两 manifest 均有对应 FR** — FR-001（Spectra `.codex-plugin/plugin.json`）、FR-002（Spec Driver `.codex-plugin/plugin.json`），字段来源（version/description← `release-contract.yaml`）明确约束一致。
- [x] ✅ **Spectra 一次装齐 skills+MCP+hooks 落地有 FR 支撑** — FR-003（`mcpServers` 引用 `.mcp.json`）、FR-004（`skills` 直引 canonical 目录，3 skill）、FR-006（hook 脚本随包 ship，manifest 不声明 hooks 字段）三条覆盖 US-1 全部验收场景。
- [x] ✅ **Spec Driver 一次装齐 wrapper skills+hooks 落地有 FR 支撑** — FR-005（`skills` 指向 Codex 适配 wrapper 目录，与 `wrapper-source-of-truth.yaml` 一致，且落位方式留 OQ-004 给 plan 阶段）、FR-006（同上 hooks 脚本随包 ship）覆盖 US-2 全部验收场景。
- [x] ✅ **一致性矩阵进双 check 链有 FR 支撑** — FR-007（`repo:check` 新增 check）、FR-008（`release:check` 的 `expectEqual` 累加器纳入版本字段）、FR-009（不新增独立命令，接入既有链），三条完整覆盖 US-3。
- [ ] ⚠️ **Key Entities 是否补全"marketplace catalog 与 wrapper 目录之间的显式引用关系"** — spec 第 101-107 行 Key Entities 分别定义了 4 个实体，但未显式写出"Codex 适配 Skills 目录"与"Marketplace Catalog"之间是否存在校验依赖（即 marketplace 条目的 `source.path` 是否要指向含该 skills 目录的 plugin 根，还是可以分离）；FR-013 的 schema 描述里只到 `plugins/<name>` 粒度，未细化到 skills 子目录，留给 plan 阶段可接受但建议在 spec 补一句避免 plan 阶段过度解读。

## 2. 一致性（Consistency）

- [x] ✅ **FR-005（wrapper 集合进 plugin）与 FR-012（waiver）不冲突** — FR-005 只约束"manifest 指向目录内容须与 wrapper contract entries 一致"，不要求 9 = 8；FR-012 单独处理"9 canonical vs 8 codex wrapper"的数量缺口显式豁免，二者作用对象不同（FR-005 是"目录内容对齐 contract"，FR-012 是"contract 本身固有的已知缺口在矩阵层面如何不误报"），无矛盾。
- [x] ✅ **FR-012（waiver）与 FR-013（marketplace + .agents 收窄）不冲突** — 两者是并列独立约束（一个管 skill 数量差异豁免，一个管 marketplace/gitignore/symlink 落地），Edge Cases 段（第 76、81 行）分别单独展开，未见交叉依赖导致的语义冲突。
- [x] ✅ **Non-Goals 与 FR 清单相互印证** — Non-Goals 明确排除 A2（对应 FR-012 waiver 而非补齐）、A3（对应 FR-006 止步于文件 ship）、A4（无对应 FR，spec 未触碰 CODEX_HOME）、"不削弱 Claude"（对应 FR-011）、"最小化收窄 .agents"（对应 FR-013 收尾一句）；未发现 FR 越界到 Non-Goals 范围的情况。
- [x] ✅ **Edge Cases 与对应 FR 一一对应** — 5 条 Edge Cases（第 76-81 行）分别可追溯到 FR-012、FR-005、FR-010、FR-008、FR-013，无孤立的 Edge Case 缺 FR 落地。

## 3. 可测性（Testability）

- [x] ✅ **FR-010 双层验证策略可执行** — 结构性断言（无 codex binary 时必选）与 `codex mcp list --json`（有 binary 时可选加强）分层明确，避免"唯一验收路径依赖不可控外部环境"的常见反模式。
- [x] ✅ **FR-007/FR-009 校验落点明确** — 指定新增 check 遵循既有 `aggregateValidation` 模式接入 `validateRepository()`，且明示"不新增独立命令"，可直接映射为 `scripts/lib/<name>-core.mjs` 的单元测试与 `repo:check` 集成测试。
- [ ] ⚠️ **FR-012 waiver 的"移除条件"验证方式未在 FR 文本内机械化** — FR-012 要求"Waiver 列表 MUST 可被后续 A2 移除对应条目而无需改动矩阵校验逻辑本身"，这是一个面向未来（A2）的架构约束，本 feature 验收时如何证明"确实不用改矩阵代码即可移除"缺少一个当下可执行的验证步骤（例如：单元测试用例模拟移除 waiver 条目后矩阵是否正确报出真实缺口）。建议 plan/tasks 阶段补一条测试用例覆盖"waiver 移除后矩阵能检出裸缺口"的路径，spec 层面可保留但需在 tasks 落实。
- [x] ✅ **SC 全部可机械验证，无人工目视残留** — 逐条复核：SC-001（结构性断言/CLI 二选一）、SC-002（数量与身份比对+waiver 呈现）、SC-003（100% 检出率的自动化断言）、SC-004（vitest/build/repo:check/release:check 零失败，均为命令退出码判定）、SC-005（"不新增失败"可用 CI 测试差异比对機械判定）、SC-006（git 树文件存在性 + worktree 操作后内容比对，均可脚本化）；未发现"人工目视确认""看起来合理"等主观表述。

## 4. 范围边界（Scope Boundary）

- [x] ✅ **A2/A3/A4 均被显式锁死** — Non-Goals 第 16-18 行逐条列出且各自给出边界依据（A2 waiver 化、A3 止步于文件 ship、A4 不碰 CODEX_HOME/plugins cache 路径歧义），并在 FR-006/FR-012 中有对应的"止步"措辞呼应，未见 FR 文本反向扩大到这三块范围。
- [x] ✅ **"不削弱 Claude"边界完整** — Non-Goals 第 19 行列出四类 Claude 侧 canonical 制品（`.claude-plugin/plugin.json`、`plugins/*/skills/`、`.mcp.json`、`plugins/*/hooks/hooks.json`）语义不变，FR-011 与 SC-005 双重兜底（一为约束声明，一为可测结果），构成闭环。
- [x] ✅ **marketplace 最小收窄边界明确** — Non-Goals 第 21 行精确限定收窄范围仅两处（`.gitignore` 显式放行规则、`SYMLINK_TARGETS` 从 `.agents` 收窄到 `.agents/skills`），并显式排除"更大范围 `.worktreeinclose` 基础设施重构"，避免了范围蔓延；FR-013 与该 Non-Goals 段落用词完全一致（无漂移）。
- [ ] ⚠️ **OQ-002 已给出"推荐选项 A"但仍标记为待拍板** — spec 第 132 行虽然基于实测证据推荐选项 A（ship marketplace），但仍保留为 Open Question 交 GATE_DESIGN 拍板；这是合理的治理流程（非缺陷），但若后续 plan 阶段读者未追溯到该行，可能误以为 FR-013 是无条件确定项。建议 GATE_DESIGN 环节明确记录拍板结果后，spec 状态应从 Draft 更新为已裁决，当前检查按"存在但需走完流程"计为 ⚠️ 而非 ❌。

## 5. 回归护栏（Regression Guardrail）

- [x] ✅ **F186 body-sha256 链的持续有效性被显式约束** — FR-005 末句明确"已有的 F186 body-sha256 盖章链 MUST 继续对该目录内容生效，不得因落位变化而失效"，防止本 feature 改动 skills 目录落位时意外破坏既有防漂移机制。
- [x] ✅ **release-contract 版本字段纳管，防止重蹈 F186 之前多处手改覆辙** — FR-008 + Edge Cases 第 79 行明确指出"若两者各自维护版本号会重新引入 F186 之前的旧问题"，并给出具体纳管路径（`expectEqual` 累加器）。
- [x] ✅ **`local` 版本缓存值的误报风险已识别** — Edge Cases 第 80 行显式要求矩阵校验版本号时排除/特殊处理开发态 `local` 值，避免 CI/本地开发环境下的假阳性拦截。
- [x] ✅ **worktree symlink 收窄不破坏现有 `.agents/skills` 共享行为** — FR-013 + Edge Cases 第 81 行明确"收窄到 `.agents/skills`"而非完全移除 symlink，保留了 `generate-readme` skill 等既有跨 worktree 共享机制，只精确剥离 `marketplace.json` 所在的 `plugins/` 子路径。
- [x] ✅ **双运行时回归判定标准明确（非"看起来没坏"）** — SC-004 + SC-005 联合构成"零失败 + 结果逐条一致（不新增失败也不意外变绿）"的双重护栏，避免测试通过率虚高掩盖真实回归。

---

## 汇总

- ✅ 通过：**15** 项
- ⚠️ 需关注（非阻塞，建议 plan/tasks 阶段跟进）：**3** 项
- ❌ 未通过：**0** 项

### ⚠️ 项列表（均非阻塞性缺陷，建议后续阶段处理）

1. **完整性组** — Key Entities 未显式写出"Codex 适配 Skills 目录"与"Marketplace Catalog"之间的引用粒度关系，建议 plan 阶段明确 marketplace `source.path` 是否需要下钻到 skills 子目录。
2. **可测性组** — FR-012 waiver"移除后矩阵能检出真实缺口"这一面向未来（A2）的验证路径，本 feature 当下缺一条机械化测试用例锚定，建议 tasks 阶段补充。
3. **范围边界组** — OQ-002 虽已给出推荐选项 A 并附实测证据，但仍待 GATE_DESIGN 正式拍板归档，spec 状态需在拍板后同步更新，避免 plan 阶段误读为无条件确定项。

无 ❌ 项，spec 可进入 GATE_DESIGN（用户对 OQ-001/OQ-002/OQ-004 拍板）阶段。
