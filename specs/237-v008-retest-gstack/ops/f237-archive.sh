#!/usr/bin/env bash
# F237 存档脚本 —— 覆盖 §2.1（pre，F212 现场存档）与 §5.4（v008，V008 归档）两处归档逻辑
# 对应 plan.md §2.1/§5.4、tasks.md T012
#
# 用法：
#   f237-archive.sh pre    # 对应 §2.1 F212 现场存档（发射前，编排器已手工完成，脚本仍实现以备重跑；
#                          #   幂等：已存在带日戳 tar 时跳过）
#   f237-archive.sh v008   # 对应 §5.4 V008 归档（入库精简版 copy 到编排 worktree evidence/ + 本地
#                          #   全量 tar 备份；归档完成后显式 kill 取证 watcher，T010 定义的三种退出
#                          #   路径之一）
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

MODE="${1:-}"
FORCE_FLAG="${2:-}"
if [ "$MODE" != "pre" ] && [ "$MODE" != "v008" ]; then
  echo "用法: $0 pre|v008 [--force]" >&2
  exit 1
fi

# 编排 worktree 内 evidence/ 绝对路径（v008 模式入库精简版目标；与评测 worktree 同机同盘，
# 写完编排 worktree 内的 git add 天然可见，无需额外跨 worktree 传输步骤）
ORCH_EVIDENCE="/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/specs/237-v008-retest-gstack/evidence"

# 幂等核验（W-5）：不能只看文件名是否存在——重跑中途中断可能留下截断/损坏的 tar，
# 若只凭 `ls` 命中就跳过，损坏产物会被永久当作"已存档"放过。三个 pattern 各取最新
# 一份（`ls -t`）跑 `tar -tzf` 完整性核验，全部通过才判定幂等跳过。
_archive_pre_idempotent_ok() {
  local pattern latest
  for pattern in \
    ".calibration-output/f212-archive/pool-tasks-*.tar.gz" \
    ".calibration-output/f212-archive/ab-tasks-*.tar.gz" \
    ".calibration-output/f212-archive/run_artifacts-*.tar.gz"; do
    latest=$(ls -t $pattern 2>/dev/null | head -1)
    [ -n "$latest" ] || return 1
    tar -tzf "$latest" >/dev/null 2>&1 || return 1
  done
  return 0
}

