#!/usr/bin/env node
/**
 * Feature 147 — T2 setup helper
 *
 * nanoGPT 的 startCommit 已经包含完整的 cosine LR scheduler。
 * 为了让 T2 task（"实现 cosine LR scheduler"）实际有 work to do，
 * 在 setup 阶段移除已存在的 get_lr 函数 + 训练循环里的 lr-set 块。
 *
 * 用法（被 task fixture 的 setupCommands 调用）：
 *   node <repo-root>/scripts/eval-task-setup-T2-strip-cosine-lr.mjs
 *   （cwd = worktree dir，script 会就地修改 ./train.py）
 *
 * Idempotent：如果 cosine LR 已经被剥离则 noop。
 */

import * as fs from 'node:fs';

const FILE = 'train.py';
const SCHEDULER_BLOCK = /\n# learning rate decay scheduler[\s\S]*?return min_lr \+ coeff \* \(learning_rate - min_lr\)\n/;
const LOOP_LR_BLOCK = /\n    # determine and set the learning rate for this iteration\n    lr = get_lr[\s\S]*?param_group\['lr'\] = lr\n/;

if (!fs.existsSync(FILE)) {
  console.error(`[T2-setup] ${FILE} not found in cwd ${process.cwd()}`);
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf-8');
const before = src.length;
src = src.replace(SCHEDULER_BLOCK, '\n');
src = src.replace(LOOP_LR_BLOCK, '\n');

if (src.length === before) {
  console.error('[T2-setup] cosine LR already absent (idempotent noop)');
} else {
  fs.writeFileSync(FILE, src, 'utf-8');
  console.error(`[T2-setup] stripped ${before - src.length} bytes from ${FILE}`);
}
