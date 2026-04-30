/**
 * Feature 147 Phase 1 — quality 段静态分析 lib
 *
 * 输入：spectra batch outputDir（含 modules/*.spec.md + _meta/graph.json）
 * 输出：fixture quality 段三大子段
 *   - specStructure: spec.md 结构完整性 + 长度合理性
 *   - graphSanity: graph 拓扑健康（孤立节点 / 自循环 / missing target）
 *   - crossLinks: spec markdown 的 [text](path) 链接完整性
 *
 * 全部静态分析，零 LLM cost。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// Spec structure analysis
// ============================================================

/**
 * 必含章节 marker（grep 大小写不敏感）。基于 spectra v4.x 实际 spec.md 输出格式：
 * `## 1. 意图` / `## 2. 业务逻辑` / `## 3. 接口定义` / `## 4. 数据结构`。
 * 容许其他工具的英文 / 替代命名（Intent / Behavior / API / Data Model 等）。
 */
const REQUIRED_SECTIONS = {
  intent: /^##\s+(\d+\.\s+)?(意图|Intent|Purpose)/im,
  behavior: /^##\s+(\d+\.\s+)?(业务逻辑|Behavior|Logic)/im,
  api: /^##\s+(\d+\.\s+)?(接口定义|Inputs?|Outputs?|API|Interface)/im,
  dataModel: /^##\s+(\d+\.\s+)?(数据结构|Data\s*Model|Data\s*Structure|State)/im,
};

const VERY_SHORT_THRESHOLD = 100; // < 100 行视为可疑空洞
const VERY_LONG_THRESHOLD = 1000; // > 1000 行视为可疑啰嗦

export function parseSpecStructure(modulesDir) {
  if (!fs.existsSync(modulesDir)) {
    return {
      modulesWithIntent: 0,
      modulesWithInputsOutputs: 0,
      averageSpecLines: 0,
      shorterThan100Lines: 0,
      longerThan1000Lines: 0,
      outlierFiles: [],
      moduleCount: 0,
      _note: 'modules dir not found',
    };
  }

  const specFiles = fs
    .readdirSync(modulesDir)
    .filter((n) => n.endsWith('.spec.md'))
    .map((n) => ({ name: n, path: path.join(modulesDir, n) }));

  let modulesWithIntent = 0;
  let modulesWithBehavior = 0;
  let modulesWithApi = 0;
  let modulesWithDataModel = 0;
  let modulesWithAllFour = 0; // 完整结构（4 章节齐全）
  let totalLines = 0;
  let shortCount = 0;
  let longCount = 0;
  const outlierFiles = [];

  for (const f of specFiles) {
    const content = fs.readFileSync(f.path, 'utf-8');
    const lineCount = content.split('\n').length;
    totalLines += lineCount;

    const hasIntent = REQUIRED_SECTIONS.intent.test(content);
    const hasBehavior = REQUIRED_SECTIONS.behavior.test(content);
    const hasApi = REQUIRED_SECTIONS.api.test(content);
    const hasDataModel = REQUIRED_SECTIONS.dataModel.test(content);

    if (hasIntent) modulesWithIntent++;
    if (hasBehavior) modulesWithBehavior++;
    if (hasApi) modulesWithApi++;
    if (hasDataModel) modulesWithDataModel++;
    if (hasIntent && hasBehavior && hasApi && hasDataModel) modulesWithAllFour++;

    if (lineCount < VERY_SHORT_THRESHOLD) {
      shortCount++;
      outlierFiles.push(`${f.name} (${lineCount} lines, too short)`);
    } else if (lineCount > VERY_LONG_THRESHOLD) {
      longCount++;
      outlierFiles.push(`${f.name} (${lineCount} lines, too long)`);
    }
  }

  return {
    modulesWithIntent,
    modulesWithBehavior,
    modulesWithApi,
    modulesWithDataModel,
    modulesWithAllFour, // 4 章节齐全 = 结构完整
    modulesWithInputsOutputs: modulesWithApi, // 兼容老命名（schema 1.1 文档列出）
    averageSpecLines: specFiles.length > 0 ? Math.round(totalLines / specFiles.length) : 0,
    shorterThan100Lines: shortCount,
    longerThan1000Lines: longCount,
    outlierFiles,
    moduleCount: specFiles.length,
  };
}

