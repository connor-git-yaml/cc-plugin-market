# 代码质量审查报告 — Feature 207 fix-init-scaffold-gitignore

审查方式：对抗性审查（假设有问题、尝试证伪）。所有攻击面均在临时目录内**实测验证**（bash 5.3 / bash 3.2 双环境、CRLF、并发、只读文件系统、异常输入），非纯静态阅读推测。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 共享库单一职责、双调用方复用设计合理；`postinstall.sh` 静默容错与 `init-project.sh` 信号化上报的差异化处理符合两者场景差异 |
| 设计模式合理性 | GOOD | 幂等契约设计清晰（`grep -qxF` 精确匹配 + mtime 不变保证），但**幂等契约的原子性假设在并发场景下不成立**（见 CRITICAL-1） |
| 安全性 | GOOD | 无硬编码密钥、无命令注入（无用户输入拼接进 shell 命令）、路径均来自受控的 `$PROJECT_ROOT`/`$CLAUDE_PROJECT_DIR`，无路径遍历风险 |
| 性能 | N/A | 纯文件 I/O，条目数固定为 4，无性能敏感路径 |
| 可读性 | GOOD | 函数注释完整、契约在注释中写清楚（含 why）；`ensure_gitignore_step` 的 case 分支清晰 |
| 可维护性 | NEEDS_IMPROVEMENT | 测试覆盖 7 个"理想路径"用例，但**未覆盖并发/CRLF 两个真实回归风险最高的场景**（这两个场景恰是 plan.md §5 自己点名的"最大回归防线"） |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| CRITICAL | 设计模式合理性/并发安全 | `plugins/spec-driver/scripts/lib/ensure-gitignore.sh:53-84` | **多会话并发 SessionStart 竞态实测复现**：10 个 bash 进程并发调用 `ensure_spec_driver_gitignore` 同一目录（模拟用户同时打开多个 Claude Code 窗口/tab，每个都触发 SessionStart hook），"读取缺失条目 → 追加"这一复合操作无锁保护，产生 TOCTOU 竞态。实测结果：`.specify/.spec-driver-path` 被重复追加 10 次，`.specify/scorecards/` 10 次，`.specify/templates/` 8 次（见下方实测记录）。这与 plan.md §5 第 5 条自称的"幂等性是最大回归防线"直接矛盾——该文档只验证了顺序调用幂等，未验证并发幂等，而 `postinstall.sh` 恰恰是**每次会话无条件触发**的 hook，多窗口/多终端 tab 并发是真实高频场景（非边缘情况）。虽不会导致数据丢失或功能失败（重复的 ignore 行仍然有效），但会在用户 `.gitignore` 中持续堆积重复行，且随用户打开会话次数增多单调增长（不像 CRLF 场景是"一次性"重复）。 | 用 `flock`（GNU coreutils，macOS 需 brew 或退化）或 `mkdir` 原子锁（`mkdir "$gitignore_file.lock" 2>/dev/null` 作跨平台原子锁更稳）包裹"检查缺失→追加"临界区；或退而求其次改用 `flock -n` 失败时静默跳过本次注入（下次会话仍会重试，最终收敛）。至少应在 plan.md 与测试用例中明确记录"已知限制：极端并发下可能重复追加，但不影响功能正确性"，而非声称已被幂等测试完全覆盖 |
| WARNING | 可维护性/边界覆盖 | `plugins/spec-driver/scripts/lib/ensure-gitignore.sh:58` | **CRLF 行尾 `.gitignore` 场景实测复现一次性重复**：构造已含 CRLF 结尾 4 条目的 `.gitignore`（Windows 用户 / 部分 Git 客户端会产生 CRLF），`grep -qxF -- "$entry" "$gitignore_file"` 因整行含尾随 `\r` 导致精确匹配失败，4 条全部被判定为"缺失"并重复追加一份 LF 结尾版本（实测：追加后每条目计数变为 2）。好在第二次调用后转为 `ready:0`（LF 版本已存在，不会无限增长），故不构成 CRITICAL，但确实产生一次性重复且违反"整行精确匹配避免误判"的设计初衷在 CRLF 环境下失效。plan.md/测试清单 6 个场景中未包含 CRLF 场景 | 追加前对读取的每行做 `${line%$'\r'}` 归一化再比较（或读取时用 `tr -d '\r'` 生成临时归一化视图仅用于匹配，不改写原文件的实际行尾），并补充一个 CRLF 场景的测试用例 |
| WARNING | 可维护性/信号语义 | `plugins/spec-driver/scripts/lib/ensure-gitignore.sh:41-51`、`plugins/spec-driver/scripts/init-project.sh:297-318` | `.gitignore` 路径异常时（如目标是目录、父目录只读）触发"创建"分支的 `{ ... } > "$gitignore_file" || return 0`，因为提前 `return 0` 未打印任何 stdout，导致 `ensure_gitignore_step` 里 `result=""`，落入 `case` 的 `*)` 分支产生 `gitignore:unknown` 信号；而共享库层面本应表达的是"写入失败"语义，与 `INIT_RESULTS+=("gitignore:skip_error")`（针对 `ensure_spec_driver_gitignore` 返回非 0 的场景）在文本呈现上不一致——两种真实失败原因（函数显式 return 1 vs 内部写入失败但仍 return 0）被分裂成 `skip_error` 和 `unknown` 两个不同信号，且 `print_init_text_result()` 的 `gitignore` 分支未处理 `unknown` 这个 case，text 模式下该情况会静默无输出（用户看不到任何 ⚠️ 提示，与 `--json` 模式相比信息不对等）。实测：故意把 `.gitignore` 建成目录后跑 `init-project.sh --json`，`RESULTS` 中出现的确实是未在 `print_init_text_result` 里处理的 `gitignore:unknown` | 让共享库内部写入失败时也走统一的 `printf` 输出一个显式的 `write_error:0`/`failed:0` 之类的 stdout 信号（而不是裸 `return 0` 不打印），并在 `print_init_text_result()` 的 `gitignore` case 里补上对应分支，保证 text/json 两种模式呈现一致 |
| INFO | 可读性 | `plugins/spec-driver/scripts/postinstall.sh:48-51` | 每次 SessionStart 都 `source "$SCRIPT_DIR/lib/ensure-gitignore.sh"`，函数定义会被重复 source（性能可忽略但语义上略冗余），且 `source` 失败（文件被删除等极端情况）已用 `[[ -f ... ]]` 判断守护，属于良好防御，此处仅为可读性建议 | 可选：将 `source` 移到脚本顶层一次性完成（与 `init-project.sh` 的顶层 `source` 风格保持一致），减少每次调用 `write_plugin_path` 时的重复 source 开销，非必须 |
| INFO | 命名/文档一致性 | `specs/207-fix-init-scaffold-gitignore/plan.md:174-179` | plan.md 测试清单第 5/6 项描述与实际测试文件用例编号、断言细节高度吻合（已核实一致），但**未包含 CRLF 与并发两个场景**，属于测试规划阶段的覆盖盲区而非实现偏离规划；建议此后 fix 类需求涉及"文件级幂等追加"模式时，将 CRLF 与并发列为标准检查清单项 | 在 plan.md 或团队测试规范中补一条通用检查项："幂等追加类脚本必须验证 CRLF 兼容与并发安全，不能仅验证顺序幂等" |

