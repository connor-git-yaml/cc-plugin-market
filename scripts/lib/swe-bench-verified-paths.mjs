/**
 * Feature 176 — SWE-Bench Verified 评测 fixture 路径单一权威。
 *
 * 目的（codex Plan WARNING：spec/plan 目录漂移）：importer / batch / report / verify
 * 全部从此模块取路径常量，杜绝四处硬编码 `tests/baseline/swe-bench-verified` 字面量
 * 导致读写不同目录、聚合漏算或误入库。
 *
 * 关联：spec FR-A-006（含 repeatIndex 隔离），tasks T-A1。
 *
 * 入库边界（CON-1）：VERIFIED_ROOT 整树都是可再生评测产物（fixture/tasks/repeats/
 * aggregate），**不入库**（.gitignore）。可复现的事实源是 specs/176 的
 * preregistration.md（记录 task id + 筛选规则 + seed），fixture 由 importer 重生。
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 评测树根（相对仓库根）。所有子路径都从此派生。 */
export const VERIFIED_ROOT_REL = 'tests/baseline/swe-bench-verified';
export const VERIFIED_ROOT = path.join(PROJECT_ROOT, VERIFIED_ROOT_REL);

/** 导入的 Verified task fixture 目录（importer 产物）。 */
export function fixturesDir() {
  return path.join(VERIFIED_ROOT, 'fixtures');
}

/**
 * 单个 run 的 fixture 路径，含 repeatIndex 隔离（FR-A-006/006b）。
 * 形如 tests/baseline/swe-bench-verified/tasks/<task>/<cohort>/r<repeatIndex>/full.json
 */
export function runFixturePath(taskId, cohort, repeatIndex) {
  if (!taskId || !cohort) throw new Error('runFixturePath: taskId 和 cohort 必填');
  if (!Number.isInteger(repeatIndex) || repeatIndex < 1) {
    throw new Error(`runFixturePath: repeatIndex 必须是 ≥1 的整数，收到 ${repeatIndex}`);
  }
  return path.join(VERIFIED_ROOT, 'tasks', taskId, cohort, `r${repeatIndex}`, 'full.json');
}

/** 某 (task, cohort) 的 run 根目录（含全部 repeat），用于隔离校验。 */
export function runCombDir(taskId, cohort) {
  return path.join(VERIFIED_ROOT, 'tasks', taskId, cohort);
}

/** cross-cohort 聚合产物目录（aggregate / cohort-aggregate.json 等）。 */
export function aggregateDir() {
  return path.join(VERIFIED_ROOT, 'aggregate');
}

/** host 真实执行产物：spike-result 由脚本写到 specs（入库验证）；smoke/full 落 VERIFIED_ROOT。 */
export function smokeDir() {
  return path.join(VERIFIED_ROOT, 'smoke');
}
