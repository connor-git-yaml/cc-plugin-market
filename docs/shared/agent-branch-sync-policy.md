## 分支同步与交付约定

### 开发中的分支同步

- `feature/*`、`fix/*` 等开发分支在提交前，必须先同步最新 `master`
- 同步方式统一使用 `git rebase master`，不要把 `master` 直接 merge 回开发分支
- 推荐流程：`git checkout master` → `git pull --ff-only` → `git checkout <feature-or-fix-branch>` → `git rebase master`
- rebase 后先解决冲突并完成必要验证，再执行 commit / push
- 如果分支已经推送到远端，rebase 改写历史后使用 `git push --force-with-lease`

### 交付到 master

- 本项目统一采用 **Rebase + Push Origin Master** 方式交付：所有 `feature/*`、`fix/*` 分支的最终集成都通过 "rebase 到 master + fast-forward push 到 `origin master`" 完成，保持 master 历史线性
- 禁止使用 merge commit 交付（不使用 `git merge <feature-branch>`，也不使用 GitHub PR 的 "Create a merge commit" 按钮）；如果必须经由 PR 流程，统一选 "Rebase and merge"
- 交付硬性顺序（任一步失败必须停止）：(1) `git fetch origin master:master` → (2) `git rebase master` → (3) 本地跑 `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check`（如涉及发布）零失败 → (4) `git checkout master` + `git merge --ff-only <branch>` → (5) `git push origin master`
- 交付后立即删除本地和远端的 feature/fix 分支（`git branch -d <branch>` + `git push origin --delete <branch>`），避免分支膨胀
- Push 到 `origin master` 是破坏性 + 不可回滚操作（团队其他人可能已经基于新 master 工作），必须获得用户明确授权，且一次授权只对当次交付生效（沿用"不要把一次授权当成长期授权"原则）
- 多人并行的 feature/fix 分支交付时，先交付的先 push；后交付的必须重新 rebase 最新 master 并重跑验证才能 push，不允许 force push master
