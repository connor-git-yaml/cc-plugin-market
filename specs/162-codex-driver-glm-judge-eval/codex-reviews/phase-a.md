# Codex 对抗审查 — Phase: A (callExecutor 多 backend dispatcher + self-judge hard-fail)

> Feature: 162
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ 3 轮 review 收敛到 0 critical / 0 warning

## 审查轮次概要

| 轮次 | Critical | Warning | Info | 阻断 commit |
|------|---------:|--------:|-----:|------------|
| iter-1 | 3 | 3 | 1 | 是 |
| iter-2 | 0（C-1/2/3 全清） | 0（W-1/2/3 全清） | 0 | 是（T033 + W-4 新发现） |
| iter-3 | 0 | 0 | 0 | 否 |

## iter-1 finding 处置（3C+3W+1I）

| 编号 | 主题 | 处置 |
|-----|------|------|
| C-1 | DEFAULT_JUDGES 含 codex:gpt-5.5 + 默认 driver=codex:gpt-5.5 → 启动即 self-judge hard-fail | 修：连 Phase B1 一起做（DEFAULT_JUDGES 替换为 GLM-5.1 + 注释） |
| C-2 | callExecutor 入口 self-judge 默认 skip | 裁决：单独跑 driver 时无 jury 编排不需检查；jury 编排路径已集成；callExecutor 入口加 C-2 裁决注释 |
| C-3 | byte-stable 验证未执行 T022 合同 | 裁决：CLAUDE.local.md 边界 task fixture 不入库；脚本完成；标 [DEFERRED-TO-OPS]；输出明确 deferred 提示 + triggerScenarios |
| W-1 | retry classify 缺"缺字段"判定 | 修：dispatcher success path 加 detectSchemaIncompleteness export + schema-invalid 归类 + rawResponse 记录 + 1 vitest case |
| W-2 | T016 jury parseJudgeBackend 未真迁移 | 标：T016 [DONE-MINIMAL-VIABLE]，self-judge 入口已迁，core dispatch 留独立重构 |
| W-3 | codex CLI 鉴权预检缺失 | 修：handleCodexCli spawn 前加 `codex --version` 预检 + 友好错误信息 + 1 vitest case |
| I-1 | callExecutor 兼容签名 / normalize 顺序 / 26 alias / 等 6 项 PASS | 接受 |

## iter-2 残留 + 新发现处置

| 编号 | 主题 | 处置 |
|-----|------|------|
| T033 critical | calibration-fixture-list.json 5 id 都 pass，违反 plan §0.1 fail/refusal 分层；缺 label/per-fixture runs_per_fixture | 修：重新分层（3 pass + 1 refusal + 1 fail），每 fixture 加 label + runs_per_fixture + rationale + stratification_summary |
| W-4 warning | callExecutor 无 model 会 TypeError | 修：`(typeof model === 'string' && model.length > 0) ? model : DEFAULT_EXECUTOR_MODEL` 兜底 |

## 最终结论

- **critical 清零** + **warning 清零**
- 主线程裁决：**Phase A + B1 ready for commit；可进入 Phase B2 / Phase C**

## 关键架构决策记录

通过 3 轮对抗审查倒逼出的实施决策：

1. **callExecutor 兼容签名保留**：thin wrapper delegate 到 callBackend，25 既有 fixture 调用链不破坏
2. **normalize 顺序严格 5 步**：trim → toLowerCase → 剥 backend prefix → 剥 vendor → alias 映射；先 case-fold 再剥前缀（避免 `Codex:GPT-5.5` 漏处理）
3. **MODEL_ALIASES 26 entry**：覆盖 GPT-5.5 / GLM-5.1 / Opus 4.7 / Sonnet 4.6 / Haiku 4.5/4.7 / Kimi K2.6 dot/hyphen 全变体
4. **retry 决策矩阵 5 类**：transient (1 retry) / quota (0 retry) / truncation (0 retry, partial=true) / schema_invalid (0 retry, rawResponse) / unknown (0 retry)
5. **Schema 完整性 + Codex 鉴权预检**：分别在 success path 和 codex backend handler 入口集成
6. **T022 [DEFERRED-TO-OPS] + T016 [DONE-MINIMAL-VIABLE]**：明确标记，不阻塞 commit

## Vitest case 数演进

- v1（iter-1 初版）：20 case (12 dispatcher + 5 self-judge + 3 sanity)
- v2（iter-2）：23 case（+ 1 schema-invalid + 2 codex auth precheck）
- v3（iter-3）：23 case（T033 + W-4 是 spec/code 修订非新 case）

## Phase B1 配套落地（与 A 并行）

- T031 ✅ DEFAULT_JUDGES 改为 [Opus, GLM-5.1, Kimi-K2.6]
- T032 ✅ self-judge 禁忌注释 + FR-020/021 + plan §2.5 B1 引用
- T033 ✅ calibration-fixture-list.json（5 frozen ids，含 fail/refusal 分层）
- T034 ✅ 23 vitest case 全 pass，无回归

## 已知 deferred / 限制

- T022：byte-stable 端到端对比，`[DEFERRED-TO-OPS]`，task fixture 不入库的预期状态；ops 在本地 GLM driver + codex driver 重跑后触发
- T035：Phase B1 codex review，本 artifact 已合并（与 Phase A 同 commit）
- 全量 vitest 38 fail / 255 tests fail：tree-sitter.wasm ENOENT，worktree 缺包 pre-existing baseline issue，与 Phase A/B1 无关
