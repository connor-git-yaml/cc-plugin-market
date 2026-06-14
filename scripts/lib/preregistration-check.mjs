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
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** 顺序无关的 task 集指纹。 */
export function computeTaskSetHash(taskIds) {
  const sorted = [...new Set(taskIds)].sort();
  return crypto.createHash('sha256').update(sorted.join('\n')).digest('hex');
}

/** Feature 187 freezeBlock schema 版本（oracleSpecHash 规则变更时升版）。 */
export const FREEZE_SCHEMA_VERSION = '1.0';

/**
 * 判分语义模块（Codex C-2/C3：任一变更都改判分，必须纳入 oracleSpecHash）。
 * 含 dataset builder + fetch helper —— W1 校验/官方行获取逻辑变更同样影响判分（执行的测试集）。
 */
export const SEMANTIC_MODULES = ['classify-oracle.mjs', 'phase-markers.mjs', 'swebench-oracle.mjs', 'swebench-dataset-build.mjs', 'swebench_fetch_rows.py'];

/** 递归 sort key 的稳定序列化（不依赖第三方；固定 key 顺序 → 跨平台稳定 hash 输入）。 */
export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 读判分语义模块源码摘要 {模块名: sha256}（libDir 默认本模块同目录 scripts/lib）。 */
export function readSemanticModuleShas(libDir) {
  const dir = libDir || path.dirname(new URL(import.meta.url).pathname);
  const out = {};
  for (const name of SEMANTIC_MODULES) {
    const src = fs.readFileSync(path.join(dir, name), 'utf-8');
    out[name] = crypto.createHash('sha256').update(src).digest('hex');
  }
  return out;
}

/**
 * oracleSpecHash（Codex C-2 / Q2「冻结 oracle 语义」）：覆盖运行时配置 + 判分语义模块源码摘要
 * + swebench 版本。canonical = stableStringify → sha256。改分类逻辑/marker/runner 任一 → hash 变化。
 * @param {object} spec {kind, timeout, arch, datasetSource, swebenchVersion, semanticModuleShas}
 */
export function computeOracleSpecHash(spec = {}) {
  const canonical = stableStringify({
    schemaVersion: FREEZE_SCHEMA_VERSION,
    kind: spec.kind ?? null,
    timeout: spec.timeout ?? null,
    arch: spec.arch ?? null,
    datasetSource: spec.datasetSource ?? null,
    swebenchVersion: spec.swebenchVersion ?? null,
    semanticModuleShas: spec.semanticModuleShas ?? {},
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
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
  let oracleSpecHash = null;
  let fixtureContentHash = null;
  let schemaVersion = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hashM = line.match(/^\s*taskSetHash:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
    if (hashM) hash = hashM[1].toLowerCase();
    const oracleM = line.match(/^\s*oracleSpecHash:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
    if (oracleM) oracleSpecHash = oracleM[1].toLowerCase();
    const fixM = line.match(/^\s*fixtureContentHash:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
    if (fixM) fixtureContentHash = fixM[1].toLowerCase();
    const svM = line.match(/^\s*schemaVersion:\s*["']?([\w.]+)["']?\s*$/);
    if (svM) schemaVersion = svM[1];
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
  return { hash, frozen, taskIds, oracleSpecHash, fixtureContentHash, schemaVersion };
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
 * @param {object} [opts] { expectedHash, oracleKind, oracleSpecInput, manifest }
 *   oracleKind='swebench-execution' 时（Codex C-2 / Q2 冻结 oracle 语义）：
 *     - prereg 缺 oracleSpecHash → hard-fail（不允许语义不明跑批）；
 *     - 传 oracleSpecInput 时重算 computeOracleSpecHash 并比对 prereg 值，不一致 → fail（疑似跑前换判分/改分类代码）。
 *   其他 kind 缺 oracleSpecHash → warn（向后兼容旧 prereg，不 hard-fail）。
 */
export function checkPreregistration(actualTaskIds, preregPath, opts = {}) {
  const actualHash = computeTaskSetHash(actualTaskIds);
  if (!fs.existsSync(preregPath)) {
    return { ok: false, reason: `preregistration.md 不存在: ${preregPath}（先冻结预注册）`, expectedHash: null, actualHash };
  }
  const { hash, frozen, taskIds, oracleSpecHash } = parsePreregistration(fs.readFileSync(preregPath, 'utf-8'));
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
  // (4) oracle 语义冻结校验（Codex C-2 / Q2）
  const warnings = [];
  if (opts.oracleKind === 'swebench-execution') {
    if (!oracleSpecHash) {
      return { ok: false, reason: 'swebench-execution kind 要求 oracleSpecHash，但 preregistration 缺该字段（请用扩展后 freeze 脚本重新冻结）', expectedHash: hash, actualHash };
    }
    if (opts.oracleSpecInput) {
      const live = computeOracleSpecHash(opts.oracleSpecInput);
      if (live !== oracleSpecHash) {
        return { ok: false, reason: `oracleSpecHash 不符（疑似跑前换判分/改分类逻辑代码）。frozen=${oracleSpecHash.slice(0, 12)} live=${live.slice(0, 12)}`, expectedHash: hash, actualHash, oracleSpecHash, liveOracleSpecHash: live };
      }
    }
  } else if (!oracleSpecHash) {
    warnings.push('preregistration 缺 oracleSpecHash（非 swebench-execution kind，向后兼容放行；建议重新冻结）');
  }
  return { ok: true, reason: `OK：task 集与预注册一致（${actualTaskIds.length} task）`, expectedHash: hash, actualHash, warnings };
}

/**
 * 冻结辅助：给定 taskIds 算 hash，供 host import 后写入 preregistration.md。
 * Feature 187 扩展（向后兼容）：传 oracleSpecInput / fixtureContentHash / promptSha256 /
 * datasetSourceDigest 时一并冻结；oracleSpecInput 现算 oracleSpecHash（Q2 冻结 oracle 语义）。
 */
export function freezeBlock(taskIds, opts = {}) {
  const { seed, filterRule, gitCommit, oracleSpecInput, fixtureContentHash, promptSha256, datasetSourceDigest } = opts;
  const hash = computeTaskSetHash(taskIds);
  const block = {
    schemaVersion: FREEZE_SCHEMA_VERSION,
    taskSetHash: hash,
    frozen: true,
    count: taskIds.length,
    seed: seed ?? null,
    filterRule: filterRule ?? null,
    gitCommit: gitCommit ?? null,
    taskIds: [...taskIds].sort(),
  };
  if (oracleSpecInput) block.oracleSpecHash = computeOracleSpecHash(oracleSpecInput);
  if (fixtureContentHash) block.fixtureContentHash = fixtureContentHash;
  if (promptSha256) block.promptSha256 = promptSha256;
  if (datasetSourceDigest) block.datasetSourceDigest = datasetSourceDigest;
  return block;
}
