---
required: false
mode: fix
points_count: 1
tools: [openrouter-perplexity/web_search]
queries:
  - 'vitest "Timeout calling" "onTaskUpdate" unhandled error worker RPC 60s timeout — GitHub issue status, which vitest version fixed this, is the birpc timeout configurable in vitest 3.2 or vitest 4'
findings:
  - '上游对应 issue 为 vitest-dev/vitest#8164（2025 创建，检索时仍 open）：>60s 的场景即使测试最终通过也会抛 [vitest-worker]: Timeout calling "onTaskUpdate"，vitest 自身提示 unhandled error 可能造成 false positive'
  - '早期同族 issue #4497（2023）：[birpc] timeout on calling "onTaskUpdate"，社区 workaround = 手改 bundle 内 DEFAULT_TIMEOUT（非官方 hack）'
  - 'birpc 层有 timeout 选项（默认 60_000）但 vitest 未把它暴露为用户配置；vitest 3.x / 4 文档中可配置的只有 testTimeout / teardownTimeout / browser.connectTimeout，均不影响 worker RPC 60s 超时'
  - '无任何公开记录表明某个 vitest 版本修复了该问题（a6e04bd8 仅改进错误信息含 caller 名）'
impacts_on_fix:
  - '排除修复策略方案 C（升级 vitest）：major 升级换不来修复，birpc 超时在 3.2 与 4 中均不可配置'
  - '确认收敛只能在负载/争抢侧做（本仓可控变量），不能在超时阈值侧做（上游硬编码）'
  - '#8164 的触发律（>60s 即触发、与 testTimeout 无关）与本仓 CI 数据（无 >60s 单测、饱和排队形态）共同支撑「压缩争抢裕度」为唯一在配置层可行的收敛方向'
skip_reason: ""
---

# F269 在线调研补充（自愿执行，项目未强制）

project-context 的 `online_research_required = false`，本文件为诚实留痕：诊断阶段实际
执行了 1 个在线调研点（上游修复状态核对），其结论直接决定了修复策略中方案 C 的排除。
调研问题、发现与对修复的影响见 frontmatter 结构化字段。