archive_pre() {
  mkdir -p .calibration-output/f212-archive

  if _archive_pre_idempotent_ok; then
    echo "[archive][pre] 已存在存档产物且完整性核验通过，跳过（幂等）"
    return 0
  fi
  echo "[archive][pre] 幂等核验未通过（缺失或 tar 损坏），重新归档（新日戳，不覆盖旧文件）"

  local STAMP FAIL_COUNT
  STAMP=$(date +%Y%m%d%H%M%S)
  FAIL_COUNT=0

  # (1a) tests/baseline/tasks/ 全树（pool 链判分 fixture 所在树）
  if ! tar -czf ".calibration-output/f212-archive/pool-tasks-${STAMP}.tar.gz" tests/baseline/tasks/ 2>&1; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "[archive][ERROR] tests/baseline/tasks/ 打包失败（检查是否已跑过 pool 链）"
  fi

  # (1b) tests/baseline/swe-bench-verified/tasks/ 全树（cohort-batch A/B 链的判分 fixture 树）
  if [ -d tests/baseline/swe-bench-verified/tasks ]; then
    if ! tar -C tests/baseline/swe-bench-verified -czf ".calibration-output/f212-archive/ab-tasks-${STAMP}.tar.gz" tasks/ 2>&1; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "[archive][ERROR] tests/baseline/swe-bench-verified/tasks/ 打包失败"
    fi
  else
    echo "[archive][warn] tests/baseline/swe-bench-verified/tasks/ 不存在，跳过"
  fi

  # (2) run_artifacts/ 全树
  if ! tar -czf ".calibration-output/f212-archive/run_artifacts-${STAMP}.tar.gz" run_artifacts/ 2>&1; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "[archive][ERROR] run_artifacts/ 打包失败"
  fi

  # (3) bench-worktrees 只抽文本核心（macOS BSD cp 无 --parents，改用 rsync -aR 相对路径模式）
  mkdir -p ".calibration-output/f212-archive/bench-worktrees-core-${STAMP}"
  local ARCHIVE_DST TASK_LIST TASK R SRC
  ARCHIVE_DST="$(pwd)/.calibration-output/f212-archive/bench-worktrees-core-${STAMP}"
  if [ -f specs/212-eval-rerun-m8-closeout/pool-11.json ] && [ -d "$HOME/.spec-driver-bench-worktrees" ]; then
    TASK_LIST=$(node -e "console.log(JSON.parse(require('fs').readFileSync('specs/212-eval-rerun-m8-closeout/pool-11.json')).taskIds.join('\n'))")
    (
      cd "$HOME/.spec-driver-bench-worktrees" || exit 0
      for TASK in $TASK_LIST; do
        for R in r1 r2 r3 r4 r5 r6; do
          SRC="${TASK}/spec-driver-spectra-mcp/${R}"
          [ -d "$SRC" ] || continue
          rsync -aR --prune-empty-dirs \
            --include='*/' --include='*.md' --include='*.jsonl' --include='*.log' --include='*.json' --exclude='*' \
            "${SRC}/./"{specs,.specify} "${ARCHIVE_DST}/" \
            || echo "[archive][warn] ${TASK}/${R} 文本核心抽取失败（单条抽取失败不计入 FAIL_COUNT，属可容忍降级）"
        done
      done
    )
  else
    echo "[archive][warn] pool-11.json 或 ~/.spec-driver-bench-worktrees 不存在，跳过 (3)"
  fi

  # C-5：核心 tar 写失败不再被吞没——存在失败则以非零 exit 4 收尾，禁止打印"存档完成"
  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "[archive][pre] 归档存在 ${FAIL_COUNT} 处失败"
    exit 4
  fi

  echo "[archive][pre] 存档完成：$(du -sh .calibration-output/f212-archive/*"${STAMP}"* 2>/dev/null | awk '{print $1}' | paste -sd+ -)"
}

# 从 T021 产出的 f237-v008-extract.json 摘取字段（W-4：extract JSON 是 v008 的唯一路径
# 事实源，不再用 ls glob 猜测常见命名——旧版对 L3/L2 各种命名模式做 glob 兜底，实测
# 命中率不稳定且与 T021 已定位的权威路径可能不一致，两套路径来源会互相矛盾）。
_v008_extract_field() {
  # $1=EXTRACT_JSON路径 $2=repeat序号(1|2|3) $3=字段名
  node -e "
    try {
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      const wantRepeat = 'r' + process.argv[2];
      const rec = (data.runs || []).find((r) => r.repeat === wantRepeat || String(r.repeat) === process.argv[2]);
      console.log(rec && rec[process.argv[3]] != null ? rec[process.argv[3]] : '');
    } catch (e) { console.log(''); }
  " "$1" "$2" "$3"
}

