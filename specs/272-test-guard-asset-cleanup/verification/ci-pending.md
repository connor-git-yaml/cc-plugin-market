# CI 改动验收 — PENDING 节（走 F269 惯例）

**关联任务**：批 B T-B01 / T-B05（`.github/workflows/ci.yml` 新增 `Type Check Tests` 步骤）
**状态**：⏳ **PENDING** —— CI 改动本地无法验证真实 GitHub Actions 执行结果，待本卡分支 push 后
触发真实 CI run 回填。回填前不得声称"CI 已验证通过"。

## 本地已验证的部分（不需要真实 CI 回填）

- `git diff .github/workflows/ci.yml`：只新增了一个独立步骤 `Type Check Tests`（`run: npm run typecheck:tests`），
  紧接在既有 `Type Check` 之后、`Build` 之前；**未修改任何既有步骤的内容**（决策 1 硬约束，
  收窄与并行卡 F270/F271 的 diff 重叠面）。
- 本地实跑 `npm run typecheck:tests`：exit 0，耗时 ~2.2-2.4s。
- 变异验证（T-B02/T-B03/T-B04）：分别临时破坏 F220/F222/F170c 三份类型契约资产所依赖的
  生产代码类型定义，确认 `npm run typecheck:tests` 均能报出对应的编译错误并非零退出，
  撤销后确认恢复 exit 0（详见本次 implement 报告）。这证明该步骤本身的判据逻辑是真实有效的，
  但**不能替代**"该步骤真的会在 GitHub Actions 环境里被执行且产出预期 exit code"这一事实——
  本地 `npm run typecheck:tests` 与 CI runner 上跑同一条命令，理论上应该一致，但 CI 环境的
  Node 版本、依赖安装方式（`npm ci` vs 本地 `npm install`）、并发资源限制等因素历史上多次
  制造过"本地绿、CI 红"的落差（见 F232/F233/F235 系列教训），因此仍需真实 run 回填才能算完全验收。

## 待回填的具体观测点

CI run 触发后（本卡分支 push 到远端并产生一次真实 GitHub Actions run），需回填以下内容：

1. **`Type Check Tests` 步骤是否被执行**：确认它出现在 job 步骤列表中，且未被跳过
   （本步骤未加 `if:` 条件，默认 `if: success()`，理论上只要前置的 Checkout/Setup Node/
   Install/Type Check 均成功就会执行）。
2. **该步骤的 exit code**：预期 0（本地验证结果）。若非 0，需贴出具体报错并排查是否为
   CI 环境特有的差异（Node 版本、依赖锁定等）而非本卡改动的缺陷。
3. **该步骤的实际耗时**：预期与本地 ~2.2-2.4s 量级相近（不要求精确一致，但应在同一数量级，
   若显著偏离需排查是否 CI runner 资源受限导致）。
4. **该步骤在流水线中的相对位置是否符合预期**：确认排在 `Type Check` 之后、`Build` 之前，
   且未打乱 `Build Knowledge Graph` / `Test` / `Repo Check` / `Release Check` /
   `Test Plugins` 等后续步骤的既有相对顺序（决策 1 的"只插入不修改"约束的真实生效证据）。
5. **与并行卡 F270/F271 的 `ci.yml` 改动是否冲突**：若本卡 push 时 `ci.yml` 已被
   F270/F271 先行修改，需确认已按交付纪律完成 rebase，且插入位置在 rebase 后依旧成立。

## 回填方式

回填时用真实 CI run 的 URL（`https://github.com/<org>/<repo>/actions/runs/<run_id>`）替换本节，
并将上方 5 项观测点逐条填入实际结果；全部确认符合预期后，本文件的状态字段改为
**✅ 已验证**，或如实记录发现的偏差与后续处置（例如另开 Fix 卡跟进）。

---

_本文件由批 B（③+④+⑤）implement 子代理创建，遵循 CLAUDE.local.md「CI 改动验收走 F269 惯例：
报告先落盘 + PENDING 节 + 真实 CI run 回填」的约定。_
