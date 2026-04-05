# Tech Research

## 结论

- `072` 不需要新增新的子代理 prompt；复用现有 `plan / tasks / implement / spec-review / quality-review / verify` 已足够。
- `spec-driver-implement` 的价值在于**入口合同与阶段裁剪**，而不是重新实现一套编排引擎。
- 与 `resume` 的边界必须通过 Skill 文档、workflow registry 和 README 同时表达，不能只写在蓝图里。

## 采用方案

1. 新增独立 `spec-driver-implement` source skill
2. 复用现有 agent prompts，新增 implement-oriented 指令注入
3. 将 `implement` 接入 workflow registry、entity catalog、Codex 安装包装和产品事实文档
4. 不新增新的 gates，只复用 `GATE_TASKS` 与 `GATE_VERIFY`

## 不采用方案

- 不新增 `implement-review.md` 等额外制品：会扩大目录合同，收益不足
- 不让 `resume` 隐式代理到 `implement`：会模糊两个入口的职责
- 不为 `implement` 新造 agent 文件：会让维护成本高于收益
