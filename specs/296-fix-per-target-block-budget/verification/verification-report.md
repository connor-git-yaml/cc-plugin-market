# 验证报告：F291a per-target 阻断预算（M11 卡 B）

- 语料判别性：Tier 2 跨目标用例在 `git show HEAD:` 旧判定器上失败（B 首次 exit 0）、新判定器通过；无目标桶 / 兄弟桶 / 逐轮改名 / 重编号 / 推迟会话级五条在方案①（复合文件）下各自失败（两路审查实跑记录），方案①′通过。
- 套件：f291a 10/0、io 79/0、card-b 28/0、judge-cli 225/0、card-a 21/0、tier2 25/0、core 604/0；`npm run test:plugins` 2042/0。
- 合同：审计 schema 加 `targetDir` / `budgetKey`（非必填）；data-model §8 / judge-cli 合同已更新；设计稿 `docs/design/f291-…md` 记录方案① → ①′ 的证伪表。
- 对抗审查：A 角 3C/5W/6I、B 角 4C/8W/3I，CRITICAL 全部处置（表见 fix-report / 设计稿）；W-3「用例经 fail-open 门通过」随 legacy 回落删除而消失；W-4 8 轮语料保留为回归护栏并另加判别语料。