// ============================================================
// Graph sanity analysis
// ============================================================

export function parseGraphSanity(graphJsonPath) {
  if (!fs.existsSync(graphJsonPath)) {
    return {
      isolatedNodes: null,
      selfLoops: null,
      edgesWithMissingTarget: null,
      averageDegree: null,
      maxDegree: null,
      edgesWithoutType: null,
      _note: 'graph.json not found',
    };
  }

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(graphJsonPath, 'utf-8'));
  } catch (e) {
    return {
      isolatedNodes: null,
      selfLoops: null,
      edgesWithMissingTarget: null,
      averageDegree: null,
      maxDegree: null,
      edgesWithoutType: null,
      _note: `parse error: ${e.message}`,
    };
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];

  const nodeIds = new Set(nodes.map((n) => n.id ?? n.name));
  const degree = new Map();
  let selfLoops = 0;
  let edgesWithMissingTarget = 0;
  let edgesWithoutType = 0;

  for (const e of links) {
    const src = e.source ?? e.from;
    const dst = e.target ?? e.to;
    if (src === dst) selfLoops++;
    if (!nodeIds.has(src) || !nodeIds.has(dst)) edgesWithMissingTarget++;
    if (!e.type && !e.kind) edgesWithoutType++;
    degree.set(src, (degree.get(src) ?? 0) + 1);
    degree.set(dst, (degree.get(dst) ?? 0) + 1);
  }

  const isolatedNodes = nodes.filter((n) => !degree.has(n.id ?? n.name)).length;
  const degreeValues = [...degree.values()];
  const totalDegree = degreeValues.reduce((s, v) => s + v, 0);
  const averageDegree = nodes.length > 0 ? Math.round((totalDegree / nodes.length) * 10) / 10 : 0;
  const maxDegree = degreeValues.length > 0 ? Math.max(...degreeValues) : 0;

  return {
    isolatedNodes,
    selfLoops,
    edgesWithMissingTarget,
    averageDegree,
    maxDegree,
    edgesWithoutType,
  };
}

// ============================================================
// Cross-links analysis
// ============================================================

const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function parseCrossLinks(modulesDir, projectRoot) {
  if (!fs.existsSync(modulesDir)) {
    return { totalLinks: 0, brokenLinks: 0, externalLinks: 0, _note: 'modules dir not found' };
  }

  const specFiles = fs.readdirSync(modulesDir).filter((n) => n.endsWith('.spec.md'));

  let totalLinks = 0;
  let brokenLinks = 0;
  let externalLinks = 0;

  for (const fname of specFiles) {
    const content = fs.readFileSync(path.join(modulesDir, fname), 'utf-8');
    let match;
    MD_LINK_RE.lastIndex = 0;
    while ((match = MD_LINK_RE.exec(content)) !== null) {
      totalLinks++;
      const target = match[2];
      if (target.startsWith('http://') || target.startsWith('https://')) {
        externalLinks++;
        continue;
      }
      if (target.startsWith('#')) continue; // 锚点不算 broken
      // 解析相对路径（相对于 spec 文件目录或 projectRoot）
      const candidates = [
        path.resolve(modulesDir, target.split('#')[0].split('?')[0]),
        path.resolve(projectRoot ?? modulesDir, target.split('#')[0].split('?')[0]),
      ];
      const exists = candidates.some((c) => fs.existsSync(c));
      if (!exists) brokenLinks++;
    }
  }

  return { totalLinks, brokenLinks, externalLinks };
}

// ============================================================
// 聚合（组装 fixture 的 quality 段）
// ============================================================

/**
 * @param {string} outputDir - spectra batch outputDir（含 modules/ + _meta/graph.json）
 * @param {string} [projectRoot] - 可选 baseline target 项目根（用于 crossLinks 路径解析）
 */
export function buildQualitySection(outputDir, projectRoot) {
  const modulesDir = path.join(outputDir, 'modules');
  const graphJsonPath = path.join(outputDir, '_meta', 'graph.json');

  return {
    specStructure: parseSpecStructure(modulesDir),
    graphSanity: parseGraphSanity(graphJsonPath),
    crossLinks: parseCrossLinks(modulesDir, projectRoot),
    codingContextGrounding: null, // Phase 2 填
    graphTopologyAccuracy: null, // Phase 1 Graphify 对比时填
  };
}
