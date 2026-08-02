# Spec 合规审查报告（Feature 238）

> 由 spec-review 子代理产出（编排器存档其返回报告；审查基线 = 修复轮前 200f887）。
> 修复轮（236de66）后的增量合规性由 verify 终验覆盖。

## 逐条 FR 状态

| FR | 状态 | 证据 |
|----|------|------|
| FR-101 | PASS | codex-skills.sh:69-79,213-222 SKILLS 数组+install_all 新增 spec-driver-refactor，无特例分支 |
| FR-102 | PASS | wrapper-source-of-truth.yaml:45-47 第9条 entry |
| FR-103 | PASS | codex-plugin-consistency.yaml:43 `waivers: []` |
| FR-104 | PASS | repo:check pass 零警告；结构上无 waiver+9/9 entries |
| FR-105 | PASS | spec-driver-codex-skills.test.ts:28-38,425 SPEC_DRIVER_SKILLS 9 项/toHaveLength(9) |
| FR-106 | PASS | codex-skills.sh:203-211 sync_plugin_distribution_copy 覆盖全部 SKILLS |
| FR-201 | PASS | detect-codex-capability.mjs:101-115（5s 超时、只读命令）；install_all 单次调用；test 断言 features-list/version 各恰 1 次 |
| FR-202 | PASS | classifySubprocessError try/catch 全面捕获，脚本层警告不阻断 |
| FR-203 | PASS | 七类 reason 全覆盖，判定优先级正确 |
| FR-204 | PASS | adapter 审计行与正文替换文案语义一致，均指向 sidecar+降级语义 |
| FR-205 | PASS | extract-wrapper-body.mjs 第 8 条替换为 capability-neutral 指针短语 |
| FR-206 | PASS | renderCapabilityMarkdown 三要素齐全；sidecar 路径写入 |
| FR-207 | PASS | .gitignore:134 `.codex/spec-driver-capability.md` |
| FR-208 | PASS | sidecar 每次 install 重探测+覆盖写，wrapper 恒中性无需重生 |
| FR-209 | PASS | 首 token 精确匹配+行末非空 token，容错列宽/多词 stage |
| FR-301 | PASS | 模型兼容行 tier 语义、无版本字面、无过度声明措辞 |
| FR-302 | PASS | 根 README / plugin README / configuration.md / config-template 全部零命中 |
| FR-303 | PASS | implement:670 / story:589 / resume:333 三处 tier 化，镜像同步零残留 |
| FR-304 | PASS | resolveCodexModelDecision 七类来源决策矩阵 + llm-client 上游短路 required；ResolvedCodexExecutionConfig 纯加法 |
| FR-305 | PASS | (a) delegated: 前缀进 LLMResponse.model；(b) getTimeoutForModel 前缀优先 300000ms；(c) hint 语义已明示 |
| FR-306 | PASS | 上游短路设计结构性互斥 + 专门回归测试（T4.7） |
| FR-307 | PASS | 同 FR-305(b) |
| FR-308 | 合法延后（SHOULD） | follow-ups.md FU-1 逐字摘录退出条件，字面量确证仍硬编码保留——非静默跳过 |
| FR-309 | PASS | E5 专项测试：显式 pin tier 必 required 且原样生效 |
| FR-310 | PASS | 门禁独立成文件不落自身扫描面；固定清单精确对齐；接入 repo:check 第14族 pass |

**合规率：24/24 MUST 全 PASS；1 条 SHOULD（FR-308）合规延后。**

## Edge Cases 抽查（4/8）

| # | 判定 | 证据 |
|---|------|------|
| E1 | PASS | ENOENT→binary-missing；install 仅警告；T3.3 覆盖 |
| E2 | PASS | timeout/command-failed 分类；T2.3 覆盖 |
| E5 | PASS | model-selection.test.ts 专项 |
| E7 | PASS | llm-client.test.ts T4.7 回归锁定 |

## Non-negotiable Constraints 核对

- F186 sha256 门禁：结构性满足（单 helper 两端共用）
- F213 双写链：sync_plugin_distribution_copy 统一 copy 全部 9 skill
- 一致性矩阵：waivers 清空、9 entries
- Claude 侧 diff 白名单：三份 canonical SKILL 命中均落在 Codex 条件句单一位置（编排器补充：已另行完成逐 hunk 机械核验——全部 diff = 3 文件 × 各 1 行，见 trace [21:07]）
- specs/src.spec.md 排除：零改动

## 结论

**COMPLIANT**（24/24 MUST 达成，FR-308 SHOULD 合规延后有退出条件记录）
- CRITICAL: 0；WARNING: 1（tasks.md checkbox 滞后——编排器已修）；INFO: 1（T6.5 版本评估——编排器已裁决 FU-4）
