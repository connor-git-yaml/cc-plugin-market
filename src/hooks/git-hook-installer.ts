/**
 * git post-commit hook 安装/卸载逻辑
 * 在 .git/hooks/post-commit 中追加/删除 spectra 标记段落
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/** spectra 段落开始标记 */
const SEGMENT_BEGIN = '# --- spectra begin ---';
/** spectra 段落结束标记 */
const SEGMENT_END = '# --- spectra end ---';

/** 后台建图的超时秒数（F266：本仓 graph-only 实测 ~3s，180s 给大仓留足余量） */
const REBUILD_TIMEOUT_SECONDS = 180;

/**
 * 僵尸锁回收阈值（分钟）。必须**大于** `REBUILD_TIMEOUT_SECONDS`：
 * 持锁进程最长活 180s，取 4 分钟意味着一次正常运行的锁绝不会被另一个 commit 抢走。
 * 判据用 `find -mmin +N`（GNU / BSD / busybox 三家 find 都支持；严格 POSIX 无此 primary，
 * 故整条判据用 `2>/dev/null` 包住并**保守回落到"锁有效"**——宁可这次不重建，也不并发抢跑）。
 */
const STALE_LOCK_MINUTES = 4;

/** 日志轮转阈值（字节）。超过即 `mv` 成 `.old`（覆盖上一份 .old），保证 append 不会无界增长。 */
const LOG_ROTATE_BYTES = 200 * 1024;

