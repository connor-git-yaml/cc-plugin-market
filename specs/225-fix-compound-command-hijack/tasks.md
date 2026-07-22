---
feature: 225-fix-compound-command-hijack
mode: fix
based_on: fix-report.md + plan.md（方案 A：子命令切分 + 同段共现判据，设计已定稿，本文件不重新设计）
baseline_commit: 7b0d7b3
---

# 任务分解

## 范围与约束（来自 plan.md，逐字遵守）

- 唯一改动文件：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（源码）+
  `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（测试，仅新增，不改既有断言）
- 不改 `plugins/spec-driver/scripts/fix-compliance-judge.mjs`
- 不改 `ARTIFACT_PATH_REGEX` / `BASH_WRITE_INDICATOR_REGEX` 的模式与导出状态
- 不改 `resolveFeatureDirCandidate` 的签名与 `{path}` 返回形状
- 新增 `splitBashSubcommands` / `hasBashWriteIndicator` 保持模块私有（不 `export`）
- **TDD 顺序**：Phase 1（红测试）必须先落地并确认失败，Phase 2（实现）才能开始；Phase 2 完成后 Phase 1 的用例应全部转绿

---

## Phase 1：红测试先行（实现前必须失败）

> 全部新增用例统一追加在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 的
> `describe('codex C-2：特性目录提名必须锚定 artifact 路径 + Bash 写指示符', ...)` 块内（现有 L507-544），
> 复用块内已定义的 `user` / `bash` / `write` 三个闭包（L508-513）。**严禁修改或删除该块内 L515-543 现有 6 条 `it`**，
> 新用例一律以 `it(...)` 形式追加在 L543 之后、闭合 `});`（L544）之前。

### 负向用例（劫持必须消失，期望 `path === null`）

- [ ] T001 在 `fix-compliance-core.test.mjs` 追加 `it('复合命令 `;` 分隔：写段与读段跨段不再互相背书 → 不提名')`：
  `entries = [user('x'), bash('echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md', 1)]`；
  断言 `resolveFeatureDirCandidate(entries, 0).path === null`。
  **完成判据**：此时源码未改，运行该用例应 **FAIL**（当前实测提名 `specs/999-fix-decoy`，对应 fix-report.md R2）。

- [ ] T002 追加 `it('复合命令 `&&` 分隔：写段与读段跨段不再互相背书 → 不提名')`：
  命令 `echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md` → 期望 `null`。
  **完成判据**：改前 FAIL（对应 R3），改后须转 PASS。

- [ ] T003 追加 `it('复合命令 `||` 分隔：写段与读段跨段不再互相背书 → 不提名')`：
  命令 `echo x > /tmp/y || cat specs/999-fix-decoy/fix-report.md` → 期望 `null`。
  **完成判据**：改前 FAIL（对应 R4），改后须转 PASS；同时验证 `||` 不被误拆成裸 `|`（若被误拆成两个 `|` 段，判据仍应为 `null`，不影响本用例结论）。

- [ ] T004 追加 `it('复合命令换行分隔：写段与读段跨段不再互相背书 → 不提名')`：
  命令使用字面量 `'echo x > /tmp/y\ncat specs/999-fix-decoy/fix-report.md'`（JS 字符串内嵌 `\n`）→ 期望 `null`。
  **完成判据**：改前 FAIL，改后 PASS。

- [ ] T005 追加 `it('混合分隔符 4 段、写段与读段不相邻 → 不提名')`：
  命令 `'echo x > /tmp/y; echo mid1; echo mid2; cat specs/999-fix-decoy/fix-report.md'`
  （4 段：写段在首、读段在末，中间隔 2 个中性段）→ 期望 `null`。
  **完成判据**：改前 FAIL，改后 PASS。

- [ ] T006 追加 `it('写段在后、读段在前 → 不提名')`：
  命令 `cat specs/999-fix-decoy/fix-report.md && echo x > /tmp/y` → 期望 `null`。
  **完成判据**：验证「取最后出现者」不会因执行顺序反转而误提名（读段在前、写段在后但写段自身不含 artifact 路径）；改前 FAIL，改后 PASS。

- [ ] T007 追加 `it('tee 写指示符跨段（管道内 tee 与读路径分居 `;` 两侧）→ 不提名')`：
  命令 `cat specs/999-fix-decoy/fix-report.md; echo x | tee /tmp/y`
  （注：裸 `|` 不是分隔符，`echo x | tee /tmp/y` 整体是一个子命令段，段内含 `tee` 写指示符但无 artifact 路径；
  另一段 `cat specs/999-fix-decoy/fix-report.md` 含 artifact 路径但无写指示符）→ 期望 `null`。
  **完成判据**：改前 FAIL，改后 PASS。

- [ ] T008 追加 `it('heredoc 写指示符与 artifact 路径分居不同子命令段 → 不提名')`：
  命令 `'cat <<EOF > /tmp/y\nbody\nEOF; cat specs/999-fix-decoy/fix-report.md'`
  （heredoc header 段写向 `/tmp/y`，与 artifact 路径所在的 `;` 后读段完全分离）→ 期望 `null`。
  **完成判据**：改前 FAIL（当前整条命令级判定会背书），改后 PASS；与 T009（heredoc 同段仍应提名）形成对照，证明区分点是「同段」而非「是否含 heredoc」。

### 正向用例（合法写入必须仍被提名）

- [ ] T009 追加 `it('同段重定向写 → 仍提名')`：
  命令 `echo body > specs/300-fix-real/fix-report.md` → 期望 `'specs/300-fix-real'`。
  **完成判据**：此用例在改前改后均应 PASS（回归防护，非红测试，但仍需在本 Phase 落地以便与负向用例同批验证无破坏）。

- [ ] T010 追加 `it('复合命令中同段写（mkdir 前段 + heredoc 写段同段共现）→ 仍提名')`：
  命令 `'mkdir -p specs/300-fix-real && cat > specs/300-fix-real/fix-report.md <<EOF\n内容\nEOF'`
  （切分后 `cat > specs/300-fix-real/fix-report.md <<EOF` 单独成段，写指示符与 artifact 路径同段共现）→
  期望 `'specs/300-fix-real'`。
  **完成判据**：改前改后均应 PASS。

- [ ] T011 追加 `it('前段无关写 + 后段同段真写，跨段不互相污染，取最后 → 提名后者')`：
  命令 `'echo x > /tmp/y; echo body > specs/301-fix-later/fix-report.md'` → 期望 `'specs/301-fix-later'`。
  **完成判据**：验证前段的无关写入（`/tmp/y`，无 artifact 路径）不会污染或抑制后段的合法提名；改前改后均应 PASS。

- [ ] T012 追加 `it('两段各自同段写不同特性目录 → 取最后出现者（后者）')`：
  命令 `'echo a > specs/300-fix-real/fix-report.md; echo b > specs/301-fix-later/fix-report.md'` →
  期望 `'specs/301-fix-later'`。
  **完成判据**：验证逐段判定下「取最后出现者」语义与改造前整条文本全局 `exec` 语义等价（plan.md §2 回归风险 #3）；改前改后均应 PASS。

- [ ] T013 追加 `it('Bash 同段写 verification-report.md → 提名其特性目录前缀')`：
  命令 `echo v > specs/304-fix-v/verification/verification-report.md` → 期望 `'specs/304-fix-v'`。
  **完成判据**：与既有 L540-542 的 Write 版本对照，确认 Bash 路径同样支持 verification-report 提名；改前改后均应 PASS。

### 红测试确认

- [ ] T014 运行 `npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs`（此时源码尚未改动）：
  确认 T001-T008（8 条负向用例）全部 **FAIL**、T009-T013（5 条正向用例）与既有全部用例（含 C-2 六条）**PASS**。
  **完成判据**：终端输出的失败数恰为 8，失败用例名与 T001-T008 一一对应；若失败数不等于 8，说明测试断言或对现状的理解有误，需回头核对再进入 Phase 2。

---

## Phase 2：实现（Phase 1 红测试确认后才可开始）

- [ ] T015 在 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 新增模块私有常量
  `SUBCOMMAND_SPLIT_REGEX = /&&|\|\||;|\r?\n/g` 及私有函数 `splitBashSubcommands(command)`：
  用该正则对 `command` 做 `String.split`，返回保序的子命令段字符串数组（不做 trim，不做引号感知，见 plan.md §4 单调性证明）。
  放置位置：`resolveFeatureDirCandidate` 函数定义之前（约 L256-269 区间，即"特性目录提名"分节标题之后、函数体之前）。
  **完成判据**：函数为纯函数、不导出；对 `'a && b || c; d\ne'` 类输入返回 `['a ', ' b ', ' c', ' d', 'e']` 形态的 5 段（可用于自查，不需要单独写导出级单测——由 T017 后的黑盒用例间接覆盖，符合 plan.md §5 决策）。

- [ ] T016 在同文件紧邻 T015 新增函数之后，新增模块私有函数 `hasBashWriteIndicator(segment)`：
  函数体为 `return BASH_WRITE_INDICATOR_REGEX.test(segment);`（单一收口点，内部复用既有 `BASH_WRITE_INDICATOR_REGEX`，
  不新增正则、不改动该常量本身）。
  **完成判据**：函数为纯函数、不导出、只有一行判定逻辑；为 plan.md §合并预案中 F224 未来并入 `INLINE_EDIT_INDICATOR_REGEXES` 预留单点扩展位（本次不实现该扩展，仅保证结构可扩展）。

- [ ] T017 重写 `resolveFeatureDirCandidate`（L270-296）的 Bash 分支：
  将 L289-292 的
  ```js
  } else if (block.name === 'Bash' && typeof input.command === 'string'
    && BASH_WRITE_INDICATOR_REGEX.test(input.command)) {
    scanArtifactPath(input.command);
  }
  ```
  改写为逐段判定（伪代码，按 plan.md §2 精确顺序）：
  ```js
  } else if (block.name === 'Bash' && typeof input.command === 'string') {
    for (const segment of splitBashSubcommands(input.command)) {
      if (hasBashWriteIndicator(segment)) {
        scanArtifactPath(segment);
      }
    }
  }
  ```
  Write/Edit 分支（L287-288）与外层 `for` 循环结构（L283-294）保持不变；不提前 `return`，`candidate` 由 `scanArtifactPath` 内部逻辑（L274-282，不改动）继续按段推进覆盖，天然保持「取最后出现者」语义。
  **完成判据**：函数签名、返回形状 `{ path: candidate }`（L295）不变；`git diff` 该函数体，改动范围严格限定在 Bash 分支的 `else if` 条件与循环体内部，不触碰 Write/Edit 分支与 `scanArtifactPath` 定义。

- [ ] T018 更新 `resolveFeatureDirCandidate` 的 JSDoc（L257-269）：
  在现有关于 Bash 提名条件的说明行（"Bash：`input.command` 命中 artifact 路径 **且** 含写入指示符……"）后，
  补充一句明确「同段共现」判据：写指示符与 artifact 路径必须落在**同一子命令段**（按 `&&`/`||`/`;`/换行切分）才提名，
  跨段命中不再互相背书（可引用 fix-report.md R2-R4 作为背景，不改动 `@param` / `@returns` 签名行）。
  **完成判据**：JSDoc 新增说明与实现语义一致，不改动函数签名文档字段（`@param`/`@returns` 保持原样）。

---

## Phase 3：验证

- [ ] T019 运行 `npx vitest run plugins/spec-driver/tests/fix-compliance-core.test.mjs`：
  确认 T001-T013 共 13 条新增用例全部 **PASS**，且既有 C-2 六条断言（L515-543，文本逐字未改）与该文件其余全部用例
  全部 **PASS**（零回归）。
  **完成判据**：终端输出该文件失败数为 0；若任一 T001-T008 仍 FAIL，说明 Phase 2 实现与设计不符，需回退重做。

- [ ] T020 运行 `npm run test:plugins`：
  确认全量插件测试零失败，通过数为**基线 552 pass + 本次新增 13 条 = 565 pass**（若基线数字因并行分支已变化，
  以运行时实测的"改动前基线"为准，核心判据是"新增 13 条 + 改动前既有用例数，零减少零失败"）。
  **完成判据**：命令退出码 0，失败数为 0。

- [ ] T021 运行 `npm run repo:check`：确认插件同步校验、release contract 校验等仓库级门禁零失败。
  **完成判据**：命令退出码 0。

- [ ] T022 复现命令实测对照（plan.md §验证方案，逐条执行）：
  ```bash
  node -e "
  import('./plugins/spec-driver/scripts/lib/fix-compliance-core.mjs').then(({ resolveFeatureDirCandidate, normalizeTranscriptEntry }) => {
    const bash = (command) => normalizeTranscriptEntry(
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, 1, false);
    const user0 = normalizeTranscriptEntry({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }, 0, false);
    for (const cmd of [
      'echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md',
      'echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md',
      'echo x > /tmp/y || cat specs/999-fix-decoy/fix-report.md',
    ]) {
      console.log(cmd, '=>', resolveFeatureDirCandidate([user0, bash(cmd)], 0).path);
    }
  });
  "
  ```
  **完成判据**：三条命令（对应 fix-report.md R2/R3/R4）修复后均输出 `null`（修复前已在 fix-report.md 记录为均输出
  `specs/999-fix-decoy` ❌，本任务只需复跑一次验证已从"劫持"变为 `null`，不要求重新记录修复前状态）；
  同时用 C1（`cat specs/999-fix-decoy/fix-report.md`，纯读对照）与 C2（`echo body > specs/300-fix-real/fix-report.md`，
  同段真写对照）各跑一次，确认分别仍输出 `null` 与 `specs/300-fix-real`（行为不变）。

- [ ] T023 核对 `git diff plugins/spec-driver/tests/fix-compliance-core.test.mjs`：
  确认 diff 内容为**纯新增**（仅新增 `+` 行，无任何 `-` 行落在 L515-543 既有 6 条断言范围内），
  逐字比对 C-2 六条断言文本与改动前完全一致。
  **完成判据**：`git diff` 输出中该文件不含删除既有断言的 `-` 行；6 条断言的 `it(...)` 标题与 `assert.equal` 期望值逐字比对无差异。

---

## 测试矩阵汇总（Task ↔ 用例 ↔ 期望值 一览）

| Task | 类型 | 命令 | 期望 `path` |
|------|------|------|------------|
| T001 | 负向 | `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md` | `null` |
| T002 | 负向 | `echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md` | `null` |
| T003 | 负向 | `echo x > /tmp/y \|\| cat specs/999-fix-decoy/fix-report.md` | `null` |
| T004 | 负向 | `echo x > /tmp/y\ncat specs/999-fix-decoy/fix-report.md` | `null` |
| T005 | 负向 | `echo x > /tmp/y; echo mid1; echo mid2; cat specs/999-fix-decoy/fix-report.md` | `null` |
| T006 | 负向 | `cat specs/999-fix-decoy/fix-report.md && echo x > /tmp/y` | `null` |
| T007 | 负向 | `cat specs/999-fix-decoy/fix-report.md; echo x \| tee /tmp/y` | `null` |
| T008 | 负向 | `cat <<EOF > /tmp/y\nbody\nEOF; cat specs/999-fix-decoy/fix-report.md` | `null` |
| T009 | 正向 | `echo body > specs/300-fix-real/fix-report.md` | `specs/300-fix-real` |
| T010 | 正向 | `mkdir -p specs/300-fix-real && cat > specs/300-fix-real/fix-report.md <<EOF\n内容\nEOF` | `specs/300-fix-real` |
| T011 | 正向 | `echo x > /tmp/y; echo body > specs/301-fix-later/fix-report.md` | `specs/301-fix-later` |
| T012 | 正向 | `echo a > specs/300-fix-real/fix-report.md; echo b > specs/301-fix-later/fix-report.md` | `specs/301-fix-later`（取最后） |
| T013 | 正向 | `echo v > specs/304-fix-v/verification/verification-report.md` | `specs/304-fix-v` |

C-2 既有 6 条（L515-543）——回归项，不新增，见 T023：

| 命令 | 期望 `path` |
|------|------------|
| `echo specs/301-fix-old-compliant`（无写指示符） | `null` |
| `cat specs/301-fix-old-compliant/fix-report.md`（读形态） | `null` |
| `echo hi > specs/301-fix-old-compliant/notes.txt`（非 artifact 文件名） | `null` |
| `cat > specs/302-fix-real/fix-report.md <<EOF\n...\nEOF`（heredoc 同段写） | `specs/302-fix-real` |
| `Write specs/303-fix-dir-only/README.md`（非 artifact） | `null` |
| `Write specs/304-fix-v/verification/verification-report.md` | `specs/304-fix-v` |

---

## 依赖关系

- Phase 1（T001-T014）→ Phase 2（T015-T018）→ Phase 3（T019-T023）严格顺序，不可跨阶段并行。
- Phase 1 内部：T001-T013 均为同一文件（`fix-compliance-core.test.mjs`）内的顺序追加，不标记 `[P]`（同文件并行编辑会互相冲突）；
  T014 依赖 T001-T013 全部落地。
- Phase 2 内部：T015 → T016（`hasBashWriteIndicator` 依赖 `splitBashSubcommands` 定义在其前，便于阅读顺序，非强依赖）→
  T017（依赖 T015/T016 两个新函数已存在）→ T018（依赖 T017 完成后文档才能准确描述新语义）。
- Phase 3 内部：T019 → T020 → T021 可顺序执行（均为只读验证命令，无写入冲突，若并行环境允许可并发跑，
  但因需要逐一确认输出，建议顺序执行）；T022、T023 依赖 T017（实现完成）与 T019（用例转绿）已确认。

## 推荐执行策略

Fix 模式采用**单线程顺序执行**：先红（Phase 1）→ 后绿（Phase 2）→ 再验（Phase 3）。全部任务改动收敛在
2 个文件（1 源码 + 1 测试），无 User Story 拆分必要，不适用并行团队策略。