archive_v008() {
  local FORCE="${1:-}"
  local STATUS_FILE=".calibration-output/f237-batch-status.json"
  local EXTRACT_JSON=".calibration-output/f237-v008-extract.json"

  # C-4 守卫 1：batch 必须 completed 才允许归档——归档中途 kill watcher、抽取三层现场
  # 均假设跑批已经结束，若在 running/aborted 态抢跑会截断仍在写入的 L3 现场；
  # --force 仅供编排器人工决策下对 partial 批显式取证（供 §8 风险表处置场景使用）
  local BATCH_STATUS
  BATCH_STATUS=$(node -e "
    try {
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      console.log(s.status || 'unknown');
    } catch (e) { console.log('missing'); }
  " "$STATUS_FILE" 2>/dev/null)
  if [ "$BATCH_STATUS" != "completed" ]; then
    if [ "$FORCE" != "--force" ]; then
      echo "[archive][FATAL] batch status=${BATCH_STATUS} != completed，拒绝归档（--force 可覆盖，仅限编排器人工决策）" >&2
      exit 3
    fi
    echo "[archive][WARN] --force 覆盖 batch status=${BATCH_STATUS}，人工取证 partial 批"
  fi

  # C-4 守卫 2：f237-v008-extract.json 必须存在且含恰好 3 条 run 记录——该守卫不受
  # --force 影响，因为归档需要的权威路径全部来自该文件（T021 前置依赖，缺失即无法归档）
  local EXTRACT_OK
  EXTRACT_OK=$(node -e "
    try {
      const fs = require('fs');
      const d = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      console.log(Array.isArray(d.runs) && d.runs.length === 3 ? 'ok' : 'bad-run-count');
    } catch (e) { console.log('missing'); }
  " "$EXTRACT_JSON" 2>/dev/null)
  if [ "$EXTRACT_OK" != "ok" ]; then
    echo "[archive][FATAL] ${EXTRACT_JSON} 不存在或不含恰好 3 条 run 记录（先跑 T021）status=${EXTRACT_OK}" >&2
    exit 3
  fi

  mkdir -p "$ORCH_EVIDENCE"
  local N DST FIX_REPORT_SRC PATCH_SRC AUDIT_SRC FAIL_COUNT
  FAIL_COUNT=0

  for N in 1 2 3; do
    DST="${ORCH_EVIDENCE}/v008-r${N}"
    # C-6：先整目录清空重建再写入本轮结果——防旧证据文件与旧 .absent 占位跨轮共存
    # 串档（如上轮 patch.diff 已抓到、本轮 extract 判定 absent，若不清空旧文件会
    # 被误当作本轮证据留存）
    rm -rf "$DST"
    mkdir -p "$DST"

    FIX_REPORT_SRC=$(_v008_extract_field "$EXTRACT_JSON" "$N" fixReportPath)
    PATCH_SRC=$(_v008_extract_field "$EXTRACT_JSON" "$N" patchPath)
    AUDIT_SRC=$(_v008_extract_field "$EXTRACT_JSON" "$N" auditJsonlPath)

    # fix-report.md：字段来自 extract.json 的 fixReportPath（T021 已按 L3 存活 worktree/
    # watcher live-forensics/转录重建三级降级定位好权威路径，本脚本只消费不再猜测）
    if [ -n "$FIX_REPORT_SRC" ] && [ -f "$FIX_REPORT_SRC" ]; then
      rm -f "$DST/fix-report.md.absent"
      if ! cp "$FIX_REPORT_SRC" "$DST/fix-report.md"; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "[archive][ERROR] v008-r${N} fix-report.md copy 失败 (src=${FIX_REPORT_SRC})"
      fi
    else
      rm -f "$DST/fix-report.md"
      echo "absent" > "$DST/fix-report.md.absent"
      echo "[archive][warn] v008-r${N} fix-report.md 不存在（extract.json fixReportPath=${FIX_REPORT_SRC:-<empty>}），记 absent"
    fi

    # patch.diff：字段来自 extract.json 的 patchPath（L2 run_artifacts/ 权威路径）
    if [ -n "$PATCH_SRC" ] && [ -f "$PATCH_SRC" ]; then
      rm -f "$DST/patch.diff.absent"
      if ! cp "$PATCH_SRC" "$DST/patch.diff"; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "[archive][ERROR] v008-r${N} patch.diff copy 失败 (src=${PATCH_SRC})"
      fi
    else
      rm -f "$DST/patch.diff"
      echo "absent" > "$DST/patch.diff.absent"
      echo "[archive][warn] v008-r${N} patch.diff 不存在（extract.json patchPath=${PATCH_SRC:-<empty>}），记 absent"
    fi

    # audit-events.jsonl：字段来自 extract.json 的 auditJsonlPath
    if [ -n "$AUDIT_SRC" ] && [ -f "$AUDIT_SRC" ]; then
      rm -f "$DST/audit-events.jsonl.absent"
      if ! cp "$AUDIT_SRC" "$DST/audit-events.jsonl"; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "[archive][ERROR] v008-r${N} audit-events.jsonl copy 失败 (src=${AUDIT_SRC})"
      fi
    else
      rm -f "$DST/audit-events.jsonl"
      echo "absent" > "$DST/audit-events.jsonl.absent"
      echo "[archive][warn] v008-r${N} audit-events.jsonl 不存在（extract.json auditJsonlPath=${AUDIT_SRC:-<empty>}），记 absent"
    fi

    # meta.json：从 f237-v008-extract.json 摘取该 repeat 整条记录（L1 字段抽取结果）；
    # 函数入口已守卫 EXTRACT_JSON 存在且恰好 3 条记录，此处只需处理单条记录缺失
    # （node 脚本内部已处理：找不到 rec 时写 .absent）与进程级失败（真失败计入 FAIL_COUNT）
    rm -f "$DST/meta.json.absent"
    if ! node -e "
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
      const wantRepeat = 'r' + process.argv[2];
      const rec = (data.runs || []).find((r) => r.repeat === wantRepeat || String(r.repeat) === process.argv[2]);
      if (rec) {
        fs.writeFileSync(process.argv[3], JSON.stringify(rec, null, 2) + '\n');
      } else {
        fs.writeFileSync(process.argv[3] + '.absent', 'absent\n');
      }
    " "$EXTRACT_JSON" "$N" "$DST/meta.json"; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "[archive][ERROR] v008-r${N} meta.json 抽取失败"
    fi
  done

  # 本地全量备份（不入库，评测 worktree 本地，防后续操作覆盖三层原始现场；
  # 逐路径存在性守卫，[ -e "$P" ] || echo warn 模式，缺失路径视为合法降级不计入 FAIL_COUNT，
  # 但 tar 本身执行失败（路径存在却打包出错）计入 FAIL_COUNT）
  local STAMP TAR_TARGETS P
  STAMP=$(date +%Y%m%d%H%M%S)
  mkdir -p .calibration-output/f237-archive
  TAR_TARGETS=""
  for P in \
    "tests/baseline/tasks/SWE-V008-sympy-contains-as-set-returns" \
    "run_artifacts" \
    ".calibration-output/f237-live-forensics/SWE-V008-sympy-contains-as-set-returns" \
    "$HOME/.spec-driver-bench-worktrees/SWE-V008-sympy-contains-as-set-returns"; do
    [ -e "$P" ] && TAR_TARGETS="$TAR_TARGETS $P" || echo "[archive][warn] $P 不存在，跳过"
  done
  if [ -n "$TAR_TARGETS" ]; then
    if ! tar -czf ".calibration-output/f237-archive/v008-full-${STAMP}.tar.gz" $TAR_TARGETS; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
      echo "[archive][ERROR] 本地全量备份打包失败"
    fi
  else
    echo "[archive][warn] 无可归档路径，跳过本地全量备份"
  fi

  # C-5：核心 copy/tar/meta 抽取存在真实失败时禁止无条件宣称"归档完成"，以 exit 4 收尾；
  # C-4 守卫 3：watcher 只在归档成功（exit 0 路径）末尾 kill——失败路径不动 watcher，
  # 避免归档半途出错却把仍需持续覆盖运行的 watcher 提前杀掉、丢失后续追补机会
  if [ "$FAIL_COUNT" -gt 0 ]; then
    echo "[archive][v008] 归档存在 ${FAIL_COUNT} 处失败"
    exit 4
  fi

  # 归档完成后，kill 取证 watcher（T010 定义的 watcher 三种退出路径之一：取证归档完成后
  # 编排器显式 kill）；kill 后轮询确认其确已退出（最多等 30s）
  if [ -f .calibration-output/f237-watcher.pid ]; then
    local WATCHER_PID I
    WATCHER_PID=$(cat .calibration-output/f237-watcher.pid)
    if kill -0 "$WATCHER_PID" 2>/dev/null; then
      kill "$WATCHER_PID" 2>/dev/null || true
      for I in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        kill -0 "$WATCHER_PID" 2>/dev/null || break
        sleep 2
      done
      if kill -0 "$WATCHER_PID" 2>/dev/null; then
        echo "[archive][warn] watcher pid ${WATCHER_PID} 30s 内未确认退出"
      else
        echo "[archive][v008] watcher pid ${WATCHER_PID} 已确认退出"
      fi
    else
      echo "[archive][v008] watcher pid ${WATCHER_PID} 已不存活（无需 kill）"
    fi
  else
    echo "[archive][warn] f237-watcher.pid 不存在，跳过 kill watcher"
  fi

  echo "[archive][v008] 归档完成：${ORCH_EVIDENCE}"
}

case "$MODE" in
  pre) archive_pre ;;
  v008) archive_v008 "$FORCE_FLAG" ;;
esac