/**
 * 生成 post-commit hook spectra 段落内容
 * - 使用 POSIX sh 语法（兼容性最好）
 * - 后台运行，不阻塞 git 工作流
 * - 区分代码文件和文档文件分别处理
 *
 * F266 FR-003：建图命令由 `spectra graph` 换成 `spectra batch --mode graph-only`。
 * why：`spectra graph` 只合并磁盘缓存的 architecture-ir 与已生成的 .spec.md，**根本不解析源码**，
 * 用它做"提交后刷新"从原理上就不可能正确——在没有 spec 产物的仓库里它会把一张完整的图
 * 覆写成近乎空的贫图。`graph-only` 是纯 AST / 零 LLM / 无需认证的全量重建，才是文档承诺的那件事。
 * 相应地超时从 30s 提到 180s（graph-only 要真读全仓源码，30s 会在中大仓库上稳定被 kill）。
 *
 * F266 FR-003：产物不再全静默丢弃。日志落 `$(git rev-parse --git-dir)/spectra-post-commit.log`——
 * why 选 git dir 而不是项目内目录：① 它一定不在工作区里，不会污染 `git status`、也不需要用户
 * 配 .gitignore；② `git rev-parse --git-dir` 在普通仓库与 worktree 下都给出正确位置。
 *
 * F266 delta 审查 D6（两条，一起读）：
 * ① **日志改 append 并加 run header**。原实现每次运行用 `>` 覆写，实测间隔 1s 的两次 commit 会让
 *    后一次把前一次刚写下的失败标记整段截没 —— 而"失败只能靠查日志发现"正是 B1 给出的价格，
 *    截掉它等于把那个价格变成"什么都拿不到"。改 `>>` 后靠 200KB 轮转（`mv` 成 `.old`）控制增长：
 *    日志不进图产物，无 byte-stable 约束，多存一份历史的代价远小于丢失失败证据。
 * ② **并发闸**。180s 的重建窗口（`graph-only` 要真解析全仓源码）里再来一次 commit，会起第二个
 *    `spectra batch`，两个进程 last-writer-wins 地覆写同一份 graph.json（且共用固定 `.tmp` 名，
 *    见 P0-D 的耦合登记）。用 `mkdir` 抢锁（POSIX 下唯一原子的"创建或失败"原语，比 `[ -e ]` +
 *    `touch` 的检查—使用竞态可靠），抢不到就**记一行并退出**：图的陈旧性有 freshness advisory
 *    兜底，抢跑没有收益、只有互相覆盖的风险。
 *
 * F266 对抗审查 B1（两处，必须一起读）：
 * ① **外层子 shell 的 `> /dev/null 2>&1` 是承重的，不是装饰**。丢掉它，后台子 shell 就继承了
 *    git 的 stdout/stderr；任何按 EOF 读 commit 输出的消费方（命令替换、CI runner、IDE）都会被
 *    卡到 spectra 结束 —— 实测阻塞 7s，上限就是下面的超时值 180s。"后台运行不阻塞 commit"
 *    这一承诺完全建立在**释放继承 fd** 上，`&` 本身给不了这个保证。
 * ② 因此超时/失败的诊断 MUST NOT 打到 stderr（那正是 ① 要释放的 fd），一律 **append 到日志**。
 *    日志的覆写发生在下一次运行的开头，故本次写下的失败标记能存活到下次查看。
 *    代价如实登记：hook 的成败在终端上完全不可见，只能查日志文件——这是"不阻塞 commit"的价格。
 *
 * 段落用 begin/end 标记整段替换，**旧安装不会被追溯改写**；且 `installGitHook` 对已存在的段落
 * 是幂等跳过，故已装过 hook 的用户必须显式走一遍
 * `spectra install --remove --git` → `spectra install --git` 才会拿到新段落。
 *
 * F266 第三轮对抗审查 E1 / E2（并发闸的两个洞，一起读）：
 * ① **僵尸锁回收改「原子认领」**（E1，CRITICAL）。上一版是 `find(判 stale)` → `rmdir` → `mkdir`
 *    三步，三步之间可交错：racer B 的 `rmdir` 会删掉 racer A 刚 `mkdir` 出来的**活锁**，两边随后
 *    各自 `mkdir` 成功 → 双持锁并发重建（对抗代理已确定性复现）。现改为：判 stale 后先用
 *    `mv "$lock" "$lock.stale.$$"` 认领 —— 目录 rename 只可能有一个成功者，失败方（锁已被别人
 *    认领 / 锁已消失）直接走"抢不到就让位"分支；**`rmdir` 只作用在改名后的私有路径上，永远不会
 *    落到锁路径本身**。认领成功后立刻 `mkdir` 抢锁、再清理私有路径（把认领与抢锁之间的窗口
 *    压到一条命令）。
 *    **残余窗口如实登记（已实测，本修法并未把 E1 关死）**：若 B 的 stale 判定发生在 A 认领之前、
 *    而 B 的 `mv` 落在 A 重新 `mkdir` **之后**，B 仍会把 A 的新锁移走 —— 双持锁重新成立。
 *    实测（同一僵尸锁上并发起 N 个 racer，各 20 轮，判据=同一轮内拿到锁的进程数 > 1）：
 *      N=2   旧 0/20、新 0/20
 *      N=5   旧 2/20（最多 2 个同时持锁）、新 0/20
 *      N=20  旧 15/20（最多 5 个）、新 13/20（最多 2 个）
 *    即：把 hook 的真实并发量级（同一时刻两三个 post-commit 子 shell）打穿的那一档已经收住，
 *    单轮并发持锁数上限从 5 降到 2；但 20 路同发仍能复现双持锁。根因是 POSIX sh 下
 *    「判 stale → 认领 → 重新抢锁」无法做成一次原子操作。已试过的加强档（锁内写持有者令牌 +
 *    开工前复核归属）实测 N=20 时 3/20，同样只是收窄；真正关死需要换原语（`flock` / `O_EXCL`
 *    的小 helper，或把锁的生命周期交给 `spectra` 自己），超出本卡范围，移交登记。
 * ② **多 commit 序列的重建请求标记**（E2）。上一版让位者只记一行就退出，于是 rebase 重放这类
 *    连发 commit 形态下只有第一个 commit 触发重建，图**恒定格在序列首 commit 的树态**（实证：
 *    5 连 commit 只重建 1 次）。现让位者 `touch $git_dir/spectra-rebuild-requested`；持锁者在本轮
 *    重建 + `wait`/`kill` 收尾之后检查该标记，存在则删标记并**再跑一轮**（上限 2 轮，避免提交风暴
 *    把 hook 变成常驻重建器；超限只记一行，剩下的陈旧性交给 freshness advisory）。
 *    **残余竞态如实登记**：让位者的 `touch` 若发生在持锁者最后一次检查之后、`rmdir` 释放锁之前，
 *    该请求本轮不会被看见（标记会留到下一次持锁者跑完第一轮时才被消费，届时它已由更新的
 *    树态重建过一次，故只是多跑一轮而非丢改动）；真正落空的只有"最后一次 commit 的重建"这一
 *    单点，由 MCP 侧 freshness advisory（dirty / stale）对外声明，不会静默。
 * ③ 超时分支在 `kill` 之后补 `wait`（第三轮 INFO-3）：被 TERM 的 `spectra batch` 可能仍在写
 *    graph.json 的临时文件，锁在它落地之前易主等于把并发闸开在最危险的一刻。代价：若子进程
 *    忽略 TERM，本子 shell 会一直等它退出、期间锁不释放；此时锁会在 4 分钟后被别人按僵尸锁回收
 *    （此刻真正的重建早已被 TERM 掉，回收无害）。
 */
