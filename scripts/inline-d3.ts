/**
 * 构建期脚本：将 d3-force bundle 内联到 html-template.ts
 * 读取 node_modules/d3-force/dist/d3-force.min.js 和 node_modules/d3-force/package.json，
 * 生成并写入 src/panoramic/exporters/html-template.ts 中的 D3_FORCE_BUNDLE 常量
 *
 * 用法: tsx scripts/inline-d3.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// d3-force 文件路径
const D3_BUNDLE_PATH = path.join(projectRoot, 'node_modules', 'd3-force', 'dist', 'd3-force.min.js');
const D3_PKG_PATH = path.join(projectRoot, 'node_modules', 'd3-force', 'package.json');
const TEMPLATE_OUTPUT_PATH = path.join(projectRoot, 'src', 'panoramic', 'exporters', 'html-template.ts');

// 读取 d3-force bundle
if (!fs.existsSync(D3_BUNDLE_PATH)) {
  console.error(`[inline-d3] 找不到 d3-force bundle: ${D3_BUNDLE_PATH}`);
  console.error('[inline-d3] 请先运行 npm install d3-force --save-dev');
  process.exit(1);
}

const d3Bundle = fs.readFileSync(D3_BUNDLE_PATH, 'utf-8');

// 读取版本号
let d3Version = 'unknown';
if (fs.existsSync(D3_PKG_PATH)) {
  try {
    const pkgJson = JSON.parse(fs.readFileSync(D3_PKG_PATH, 'utf-8')) as { version?: string };
    d3Version = pkgJson.version ?? 'unknown';
  } catch {
    // 读取版本失败不阻断构建
  }
}

// 对 bundle 中的反引号和 ${} 转义，防止破坏模板字符串
const escapedBundle = d3Bundle.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

// 读取现有 html-template.ts 中 buildHtmlTemplate 函数的内容
// 如果文件已存在且包含 END_MARKER，则保留函数体部分（以保留手动修改）
const END_MARKER = '// --- END D3_FORCE_BUNDLE ---';
let existingFunctionBody = '';

if (fs.existsSync(TEMPLATE_OUTPUT_PATH)) {
  const existing = fs.readFileSync(TEMPLATE_OUTPUT_PATH, 'utf-8');
  const markerIdx = existing.indexOf(END_MARKER);
  if (markerIdx !== -1) {
    existingFunctionBody = existing.slice(markerIdx + END_MARKER.length).trimStart();
  }
}

// 如果没有现有函数体，生成默认的 buildHtmlTemplate 函数体
if (!existingFunctionBody) {
  existingFunctionBody = generateDefaultTemplateBody();
}

// 生成完整的 html-template.ts 文件内容
const output = [
  `/**`,
  ` * HTML 模板 + 内联 d3-force bundle`,
  ` * D3_FORCE_BUNDLE 由构建脚本 scripts/inline-d3.ts 在构建期自动写入`,
  ` * 请勿手动编辑 D3_FORCE_BUNDLE 常量（会被下次构建覆盖）`,
  ` *`,
  ` * d3-force 版本: ${d3Version}`,
  ` */`,
  ``,
  `// 内联 d3-force bundle — 由 scripts/inline-d3.ts 在构建期生成`,
  `// d3-force 版本: ${d3Version}`,
  `export const D3_FORCE_BUNDLE = \`${escapedBundle}\`;`,
  END_MARKER,
  ``,
  existingFunctionBody,
].join('\n');

// 内容未变化时跳过写入，保持工作树干净
if (fs.existsSync(TEMPLATE_OUTPUT_PATH) && fs.readFileSync(TEMPLATE_OUTPUT_PATH, 'utf-8') === output) {
  console.log(`[inline-d3] d3-force ${d3Version} 内容无变化，跳过写入`);
} else {
  fs.writeFileSync(TEMPLATE_OUTPUT_PATH, output, 'utf-8');
  console.log(`[inline-d3] d3-force ${d3Version} 已内联到 html-template.ts（bundle 长度: ${d3Bundle.length} 字符）`);
}

/**
 * 生成默认的 buildHtmlTemplate 函数体内容
 * 仅在 html-template.ts 中不存在该函数时使用
 */
