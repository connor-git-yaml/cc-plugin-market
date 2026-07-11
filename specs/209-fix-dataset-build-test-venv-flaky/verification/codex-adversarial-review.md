# Codex 提交前对抗审查 — F209(处置记录)

> 审查代理:codex:codex-rescue(只读约束下执行)。结论:CRITICAL 0 / WARNING 3 / INFO 5;总判定"可提交,但提交前应确认 specs/src.spec.md 是否属于本次变更,并建议加强正向 fetch-path 断言"。以下为主编排器逐条处置。

## WARNING 处置

**W-1 范围不一致:`git diff --stat` 显示 specs/src.spec.md 存在 tracked diff(lastUpdated / durationMs 元数据变化)**
- 查证:diff 内容为自动再生元数据(`lastUpdated: 2026-07-08 → 2026-07-11`、`durationMs: 3502 → 5713`、baseline-skeleton 尾注),系流程环节触发的 spectra 再生盖章,与本次修复无关(既往约定:自动再生的 specs/src.spec.md 排除出 commit,勿 git add -A)
- 处置:**已还原**(`git checkout -- specs/src.spec.md`),commit 使用显式路径

**W-2 断言偏弱:目标用例仅断言 status!==0 + 两条 stderr 反向 not.toMatch;若子进程未跑到 fetch 且 stderr 为空,三条断言恒真(守卫回归可漏检)**
- 定性:既有断言盲区(非本次注入引入),但直接关系本次要保障的测试目的("W-1 守卫放行"从反向推断升级为正向证明),属边界遗漏档 → 提交前修复
- 处置:**已采纳**,追加正向断言 `expect(res.stderr).toMatch(/swebench_fetch_rows\.py 失败/)`(锚定失败来源于 fetch 阶段 = 守卫已放行;仍不验证 fetch 成败,测试目的不变;错误文案与 scripts/lib/swebench-dataset-build.mjs:61 一致,同文件 L94/L102 已有 match 报错文案先例)
- 重验:隔离跑 9/9 passed,目标用例 20ms;全量 5067 passed 零失败;build 零错误

**W-3 覆盖差异:原用例隐式覆盖 CLI 默认 `venvPath = 'scripts/.swebench-venv'` 分支,新用例走 `--venv` 覆盖分支,默认路径分支不再被该用例覆盖**
- codex 自评:可接受(用例目标是 W-1 dataset 标签守卫而非 venv 默认路径,且默认路径正是 flaky 根因)
- 处置:**记录不动**。默认分支的行为(相对 cwd 解析)本质依赖本机状态,不适合在单测中真跑;如未来需要覆盖,应以纯 argv 解析单测形式补(不 spawn 真 python),届时另立任务

## INFO 摘录(无需动作)

- 目标文件 diff 与描述一致;失败链(ENOENT → status=null → throw → uncaught → exit 1)经源码核验成立;status===0 边界基本排除(唯一理论例外为临时目录被外部并发创建可执行 python,忽略)
- tests/ 下仅该文件引用 swebench-dataset-build CLI,无同类遗漏;真 SWE-bench smoke 由 env gate 跳过;其他真实子进程测试均有隔离或 gate(API key gate / HOST_E2E gate / 临时 shim + 受控 PATH)

## 处置后最终验证

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/unit/feature-187-dataset-build.test.ts --project unit` | 9/9 passed,目标用例 20ms(原 ~4100ms) |
| `npx vitest run`(全量) | 428 files passed \| 4 skipped;5067 tests passed \| 18 skipped \| 21 todo,零失败 |
| `npm run build` | exit 0,tsc 零类型错误 |