export function generatePostCommitSegment(): string {
  return `${SEGMENT_BEGIN}
_spectra_changed=$(git diff HEAD~1 HEAD --name-only 2>/dev/null || true)

_spectra_has_code=$(echo "$_spectra_changed" | grep -E '\\.(ts|js|tsx|jsx|py|go|rs|java|rb|php|cs)$' | wc -l | tr -d ' ')
_spectra_has_docs=$(echo "$_spectra_changed" | grep -E '\\.(md|txt|rst|adoc)$' | wc -l | tr -d ' ')

if [ "$_spectra_has_code" -gt 0 ]; then
  # 后台运行 + 超时保护，防止僵尸进程积累（FR-010 CLARIFIED）
  _spectra_git_dir="$(git rev-parse --git-dir 2>/dev/null || echo .git)"
  _spectra_log="$_spectra_git_dir/spectra-post-commit.log"
  _spectra_lock="$_spectra_git_dir/spectra-rebuild.lock"
  _spectra_requested="$_spectra_git_dir/spectra-rebuild-requested"
  (
    # 并发闸：mkdir 是 POSIX 下原子的"创建或失败"。抢不到锁 = 上一次重建还在跑，直接让位。
    _spectra_held=0
    if mkdir "$_spectra_lock" 2>/dev/null; then
      _spectra_held=1
    else
      # 僵尸锁回收（E1）：**认领后才清理**。判不出年龄就当锁有效（保守）。
      _spectra_claim="$_spectra_lock.stale.$$"
      rmdir "$_spectra_claim" 2>/dev/null
      if [ -n "$(find "$_spectra_lock" -maxdepth 0 -mmin +${STALE_LOCK_MINUTES} 2>/dev/null)" ] && mv "$_spectra_lock" "$_spectra_claim" 2>/dev/null; then
        if mkdir "$_spectra_lock" 2>/dev/null; then
          _spectra_held=1
        fi
        rmdir "$_spectra_claim" 2>/dev/null
      fi
    fi
    if [ "$_spectra_held" -eq 0 ]; then
      echo "[spectra] $(date -u '+%Y-%m-%dT%H:%M:%SZ') skipped: another rebuild in progress (rebuild requested)" >> "$_spectra_log"
      # E2：让位不等于放弃——留下重建请求标记，持锁者跑完当前一轮后会看见它并补跑一轮。
      touch "$_spectra_requested" 2>/dev/null
      exit 0
    fi
    # 日志轮转：append 不能无界增长；超阈值就整份转存 .old（覆盖上一份）
    _spectra_log_bytes=$(wc -c < "$_spectra_log" 2>/dev/null | tr -d ' ')
    if [ -n "$_spectra_log_bytes" ] && [ "$_spectra_log_bytes" -gt ${LOG_ROTATE_BYTES} ]; then
      mv -f "$_spectra_log" "$_spectra_log.old" 2>/dev/null
    fi
    _spectra_pass=1
    while : ; do
      echo "[spectra] === run $(date -u '+%Y-%m-%dT%H:%M:%SZ') (pass $_spectra_pass) ===" >> "$_spectra_log"
      spectra batch --mode graph-only >> "$_spectra_log" 2>&1 &
      _spectra_pid=$!
      _spectra_waited=0
      while [ "$_spectra_waited" -lt ${REBUILD_TIMEOUT_SECONDS} ] && kill -0 "$_spectra_pid" 2>/dev/null; do
        sleep 1
        _spectra_waited=$((_spectra_waited + 1))
      done
      if kill -0 "$_spectra_pid" 2>/dev/null; then
        kill "$_spectra_pid" 2>/dev/null
        # 先收尸再释放锁：被 TERM 的 spectra 仍可能在写 graph.json 的临时文件，
        # 锁在它落地之前易主就等于把并发闸开在最危险的那一刻。
        wait "$_spectra_pid" 2>/dev/null
        echo "[spectra] graph rebuild timed out after ${REBUILD_TIMEOUT_SECONDS}s (killed)" >> "$_spectra_log"
      else
        wait "$_spectra_pid"
        _spectra_exit=$?
        if [ "$_spectra_exit" -ne 0 ]; then
          echo "[spectra] graph rebuild failed (exit $_spectra_exit)" >> "$_spectra_log"
        fi
      fi
      [ -f "$_spectra_requested" ] || break
      rm -f "$_spectra_requested" 2>/dev/null
      if [ "$_spectra_pass" -ge 2 ]; then
        echo "[spectra] rebuild request still pending after 2 passes; graph may lag behind HEAD" >> "$_spectra_log"
        break
      fi
      _spectra_pass=$((_spectra_pass + 1))
    done
    rmdir "$_spectra_lock" 2>/dev/null
  ) > /dev/null 2>&1 &
fi

if [ "$_spectra_has_docs" -gt 0 ]; then
  echo "[spectra] Docs changed. Run 'spectra batch --mode graph-only' to refresh the knowledge graph."
fi
${SEGMENT_END}
`;
}

