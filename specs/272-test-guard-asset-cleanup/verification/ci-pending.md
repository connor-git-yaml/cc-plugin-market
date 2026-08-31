# CI 改动验收 — 已回填（F269 惯例）

**关联任务**：批 B T-B01 / T-B05 + 修复轮（`.github/workflows/ci.yml` 的 `Type Check Tests` 步骤）
**状态**：✅ **已验证** —— 真实 CI run 回填完成（2026-08-31）。

**回填依据的真实 CI run**：
https://github.com/connor-git-yaml/cc-plugin-market/actions/runs/33363928380
（commit `125bfdb3`，push 到 master 触发，**conclusion: success**，全部 12 个步骤 success）

> 历史说明：本文件初版由批 B implement 子代理创建时，步骤位置是「`Type Check` 之后、
> `Build` 之前」。随后异构对抗审查 W5 实证该位置会连坐吞掉下游信号（`tests/type-tests/`
> 的 `exactOptionalPropertyTypes: true` 比 `npm run lint` 更严，一次 lint/build 双绿的
> 生产改动就能让它单独红，进而 skip 掉 Test/Repo Check/Release Check——违反同一份
> ci.yml 里 F265 的「先拿测试结论」原则），修复轮已将其移到 `Release Check` 之后、
> 与治理链步骤并列并采用同款 `if:` 条件。下方观测点按**修复后的设计**回填。

## 五项观测点回填结果

1. **`Type Check Tests` 步骤是否被执行** —— ✅ 已执行且 success。真实步骤序列：
   `Checkout → Setup Node.js → Install Dependencies → Type Check → Build →
   Build Knowledge Graph → Test → Repo Check → Release Check → Type Check Tests →
   Test Plugins (mjs gate)`，全部 success。
2. **exit code** —— ✅ success（预期 0）。
3. **实际耗时** —— ✅ `06:37:00Z → 06:37:10Z` 约 **10s**（含 npm 脚本启动开销；本地
   ~2.4s，CI 为 4 vCPU 共享 runner，同一数量级内，无异常偏离）。
4. **流水线相对位置** —— ✅ 排在 `Release Check` 之后、`Test Plugins` 之前（修复轮设计），
   带 `if: ${{ !cancelled() && steps.build.outcome == 'success' && steps.graph.outcome == 'success' }}`
   ——不受 Test 连坐、但以 build+graph 成功为前提，与 Repo Check / Release Check 同款。
   既有步骤相对顺序零改动（F269 的 `VITEST_MAX_FORKS` 段逐字未动）。
5. **与并行卡的 `ci.yml` 冲突** —— ✅ 本卡 push 时 master 位于 `f7a65aa9`（fetch 复核
   behind=0），fast-forward 交付无冲突。后续 F271（`730d5213`）rebase 到本卡之上交付，
   按「后 ship 者 rebase 重验」纪律由其侧完成。

## 附加回填：两道新守卫在 CI 干净 checkout 上的行为（verification-report §7 的第三项）

- **零执行测试文件守卫**：`✓ tests/integration/zero-execution-test-file-guard.test.ts (1 test) 717ms`
  —— 干净 checkout（无嵌套 worktree、无未 stage 删除）上通过。
- **pinned 陈旧守卫**：`✓ tests/integration/graph-quality-pinned-staleness.test.ts (6 tests) 3097ms`，
  且 CI 日志**如实可见** Python 项的诚实缺席输出：

  ```
  [pinned-staleness] Python 未核验（诚实缺席，非静默跳过）: 外部源 clone 不存在:
  /home/runner/.spectra-baselines/micrograd（可设置 SPECTRA_BASELINE_HOME 环境变量
  覆盖家目录，或参照 scripts/baselines/clone-baseline-projects.sh 手动 clone micrograd 后重跑）
  ```

  这正是 F266「诚实缺席优于静默跳过」要求的形态：CI 上 Python 那份没被核验这件事
  **在日志里看得见**，而不是无声跳过。

## 本地已验证的部分（原 PENDING 节记录，保留存档）

- 本地实跑 `npm run typecheck:tests`：exit 0，~2.2-2.4s
- 变异验证（T-B02/T-B03/T-B04）：分别临时破坏 F220/F222/F170c 三份类型契约资产依赖的
  生产类型定义，均能报出对应编译错误并非零退出；撤销后恢复 exit 0
- 修复轮追加：删除 `tests/type-tests/tsconfig.json` 冗余 include 后，移走 F170c 资产
  会报 `TS18003`（修复前该场景静默 exit 0）

---

_初版由批 B implement 子代理创建；回填由编排器于 2026-08-31 完成，
遵循 CLAUDE.local.md「CI 改动验收走 F269 惯例：报告先落盘 + PENDING 节 + 真实 CI run 回填」。_
