---
feature: 239-worktree-local-state
title: 批 4（T029-T035）实现留痕 — hook 修复 + AGENTS.override.md + repo:check 第 14 族
status: done
created: 2026-08-02
tasks_basis: specs/239-worktree-local-state/tasks.md
batch3_basis: specs/239-worktree-local-state/implement-log-batch3.md
---

# 批 4 实现留痕（T029-T035）

批 3 已由主编排器复验并提交（aa2269f）。

---

## T029 [红测试] `tests/unit/worktree-lifecycle-hook.test.ts`

### 红态确认

```
命令: npx vitest run tests/unit/worktree-lifecycle-hook.test.ts
输出:
  × (a) 同步脚本非零退出时，其 stderr 内容在 hook 输出中可见，且 hook 自身 exit 0
    → expected '' to contain 'SYNC-FIXTURE-FAILURE-MARKER'
  × (b) PATH 剥离 node：warning 可见 + copy 与 SYMLINK_TARGETS 步骤仍完成 + exit 0
    → expected '' to contain 'node 不可用'
  Tests  2 failed | 2 passed (4)
```

红因与 W2 修正后的判据一致：hook 输出为**空字符串**——`2>/dev/null || true` 把 stderr 整段吞掉；
**不是** `set -e` 中断（批 3 的 `command -v node` 分支已在脚本内，脚本本身 exit 0 且步骤照常完成）。

### 用例构成

- (a) 固定 stderr 内容（`SYNC-FIXTURE-FAILURE-MARKER`）+ 非零退出码（7）的同步脚本 fixture
- (a2) 成功路径守护：脚本 exit 0 时不得追加"以退出码 N 结束"的失败注记
- (b) 真实 worktree fixture + **真实**同步脚本 + `PATH=/usr/bin:/bin`（保留 git/bash、剔除 node）：
  断言 warning 可见、`.env.local` copy 与 `CLAUDE.local.md` 软链仍完成、hook exit 0
- 同步脚本不存在时静默跳过并 exit 0（既有行为不回归）

---

## T030 [红测试] `AGENTS.override.md` ignored 前提

### 红态确认

```
命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts -t "AGENTS.override"
输出: × git check-ignore AGENTS.override.md 退出码为 0
        → expected 1 to be +0 // Object.is equality
```

退出码 1 = 未命中任何忽略规则，即 `.gitignore` 尚未收录该文件。另一条"不出现在 `.worktreeinclude`
内容中"首跑即绿（清单只有 `.env.local`），属交叉断言守护。

---

## T031 [红测试] 第 14 族接线证据（W4）

### 红态确认

```
命令: npx vitest run tests/integration/repo-maintenance-sync-check.test.ts -t "worktree-local-state"
输出: AssertionError: expected 0 to be greater than 0
```

红因：`validateRepository` 输出的 checks 集合中不存在任何 `worktree-local-state:` 前缀条目。
这条断言不可省——只断言"整体 pass"无法证明新族真被注册，一个**从未被调用**的 validator
同样不会产生 error。

---

## T032 [实现] hook `create` 分支

### ⚠ 与 T032 字面措辞的偏差（需主编排器确认）

tasks T032 写的是「**捕获** stderr，**非零退出时**打印捕获内容」；但 T029(b) 要求的场景是
**脚本以 0 退出**（node 缺失属"已降级但完成"）时那条 warning 必须可见。两者字面冲突：按
"只在非零时打印"实现，(b) 永远红。

处置：以 **T029 的可观察行为判据**为准（测试判据定义行为，实现措辞是草图），实现为
**stderr 直接透传** + 非零退出时**追加**一条失败注记：

```bash
SYNC_STATUS=0
bash scripts/sync-worktree-local-state.sh || SYNC_STATUS=$?
if [ "$SYNC_STATUS" -ne 0 ]; then
  echo "[worktree-lifecycle] 同步脚本以退出码 ${SYNC_STATUS} 结束（上方为其输出）；不阻断 worktree 创建。" >&2
fi
```

理由：FR-009 的目的是"降级与失败都别再静默"。若成功路径仍吞 stderr，本 feature 新增的
「状态文件写入跳过：node 不可用」等降级信号会在 hook 这一层重新变回静默——正是要修的病。
透传方案还省掉临时文件与清理路径。

**连带修订**：我自己写的 (a2) 原断言"成功时不出现 routine log"编码了被否决的那种解释，
已改为"成功时不出现失败注记 `同步脚本以退出码`"，同时正向断言常规输出确实透传。

### 转绿确认

```
命令: npx vitest run tests/unit/worktree-lifecycle-hook.test.ts
输出: Test Files 1 passed (1) / Tests 4 passed (4)
命令: bash -n plugins/spec-driver/hooks/worktree-lifecycle.sh   → 语法 OK
文件权限: -rwxr-xr-x（755 保持不变）
```