/**
 * 解析 post-commit hook 文件的真实路径
 * - 普通仓库：.git 是目录 → .git/hooks/post-commit
 * - worktree：.git 是文件（含 "gitdir: <path>"） → 解析 gitdir 并定位 hooks/post-commit
 * @param projectRoot - 项目根目录绝对路径
 * @throws 当 .git 不存在或格式不可识别时
 */
export function resolveHookPath(projectRoot: string): string {
  const gitPath = join(projectRoot, '.git');

  let stat;
  try {
    stat = statSync(gitPath);
  } catch {
    throw new Error('[spectra] .git directory not found. Is this a git repository?');
  }

  if (stat.isDirectory()) {
    return join(gitPath, 'hooks', 'post-commit');
  }

  if (stat.isFile()) {
    // git worktree：.git 是包含 "gitdir: <path>" 的文件
    const content = readFileSync(gitPath, 'utf-8').trim();
    const match = /^gitdir:\s*(.+)$/.exec(content);
    if (!match) {
      throw new Error('[spectra] Cannot parse .git file. Is this a valid git worktree?');
    }
    const gitDir = resolve(dirname(gitPath), match[1]!);
    return join(gitDir, 'hooks', 'post-commit');
  }

  throw new Error('[spectra] .git directory not found. Is this a git repository?');
}

/**
 * 安装 git post-commit hook 段落
 * - 幂等：段落已存在时打印提示并返回
 * - 若 post-commit 不存在则创建并写入 #!/bin/sh 头部
 * - 支持普通仓库和 git worktree
 * @param projectRoot - 项目根目录绝对路径
 * @throws 当 .git 不存在时（FR-013）
 */
export function installGitHook(projectRoot: string): void {
  const hookPath = resolveHookPath(projectRoot);

  // 确保 hooks 目录存在（worktree 场景下可能不存在）
  mkdirSync(dirname(hookPath), { recursive: true });

  // 若 post-commit 不存在，创建含 #!/bin/sh 头部的文件
  let existing = '';
  if (existsSync(hookPath)) {
    existing = readFileSync(hookPath, 'utf-8');
  } else {
    existing = '#!/bin/sh\n';
  }

  // 幂等判定：已含开始标记则跳过
  if (existing.includes(SEGMENT_BEGIN)) {
    console.log('[spectra] git hook already installed, skipping.');
    return;
  }

  // 追加 spectra 段落（确保前有空行分隔）
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const content = needsNewline
    ? `${existing}\n${generatePostCommitSegment()}`
    : `${existing}${generatePostCommitSegment()}`;

  writeFileSync(hookPath, content, 'utf-8');
  chmodSync(hookPath, 0o755);
  console.log('[spectra] git post-commit hook installed.');
}

/**
 * 卸载 git post-commit hook 段落
 * - 幂等：段落不存在时静默退出
 * - 正则删除 spectra 标记段落（含标记行），保留其他内容
 * - 保持文件可执行权限
 * @param projectRoot - 项目根目录绝对路径
 */
export function removeGitHook(projectRoot: string): void {
  let hookPath: string;
  try {
    hookPath = resolveHookPath(projectRoot);
  } catch {
    // .git 不存在 → 无需卸载
    return;
  }

  if (!existsSync(hookPath)) {
    return;
  }

  const content = readFileSync(hookPath, 'utf-8');

  if (!content.includes(SEGMENT_BEGIN)) {
    return;
  }

  // 正则删除从开始标记到结束标记（含标记行）的全部内容
  // 使用非贪婪匹配，支持多行，标记行之间允许任意字符
  const pattern = new RegExp(
    `${escapeRegex(SEGMENT_BEGIN)}[\\s\\S]*?${escapeRegex(SEGMENT_END)}\\n?`,
    'g',
  );
  const updated = content.replace(pattern, '');

  writeFileSync(hookPath, updated, 'utf-8');
  // 保持可执行权限
  chmodSync(hookPath, 0o755);
  console.log('[spectra] git post-commit hook removed.');
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
