# M-3 预注册 — A/B 对照的 diff 选择（批 2 开始前冻结）

> measurement-design.md（已冻结）定义了 M-3 协议但未指定「同一份 diff」选哪份。
> 本文件在**批 2 尚不存在任何代码**的时点预注册该选择，杜绝事后按结果挑 diff。

## 预注册决定

**M-3 的 A/B 对照跑在「批 2（E1 coverage-gap）」的完整未提交 diff 上**，于批 2 门禁通过后、批 2 commit 前执行。

## 为什么是批 2 而不是批 1 / 批 3 / 全量

- **批 1 不行（会造成对 grounding 系统性不公平）**：批 1 改动 100% 落在 `plugins/**/*.mjs` 与 SKILL.md——前者结构性不在图内（O-5），grounding 包必然近空。A/B 两组在空 grounding 下无差异是**注定**的，测不出任何东西。
- **批 2 合适**：E1 改动集中在 `src/scaffold-kb/` 与 `src/kb-mcp/tools/`——全在图 walker 白名单内（`.ts`），且触及 F190-F192 既有链路（有真实 caller 网络可查），grounding 包有实质内容，A/B 才是对「grounding 有没有用」的公平测试。
- **批 3 备选降级**：若批 2 因故（配额/中断）未能执行 M-3，顺延到批 3 diff（同为 src/** 范围），并在报告里说明顺延原因。不再有第三顺位——批 2/3 都没跑成就按 OQ-1 如实报「M-3 未执行」。
- **不用全量 feature diff**：全量混入 plugins/**（图外）与 specs/**（文档）会稀释对照的分辨率。

## 执行细节（补齐 measurement-design 未定项）

- 两组子代理：同模型同档位（codex:codex-rescue 各一），prompt 除 grounding 包外**逐字相同**，同一消息内并行发起
- **grounding 包内容**（B 组独有）：对批 2 diff 中每个被修改的既有 symbol 跑 `impact`（upstream, depth 2）+ 对新增模块的直接依赖跑 `context`，原样附上（含 freshness 状态与 caveat——若 impact 报 0 caller 也**原样给**，不人工修正；grounding 的错误也是被测对象的一部分）
- 落盘：`pilot/m3/prompt-a.md`、`pilot/m3/prompt-b.md`、`pilot/m3/diff.hash`（diff 内容 SHA-256）、两组原始输出 `pilot/m3/output-a.md` / `output-b.md`
- 判读：编排器逐条判真伪（判读者非盲——此局限已在 measurement-design 声明）

冻结时点：批 1 已完成未提交、批 2 零代码。本文件此后不回改；执行偏离时在 pilot 报告「口径缺陷」节说明。
