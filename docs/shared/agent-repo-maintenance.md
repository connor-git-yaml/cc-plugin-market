## 仓库级同步约定

- 触及 source-of-truth、包装层、共享片段、产品生成产物后，优先运行 `npm run repo:sync`
- 提交前运行 `npm run repo:check`；仓库级 `check-plugin-sync.sh` 已退化为对该校验链路的薄壳调用
- `repo:sync` 末步会在图 stale / 缺失 / 无法评估时顺带 `spectra batch --mode graph-only` 重建（纯 AST、零 LLM）。工作树有未提交的采集面改动（源码或 `.gitignore`）时**跳过不重建**——「触及源码后先跑 repo:sync」的那一刻树必然脏，要让这一步真的重建须在干净树上再跑一次；dist 的 build-meta commit 不等于当前 HEAD 时也跳过（先 `npm run build`）。每一步的 action / before / after / error 打在 `[repo-sync]` 输出里。`graph-quality:freshness` 的 source-commit 判定看「图记录的 sourceCommit 与当前 HEAD 两棵树之间采集面源码（含 `.gitignore`）是否有差异」，只改文档 / 账本 / 图产物的 commit 不再触发 stale；脏树上建的图会记 `sourceTreeDirty`，树干净后判 stale 要求重建
- `.specify/runs/`、`.specify/.spec-driver-path`、`.claude/settings.local.json` 属于本地运行态，保持忽略，不要当作长期人工事实源
- `.claude/commands/**`、`.specify/project-context.yaml`、`.specify/templates/**` 属于受控项目层，修改前先确认不是某个 contract/sync 入口的生成产物
