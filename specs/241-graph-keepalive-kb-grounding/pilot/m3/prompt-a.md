对下述 diff 做对抗性代码审查（adversarial review）。假设实现有 bug，尝试证伪。

## 环境
- 工作目录：/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe
- 禁止 git 写操作 / 禁止修改任何文件 / 禁止 spectra graph、spectra batch
- 只读命令与只读 node 单文件测试可用

## 需求背景
这是 F241 批 2（E1 coverage-gap）：为 KB 检索链新增 no-hit telemetry（默认关闭，env SPECTRA_KB_NOHIT_TELEMETRY 指定目录才开）、查询 redaction（六类结构性遮蔽）、最小出现阈值聚合（distinctQueries≥2 才进 backlog）、三态区分（collection-disabled/no-data/no-gap-above-threshold）、CLI coverage-gap 子命令。核心红线：治理层绝不影响主检索链路（结果与退出码逐字节不变）；落盘无整串查询（只有 redaction 后 token + hash）；隐私默认关闭。

## 审查对象
完整 diff 见 specs/241-graph-keepalive-kb-grounding/pilot/m3/batch2.diff（1918 行，含 4 个新模块 + 3 个新测试 + 挂点改动）。逐文件读。

## 输出
CRITICAL / WARNING / INFO 三档；每条含文件:行号、可证伪输入/命令、建议处置。已攻击未发现问题的面也列出。
