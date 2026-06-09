/**
 * Feature 176 — 预注册一致性校验（tasks T-A3；spec FR-A-002b）。
 *
 * 防 falsification 规避：全量跑前冻结 10 个 task id + 筛选规则 + seed 到入库的
 * preregistration.md；batch 启动用本模块校验"实际要跑的 task 集" == "冻结的 task 集"，
 * 不一致 hard-fail，杜绝跑后换 task / 选择性剔除来粉饰 lift。
 *
 * taskSetHash = sha256(sorted(taskIds).join('\n'))，与具体顺序无关。
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

/** 顺序无关的 task 集指纹。 */
export function computeTaskSetHash(taskIds) {
  const sorted = [...new Set(taskIds)].sort();
  return crypto.createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/**
 * 从 preregistration.md frontmatter 解析 taskSetHash / frozen / taskIds。
 * 严格逐行解析（无 yaml 依赖，codex WARNING）：兼容 CRLF、quoted hash、inline + 多行 list、
 * frozen 用词边界（避免 truex 误匹配）。
 */
export function parsePreregistration(mdText) {
  const text = String(mdText).replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('preregistration.md 缺 frontmatter');
  const lines = m[1].split('\n');

  let hash = null;
  let frozen = false;
  let taskIds = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hashM = line.match(/^\s*taskSetHash:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
    if (hashM) hash = hashM[1].toLowerCase();
    const frozenM = line.match(/^\s*frozen:\s*(true|false)\b/);
    if (frozenM) frozen = frozenM[1] === 'true';
    const inlineM = line.match(/^\s*taskIds:\s*\[([^\]]*)\]\s*$/);
    if (inlineM) {
      taskIds = inlineM[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (/^\s*taskIds:\s*$/.test(line)) {
      // 多行 list：后续 `  - id` 行
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s*-\s*["']?([^"'\s].*?)["']?\s*$/);
        if (!item) break;
        taskIds.push(item[1].trim());
      }
    }
  }
  return { hash, frozen, taskIds };
}

/**
 * 校验实际 task 集与预注册一致。
 *
 * 防绕过分层（codex CRITICAL：只读同文件 hash 可被"改 ids + 重算 hash"绕过）：
 *   1. 内部一致性：frontmatter.taskIds 的 hash 必须 == taskSetHash（不能 ids 说一套 hash 另一套）；
 *   2. 实际跑的 task 集 hash == taskSetHash；
 *   3. 可选外部锚 expectedHash（来自 env/manifest/CI，非同文件）—— 传入则必须三者一致；
 *   4. 真正的 anti-tamper 是 git：prereg.md 入库且在全量前冻结，报告记录其 commit/blob，
 *      事后篡改在 git 历史可见（见 preregistration.md 说明 + 报告记录）。
 * @param {object} [opts] { expectedHash }
 */
export function checkPreregistration(actualTaskIds, preregPath, opts = {}) {
  const actualHash = computeTaskSetHash(actualTaskIds);
  if (!fs.existsSync(preregPath)) {
    return { ok: false, reason: `preregistration.md 不存在: ${preregPath}（先冻结预注册）`, expectedHash: null, actualHash };
  }
  const { hash, frozen, taskIds } = parsePreregistration(fs.readFileSync(preregPath, 'utf-8'));
  if (!frozen) return { ok: false, reason: 'preregistration 未冻结（frozen!=true）', expectedHash: hash, actualHash };
  if (!hash) return { ok: false, reason: 'preregistration 缺 taskSetHash', expectedHash: null, actualHash };

  // (1) 内部一致性：列出的 taskIds 必须自洽算出同一 hash
  if (taskIds.length > 0) {
    const idsHash = computeTaskSetHash(taskIds);
    if (idsHash !== hash) {
      return { ok: false, reason: `预注册内部不一致：taskIds 算出的 hash(${idsHash.slice(0, 12)}) ≠ taskSetHash(${hash.slice(0, 12)}) — 文件被改但 hash 未同步/被篡改`, expectedHash: hash, actualHash };
    }
  }
  // (3) 外部锚（可选）
  if (opts.expectedHash && opts.expectedHash !== hash) {
    return { ok: false, reason: `预注册 hash 与外部锚 expectedHash 不符（疑似 prereg 被替换）`, expectedHash: opts.expectedHash, actualHash };
  }
  // (2) 实际 task 集一致
  if (hash !== actualHash) {
    return {
      ok: false,
      reason: `task 集与预注册不符（疑似跑后换 task）。expected=${hash.slice(0, 12)} actual=${actualHash.slice(0, 12)}`,
      expectedHash: hash, actualHash,
    };
  }
  return { ok: true, reason: `OK：task 集与预注册一致（${actualTaskIds.length} task）`, expectedHash: hash, actualHash };
}

/** 冻结辅助：给定 taskIds 算 hash，供 host import 后写入 preregistration.md。 */
export function freezeBlock(taskIds, { seed, filterRule, gitCommit } = {}) {
  const hash = computeTaskSetHash(taskIds);
  return {
    taskSetHash: hash,
    frozen: true,
    count: taskIds.length,
    seed: seed ?? null,
    filterRule: filterRule ?? null,
    gitCommit: gitCommit ?? null,
    taskIds: [...taskIds].sort(),
  };
}