function generateDefaultTemplateBody(): string {
  return `/**
 * 构建完整 HTML 模板
 * 将 d3 bundle、图谱数据 JSON、CSS、交互 JS 组装为单文件字符串
 *
 * @param graphDataJson - buildGraphData() 返回的 JSON 字符串
 * @returns 完整 HTML 字符串（单文件，包含所有内联资源）
 */
export function buildHtmlTemplate(graphDataJson: string): string {
  // 对 </script> 标签转义，防止浏览器提前关闭脚本块
  const safeJson = graphDataJson.replace(/<\\/script>/gi, '<\\/script>');
  // D3_FORCE_BUNDLE 的占位符将在运行时替换为实际 bundle
  return buildFullHtml(safeJson, D3_FORCE_BUNDLE);
}

/**
 * 组装完整 HTML 字符串（内部函数，便于测试）
 */
export function buildFullHtml(graphDataJson: string, d3Bundle: string): string {
  return \`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>知识图谱可视化</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; display: flex; height: 100vh; overflow: hidden; }
    #sidebar { width: 280px; min-width: 280px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; overflow: hidden; }
    #sidebar-header { padding: 16px; border-bottom: 1px solid #30363d; }
    #sidebar-header h1 { font-size: 14px; font-weight: 600; }
    #sidebar-header p { font-size: 12px; color: #8b949e; margin-top: 4px; }
    #search-section { padding: 12px 16px; border-bottom: 1px solid #30363d; }
    #search-input { width: 100%; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 13px; outline: none; }
    #search-input:focus { border-color: #388bfd; }
    #search-results { margin-top: 8px; max-height: 150px; overflow-y: auto; }
    .search-result-item { padding: 4px 8px; font-size: 12px; cursor: pointer; border-radius: 4px; color: #8b949e; }
    .search-result-item:hover { background: #21262d; color: #e6edf3; }
    #legend-section { padding: 12px 16px; border-bottom: 1px solid #30363d; flex-shrink: 0; }
    #legend-section h3 { font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
    #legend-list { max-height: 200px; overflow-y: auto; }
    .legend-item { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
    .legend-color { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .legend-label { font-size: 12px; color: #8b949e; }
    .legend-item.hidden .legend-label { text-decoration: line-through; opacity: 0.5; }
    #detail-section { padding: 12px 16px; flex: 1; overflow-y: auto; }
    #detail-section h3 { font-size: 12px; font-weight: 600; color: #8b949e; text-transform: uppercase; margin-bottom: 8px; }
    #detail-placeholder { font-size: 12px; color: #484f58; font-style: italic; }
    #node-detail { display: none; }
    #node-detail-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; word-break: break-all; }
    .detail-row { display: flex; gap: 8px; margin-bottom: 6px; }
    .detail-key { font-size: 11px; color: #8b949e; min-width: 60px; flex-shrink: 0; }
    .detail-value { font-size: 11px; word-break: break-all; }
    #canvas-area { flex: 1; position: relative; overflow: hidden; }
    #graph-svg { width: 100%; height: 100%; cursor: grab; }
    #graph-svg:active { cursor: grabbing; }
    #zoom-controls { position: absolute; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 4px; }
    .zoom-btn { width: 32px; height: 32px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .zoom-btn:hover { background: #30363d; }
    .node circle { stroke: #30363d; stroke-width: 1.5; }
    .node circle.highlighted { stroke: #f0883e; stroke-width: 3; }
    .node circle.god-node { stroke: #d29922; stroke-width: 2; }
    .node text { font-size: 10px; fill: #8b949e; pointer-events: none; }
    .link { stroke-opacity: 0.4; }
  </style>
</head>
<body>
  <div id="sidebar">
    <div id="sidebar-header">
      <h1>知识图谱</h1>
      <p id="graph-stats">加载中...</p>
    </div>
    <div id="search-section">
      <input id="search-input" type="text" placeholder="搜索节点..." autocomplete="off" />
      <div id="search-results"></div>
    </div>
    <div id="legend-section">
      <h3>社区图例</h3>
      <div id="legend-list"></div>
    </div>
    <div id="detail-section">
      <h3>节点详情</h3>
      <div id="detail-placeholder">点击节点查看详情</div>
      <div id="node-detail">
        <div id="node-detail-title"></div>
        <div id="node-detail-rows"></div>
      </div>
    </div>
  </div>
  <div id="canvas-area">
    <svg id="graph-svg">
      <g id="graph-group">
        <g id="links-layer"></g>
        <g id="nodes-layer"></g>
      </g>
    </svg>
    <div id="zoom-controls">
      <button class="zoom-btn" id="zoom-in-btn" title="放大">+</button>
      <button class="zoom-btn" id="zoom-reset-btn" title="重置">&#8857;</button>
      <button class="zoom-btn" id="zoom-out-btn" title="缩小">-</button>
    </div>
  </div>
  <script>\${d3Bundle}</script>
  <script>
(function() {
  'use strict';
  var GRAPH_DATA = \${safeJson};
  var hiddenCommunities = new Set();
  var currentTransform = { x: 0, y: 0, k: 1 };
  var svg = document.getElementById('graph-svg');
  var graphGroup = document.getElementById('graph-group');
  var linksLayer = document.getElementById('links-layer');
  var nodesLayer = document.getElementById('nodes-layer');

  function applyTransform(x, y, k) {
    currentTransform = { x: x, y: y, k: k };
    graphGroup.setAttribute('transform', 'translate(' + x + ',' + y + ') scale(' + k + ')');
  }

  function centerGraph() {
    var rect = svg.getBoundingClientRect();
    applyTransform(rect.width / 2, rect.height / 2, 0.8);
  }

  function initStats() {
    var el = document.getElementById('graph-stats');
    if (el) el.textContent = GRAPH_DATA.nodes.length + ' 节点 · ' + GRAPH_DATA.links.length + ' 边';
  }

  function buildLegend() {
    var list = document.getElementById('legend-list');
    if (!list) return;
    (GRAPH_DATA.communities || []).forEach(function(comm) {
      var item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.communityId = comm.id;
      var dot = document.createElement('div');
      dot.className = 'legend-color';
      dot.style.background = comm.color;
      var label = document.createElement('div');
      label.className = 'legend-label';
      label.textContent = '社区 ' + comm.id + ' (' + comm.nodeCount + ' 节点)';
      item.appendChild(dot);
      item.appendChild(label);
      item.addEventListener('click', function() {
        if (hiddenCommunities.has(comm.id)) { hiddenCommunities.delete(comm.id); item.classList.remove('hidden'); }
        else { hiddenCommunities.add(comm.id); item.classList.add('hidden'); }
        document.querySelectorAll('.node').forEach(function(n) {
          n.style.display = hiddenCommunities.has(parseInt(n.dataset.communityId || '-1', 10)) ? 'none' : '';
        });
        document.querySelectorAll('.link').forEach(function(l) {
          var sc = parseInt(l.dataset.sourceCommunity || '-1', 10);
          var tc = parseInt(l.dataset.targetCommunity || '-1', 10);
          l.style.display = (hiddenCommunities.has(sc) || hiddenCommunities.has(tc)) ? 'none' : '';
        });
      });
      list.appendChild(item);
    });
  }

  var nodeCommMap = new Map();
  GRAPH_DATA.nodes.forEach(function(n) { nodeCommMap.set(n.id, n.communityId); });

  function renderLinks(links) {
    return links.map(function(link) {
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.classList.add('link');
      line.dataset.sourceCommunity = String(nodeCommMap.get(link.source) != null ? nodeCommMap.get(link.source) : -1);
      line.dataset.targetCommunity = String(nodeCommMap.get(link.target) != null ? nodeCommMap.get(link.target) : -1);
      line.setAttribute('stroke', '#30363d');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-opacity', String(link.opacity != null ? link.opacity : 0.4));
      linksLayer.appendChild(line);
      return line;
    });
  }

  function renderNodes(nodes) {
    return nodes.map(function(node) {
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('node');
      g.dataset.id = node.id;
      g.dataset.communityId = String(node.communityId != null ? node.communityId : -1);
      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(node.radius != null ? node.radius : 6));
      circle.setAttribute('fill', node.color || '#58a6ff');
      if (node.isGodNode) circle.classList.add('god-node');
      g.appendChild(circle);
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String((node.radius != null ? node.radius : 6) + 3));
      text.setAttribute('y', '4');
      text.textContent = node.label || node.id;
      g.appendChild(text);
      g.addEventListener('click', function() { showDetail(node); });
      nodesLayer.appendChild(g);
      return { el: g, node: node };
    });
  }

  function showDetail(node) {
    document.getElementById('detail-placeholder').style.display = 'none';
    document.getElementById('node-detail').style.display = 'block';
    document.getElementById('node-detail-title').textContent = node.label || node.id;
    var rows = document.getElementById('node-detail-rows');
    rows.innerHTML = '';
    [['ID', node.id], ['类型', node.kind || '—'], ['度数', String(node.degree != null ? node.degree : '—')],
     ['社区', node.communityId >= 0 ? '社区 ' + node.communityId : '未分类'],
     ['God Node', node.isGodNode ? '是' : '否']
    ].forEach(function(r) {
      var row = document.createElement('div');
      row.className = 'detail-row';
      row.innerHTML = '<span class="detail-key">' + r[0] + '</span><span class="detail-value">' + r[1] + '</span>';
      rows.appendChild(row);
    });
    document.querySelectorAll('.node circle.highlighted').forEach(function(el) { el.classList.remove('highlighted'); });
    var nodeEl = nodesLayer.querySelector('[data-id="' + node.id.replace(/"/g, '\\\\"') + '"] circle');
    if (nodeEl) nodeEl.classList.add('highlighted');
  }

  function initSearch() {
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    input.addEventListener('input', function() {
      var q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (!q) return;
      GRAPH_DATA.nodes.filter(function(n) {
        return (n.label || '').toLowerCase().indexOf(q) !== -1 || n.id.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 20).forEach(function(node) {
        var item = document.createElement('div');
        item.className = 'search-result-item';
        item.textContent = node.label || node.id;
        item.addEventListener('click', function() {
          var x = node.fx != null ? node.fx : (node.x || 0);
          var y = node.fy != null ? node.fy : (node.y || 0);
          var rect = svg.getBoundingClientRect();
          applyTransform(rect.width / 2 - x * currentTransform.k, rect.height / 2 - y * currentTransform.k, currentTransform.k);
          showDetail(node);
          results.innerHTML = '';
          input.value = '';
        });
        results.appendChild(item);
      });
    });
  }

  function initZoomPan() {
    var dragging = false, dragStart = {x:0,y:0}, tStart = {x:0,y:0};
    svg.addEventListener('mousedown', function(e) {
      if (e.target !== svg && e.target !== graphGroup) return;
      dragging = true; dragStart = {x:e.clientX,y:e.clientY}; tStart = {x:currentTransform.x,y:currentTransform.y};
      e.preventDefault();
    });
    window.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      applyTransform(tStart.x + e.clientX - dragStart.x, tStart.y + e.clientY - dragStart.y, currentTransform.k);
    });
    window.addEventListener('mouseup', function() { dragging = false; });
    svg.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      var newK = Math.min(Math.max(currentTransform.k * delta, 0.1), 8);
      var rect = svg.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      applyTransform(mx - (mx - currentTransform.x) * (newK / currentTransform.k), my - (my - currentTransform.y) * (newK / currentTransform.k), newK);
    }, { passive: false });
    document.getElementById('zoom-in-btn').addEventListener('click', function() { applyTransform(currentTransform.x, currentTransform.y, Math.min(currentTransform.k * 1.3, 8)); });
    document.getElementById('zoom-out-btn').addEventListener('click', function() { applyTransform(currentTransform.x, currentTransform.y, Math.max(currentTransform.k * 0.77, 0.1)); });
    document.getElementById('zoom-reset-btn').addEventListener('click', centerGraph);
  }

  function updateLinks(linkEls, linkData) {
    linkEls.forEach(function(el, i) {
      var link = linkData[i];
      if (!link) return;
      var src = typeof link.source === 'object' && link.source !== null ? link.source : { x: 0, y: 0 };
      var tgt = typeof link.target === 'object' && link.target !== null ? link.target : { x: 0, y: 0 };
      el.setAttribute('x1', String(src.x || 0)); el.setAttribute('y1', String(src.y || 0));
      el.setAttribute('x2', String(tgt.x || 0)); el.setAttribute('y2', String(tgt.y || 0));
    });
  }

  function updateNodes(nodeEls) {
    nodeEls.forEach(function(ne) {
      ne.el.setAttribute('transform', 'translate(' + (ne.node.x || 0) + ',' + (ne.node.y || 0) + ')');
    });
  }

  function main() {
    initStats(); buildLegend(); initSearch(); initZoomPan();
    var nodes = GRAPH_DATA.nodes;
    var links = GRAPH_DATA.links;
    var isLarge = nodes.length > 5000;
    var linkEls = renderLinks(links);
    var nodeEls = renderNodes(nodes);

    if (isLarge) {
      var nodeById = new Map(nodes.map(function(n) { return [n.id, n]; }));
      nodes.forEach(function(n) { n.x = n.fx || 0; n.y = n.fy || 0; });
      links.forEach(function(link) {
        var s = nodeById.get(link.source); var t = nodeById.get(link.target);
        if (s) link.source = s; if (t) link.target = t;
      });
      updateNodes(nodeEls); updateLinks(linkEls, links); centerGraph();
    } else {
      var sim = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(function(d) { return d.id; }).distance(60).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-150))
        .force('center', d3.forceCenter(0, 0))
        .force('collision', d3.forceCollide().radius(function(d) { return (d.radius || 6) + 4; }));
      sim.on('tick', function() { updateNodes(nodeEls); updateLinks(linkEls, links); });
      sim.on('end', centerGraph);
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', main); }
  else { main(); }
})();
  </script>
</body>
</html>\`;
}
`;
}