## 实测记录摘要（供复核）

1. **并发竞态**（CRITICAL-1 证据）：
   ```
   10 个并发 bash 进程 source lib 后调用 ensure_spec_driver_gitignore 同一目录
   结果：.specify/.spec-driver-path ×10，.specify/scorecards/ ×10，.specify/templates/ ×8，.specify/runs/ ×1（因预置文件已含此条目未参与竞态）
   ```
2. **CRLF 误判**（WARNING-1 证据）：预置 CRLF 结尾的 4 条目文件 → 第一次调用 `appended:4`（本应 `ready:0`）→ 每条目最终计数 2
3. **`gitignore:unknown` 信号**（WARNING-2 证据）：`mkdir .gitignore` 后跑 `init-project.sh --json`，`RESULTS` 含 `"gitignore:unknown"`，且 `print_init_text_result()` 无对应文本分支
4. **bash 3.2（macOS 系统自带）兼容性**：`/bin/bash -c 'set -euo pipefail; ...'` 全路径（全新创建/全部就位/postinstall 全流程）均 exit 0，无 `unbound variable` 崩溃（数组判空全部用 `${#arr[@]}` 而非直接展开空数组，写法安全）
5. **`set -e` + command substitution 语义**：确认无 `||` 兜底时 `result="$(fn)"`（fn return 1）会导致整个脚本以非零码退出；本次两处调用（`init-project.sh` 的 `ensure_gitignore_step` 与 `postinstall.sh` 的直接调用）均已正确加 `||` 兜底，未发现该问题的实际漏洞
6. **JSON 输出污染**：stderr 报错（Permission denied / Is a directory）不污染 `--json` 模式的 stdout，JSON 可正常解析
7. **测试真实性**：`node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs` 单独跑 7/7 通过；`node --test "plugins/spec-driver/tests/**/*.test.mjs"` 全量 296/296 通过，无回归；测试通过 `spawnSync('bash', ...)` 真实拉起被测脚本子进程，非 mock 自证

## 总体质量评级

**NEEDS_IMPROVEMENT**

评级依据：1 个 CRITICAL（并发竞态导致重复追加，实测可复现）+ 2 个 WARNING（CRLF 一次性重复 + 信号语义不一致）+ 2 个 INFO。根据分级标准（零 CRITICAL 但 WARNING > 5 或有 1-2 个 CRITICAL → NEEDS_IMPROVEMENT），命中"1-2 个 CRITICAL"档位。

**风险定性说明**：CRITICAL 项不会导致数据丢失、不会导致 `.gitignore` 功能失效（重复行仍是合法有效的 ignore 规则），也不会中断 SessionStart hook（`|| true` 兜底完整），因此**不构成阻断发布的硬缺陷**，但会随用户多开会话次数在其 `.gitignore` 中持续堆积重复行，与本 fix 的"幂等、无副作用"设计初衷相悖，建议在本次发布前补加原子锁或至少在文档中显式承认该已知限制。

## 问题分级汇总

- CRITICAL: 1 个
- WARNING: 2 个
- INFO: 2 个
