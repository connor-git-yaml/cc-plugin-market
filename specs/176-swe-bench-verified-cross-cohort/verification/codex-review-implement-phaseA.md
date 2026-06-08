---
feature: 176
phase: Implement（Phase A 地基 + cohort3 spike）— Codex 对抗审查记录
date: 2026-06-09
reviewers: Codex (codex-rescue) + Claude (main-thread, sandbox 实测验证)
scope: scripts/lib/{swe-bench-verified-paths,spectra-version-gate,spike-fixture-prep}.mjs + scripts/{spike-cohort3-plugin-mcp,build-spectra-stamped}.mjs
---

# F176 Implement 第一批（Phase A + spike）对抗审查 — 处置记录

> Codex：3 CRITICAL + 4 WARNING + 1 INFO。全处置并 sandbox 实测验证。

| 档位 | finding | 处置 + 验证 |
|------|---------|------------|
| 🔴 C-1 | 版本门禁可被"盖章后重 tsc 换实现不重盖章"绕过（staleness 只比 src vs dist，没绑 dist 内容）| stampBuild 记录 **dist 树 sha256**（259 文件 merkle-ish），verify 重算比对；harness 调用点 `allowDirty:false`。**实测**：盖章后篡改 dist → FAIL「内容与盖章指纹不符」；dirty 树 + allowDirty:false → FAIL |
| 🔴 C-2 | spike PASS 忽略 claude 进程失败（401/timeout 可误判）| 先判 `r.status===0 && !r.signal && !r.error` + 401 正则 → 新增 **ERROR_INFRA** 状态，与 wiring FAIL 区分 |
| 🔴 C-3 | spike PASS 不能证明 **sub-agent** 可达 plugin MCP（顶层 allowedTools 让 driver 自己也能调）| prompt 改为**显式禁止 driver 自调、强制 spawn Task 子代理由子代理调 MCP**；解析新增 taskCallCount + pluginAfterTask；分级 **PASS_SUBAGENT / PASS_DRIVER_ONLY / FAIL**，仅 PASS_SUBAGENT 解锁 Phase C；归因弱时提示 host 查子代理 .jsonl |
| 🟡 W-1 | 解析器漏 partial/delta/start/stop 包装层的 tool_use | collectToolUseNames 改**全递归**遍历任意层级 object/array。**实测**：tool_use 藏 event.block 也能抓到（单测覆盖）|
| 🟡 W-2 | 固定 tmp 路径并行/残留互删 | fixture + plugin dir 均改 `fs.mkdtemp` 唯一目录 |
| 🟡 W-3 | 本地 plugin 名 "spectra" 与全局已装冲突 | 保留名 "spectra"（命名空间需要）+ `detectGlobalSpectraPlugin` 警示 + result 记 globalConflict 字段 |
| 🟡 W-4 | sentinel 用 7 位短 hash 有 ambiguous 风险 | 改 **40 位完整 SHA**（e23c623fa…/989bf9b0a…）|
| ℹ️ INFO | 未触碰 eval-task-runner/buildClaudeArgs，无既有管线回归 | 确认（Phase C 才动共享函数）|

## Claude 自审（与 codex 部分重叠/独立）
- spike prompt 强化要求显式调 MCP（防"agent 这次没用到 MCP"的假阴性）—— 与 C-3 合并实现。
- 版本门禁关键洞察（sandbox 实测）：`node dist/cli/index.js --version` 对本地 build 与 npm 旧版**都报 v4.2.0** → 版本号不可作门禁依据，必须 commit 祖先 + dist 内容指纹。

## 验证汇总（sandbox 可验证部分）
- 版本门禁：positive PASS / 篡改 FAIL / 非祖先 FAIL / dirty+clean-req FAIL —— 全绿
- spike：--dry-run 解析 OK；单测 13/13；ERROR_INFRA/PASS_SUBAGENT/PASS_DRIVER_ONLY/FAIL 分级逻辑就位
- 真实 spike PASS/FAIL 仍须 host 跑（sandbox claude 401）—— 不在此处伪造
