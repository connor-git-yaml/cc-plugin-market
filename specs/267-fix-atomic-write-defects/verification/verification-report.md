# F267 验证报告

## 验收结论：达成（0 CRITICAL）

7 条点名缺陷（D1-D7）全部修复并经独立复现确认；对抗审查另发现 3 条 CRITICAL（其中 2 条是
**修复本身引入**的破坏面），全部处置完毕。

## 工具链验证

| 项 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `npx vitest run` | **531 files / 7525 tests 全绿**，0 失败（exit 0） |
| 类型检查 / 构建 | `npm run build` | 零错误 |
| 仓库同步校验 | `npm run repo:check` | exit 0（仅 1 条既有 graph freshness warn，与本卡无关） |
| 本卡相关套件 | 5 个文件定向跑 | 143 passed |

全量跑批曾三次出现 7-10 个失败，已按「隔离绿 + 零交集 + 预存清单」判为**满载 flake**，
第 4 次低负载全量跑批 100% 绿追认该判定。取证见 `full-suite-flake-evidence.md`。

## D1-D7 翻转验证（复现脚本，见 `repro/`）

| 缺陷 | 修复前 | 修复后 |
|------|--------|--------|
| D1 软链拆链 | `isSymlink=false`，真实文件未更新 | `isSymlink=true`，真实文件收到更新 |
| D2 mode 放宽 | 600 → 644 | 600 → **600**；新建 600 |
| D3 并发互截 | 80 次尝试中 3 次 `WRITE-ERR ENOENT` | ENOENT **0** 次，payload 完整，tmp 残渣 0 |
| D4 失败不清理 | 异常分支无清理 | 清理到位，且 EEXIST 时**不误删别人的文件** |
| D5 脚本 chmod 放宽 | 700 → 755 | 700 → **700** |
| D6 `.bak` 被顶掉 | precious 备份被覆盖 | 保留最早一份；remove 后 `.bak` 仍在 |
| D7 `.find` 首匹配 | 畸形段在前 → `absent` | 畸形段在前/不在前**结论一致**（`found`） |

## [Spec 合规]

- **PASS** — 5 个生产消费方逐一评估落地：`grep` 核实 3 个我方产物消费方**不传** `followSymlinks`，
  2 个 hook 消费方**均传 `true`**，与 fix-report 声称一致
- **PASS** — 4 处我方产物 tmp+rename 站点未改动，理由在 fix-report 逐条写明
- **PASS** —「保全≠加固」守住：0666 文件、0777 脚本均如实保全，未顺手收紧
- **PASS** — 不碰清单遵守：`git-hook-installer.ts` / `module-derivation.ts` / `doctor-core.mjs` 零改动
- **PASS** — 序列化面未变（不引尾换行），graph.json 字节稳定性不受影响

## [代码质量]

- **PASS** — 独立 verify 子代理做 **5 处变异测试，5 处全部被抓住**（readTargetMode 恒默认 /
  resolveWriteTarget 恒不跟随 / tmp 固定名 / chmod 恒 0755 / `.bak` 去掉 EXCL），
  证明新增测试有真实守护力而非纸面断言
- **PASS** — 注释事实性逐条核对，未发现"说假话"的论证（F262 有此先例）；I3 那处被抓到的
  不准确陈述已更正并留痕
- 修复的两条 WARNING（均在本卡制品内，已修）：
  1. `repro/verify-fixed-d1-d3.mjs` 的 D1 场景漏传 `followSymlinks: true` → 该演示对任何实现
     都输出"未修复"，是**断不出结果的死路径**。已补该 option，重跑确认 D1 真实通过
  2. `tasks.md` 26 个任务 0 个勾选 → 已全部勾选并补完成状态说明

## 回归护栏

| 护栏 | 结论 |
|------|------|
| F207 init gitignore 自举 | 未触及，相关测试绿 |
| F245 hook payload | 未触及，相关测试绿 |
| Claude 侧 SessionStart / PreToolUse hook 安装流 | `hook-installer` 29 个用例全绿 |
| `hook-installer-semantics-parity` | 23 个用例全绿，Claude/Codex 两侧语义合同未漂移 |

## 残余风险（已登记，非本卡收口）

`.claude/settings.json` 是 opt-in 跟随的唯一消费方，故仓库自带软链的写穿面在该路径上
**未完全关闭**（受害目标须是可解析 JSON）。彻底收口需归属边界校验或仓库自带软链识别，
超本卡点名范围，已转 dogfooding ledger 作后续卡候选。其余边界（W4 全局配置污染、
W5 孤儿 tmp 累积、W3 owner/group、I2 NAME_MAX）见 fix-report「已知边界」。