---

## T033 [实现] `.gitignore` 新增 `AGENTS.override.md`

紧邻既有 `CLAUDE.local.md`（同属 per-worktree 本地态）插入，附一行说明其"存在时取代
`AGENTS.md` 生效"的语义。

```
命令: git check-ignore -v AGENTS.override.md
输出: .gitignore:51:AGENTS.override.md	AGENTS.override.md   exit=0

命令: npx vitest run tests/unit/worktreeinclude-contract.test.ts
输出: Tests 29 passed (29)
```

---

## T034 [实现] 沙箱复制清单 + 第 14 族接入

顺序严格按 tasks：**先**补两个既有集成沙箱的复制清单，**再**注册新族——批 1 已确认
`validateWorktreeIncludeContract` 对"清单文件缺失"恒判 fail 且不因非 git 环境豁免，
不先补清单就会在接入瞬间打红两个既有测试。

- `tests/integration/spec-drift-repo-check-modes.test.ts`：`COPY_FILES` 数组 + `.worktreeinclude`
- `tests/integration/repo-maintenance-sync-check.test.ts`：`copyFile` 序列 + `.worktreeinclude`
- `scripts/lib/repo-maintenance-core.mjs`：照三段式接入
  `aggregateValidation('worktree-local-state', validateWorktreeLocalState({ projectRoot: resolvedRoot }), warnings, errors, checks)`
  —— `validateWorktreeLocalState` 是**同步**函数，无 `await`；注释显式写明这一点，与紧邻的
  F219 `await` 警示注释（漏 await 会让 `result.warnings ?? []` 退化为空数组造成静默假通过）
  并列，避免后人照抄时误加/误删 await

### 转绿确认

```
命令: npx vitest run tests/integration/repo-maintenance-sync-check.test.ts tests/integration/spec-drift-repo-check-modes.test.ts
输出: Test Files 2 passed (2) / Tests 8 passed (8)
```

两个既有沙箱测试原有的整体 `pass` 断言均未回归；非 git 沙箱内 `not-ignored` 子检查如设计降级
为 skip，未拖累族状态。

---

## T035 [回归验证] 批 4 checkpoint

```
命令: npx vitest run tests/unit/worktree-lifecycle-hook.test.ts \
        tests/integration/spec-drift-repo-check-modes.test.ts \
        tests/integration/repo-maintenance-sync-check.test.ts
输出: Test Files  3 passed (3) / Tests  12 passed (12)

命令: npm run repo:check
退出码: 0
第 14 族输出行:
  - worktree-local-state:worktreeinclude-exists: pass
  - worktree-local-state:worktreeinclude-entries: pass
  - worktree-local-state:worktreeinclude-ignored-verified: pass
  - worktree-local-state:agents-byte-budget: pass
整体: [repo-check] status=warn（唯一 warning 属 [graph-quality] 族：本 worktree 的图
      sourceCommit aa8f326 与 HEAD aa2269f 不一致，与本批改动无关；errors 段为空，故 exit 0）

命令: npx vitest run <F239 四个测试文件>
输出: Test Files  4 passed (4) / Tests  160 passed (160)   —— 批 1~3 零回归
```

---

## 意外与处置

| 现象 | 判定 | 处置 |
|---|---|---|
| **T032 字面措辞与 T029(b) 判据冲突**（"仅非零退出时打印" vs "脚本 exit 0 的降级 warning 必须可见"） | 规格内部冲突，非实现错误 | 以 T029 可观察判据为准：stderr 透传 + 非零时追加失败注记；理由与连带的 (a2) 断言修订已记在上方 T032 段落，**需主编排器确认** |
| T031 首版断言 `exitCode === 0` 在**未先跑 repo:sync** 的沙箱里失败（族断言本身已全绿） | 我的测试前置条件错，非产品缺陷：沙箱在 `beforeEach` 里刻意 `rmSync('.codex')`，由 repo:sync 重建；不 sync 直接 check 会因与本族无关的 codex 产物缺失而整体 fail | 照既有姊妹用例补一步 `repo-sync.mjs` 前置（并断言其 exitCode 0），再断言 check exitCode 0；已在用例内注释写明原因 |
| `npm run repo:check` 整体 status=warn | **非本批引入**：唯一 warning 来自 `[graph-quality]` 第 12 族（本 worktree 图已 stale，与批 3 冒烟里 `spectra graph-quality` 报的是同一事实） | 不处理。`repo-check.mjs` 仅在 `status === 'fail'` 时置非零退出码，故 exit 0，符合 T035 判据"0 失败" |
| hook 位于 `plugins/spec-driver/hooks/` | 该路径是回归护栏第 7 条**显式放行**的唯一 plugins 路径 | 仅改 `create` 分支，`remove` 分支与文件权限（755）原样未动 |
