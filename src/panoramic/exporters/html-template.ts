/**
 * HTML 模板 + 内联 d3-force bundle
 * D3_FORCE_BUNDLE 由构建脚本 scripts/inline-d3.ts 在构建期自动写入
 * 请勿手动编辑 D3_FORCE_BUNDLE 常量（会被下次构建覆盖）
 *
 * d3-force 版本: 3.0.0
 * 生成时间: 2026-04-13T02:03:34.623Z
 */

// 内联 d3-force bundle — 由 scripts/inline-d3.ts 在构建期生成
// d3-force 版本: 3.0.0
export const D3_FORCE_BUNDLE = `// https://d3js.org/d3-force/ v3.0.0 Copyright 2010-2021 Mike Bostock
!function(n,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports,require("d3-quadtree"),require("d3-dispatch"),require("d3-timer")):"function"==typeof define&&define.amd?define(["exports","d3-quadtree","d3-dispatch","d3-timer"],t):t((n="undefined"!=typeof globalThis?globalThis:n||self).d3=n.d3||{},n.d3,n.d3,n.d3)}(this,(function(n,t,e,r){"use strict";function i(n){return function(){return n}}function u(n){return 1e-6*(n()-.5)}function o(n){return n.x+n.vx}function f(n){return n.y+n.vy}function a(n){return n.index}function c(n,t){var e=n.get(t);if(!e)throw new Error("node not found: "+t);return e}const l=4294967296;function h(n){return n.x}function v(n){return n.y}var y=Math.PI*(3-Math.sqrt(5));n.forceCenter=function(n,t){var e,r=1;function i(){var i,u,o=e.length,f=0,a=0;for(i=0;i<o;++i)f+=(u=e[i]).x,a+=u.y;for(f=(f/o-n)*r,a=(a/o-t)*r,i=0;i<o;++i)(u=e[i]).x-=f,u.y-=a}return null==n&&(n=0),null==t&&(t=0),i.initialize=function(n){e=n},i.x=function(t){return arguments.length?(n=+t,i):n},i.y=function(n){return arguments.length?(t=+n,i):t},i.strength=function(n){return arguments.length?(r=+n,i):r},i},n.forceCollide=function(n){var e,r,a,c=1,l=1;function h(){for(var n,i,h,y,d,g,x,s=e.length,p=0;p<l;++p)for(i=t.quadtree(e,o,f).visitAfter(v),n=0;n<s;++n)h=e[n],g=r[h.index],x=g*g,y=h.x+h.vx,d=h.y+h.vy,i.visit(M);function M(n,t,e,r,i){var o=n.data,f=n.r,l=g+f;if(!o)return t>y+l||r<y-l||e>d+l||i<d-l;if(o.index>h.index){var v=y-o.x-o.vx,s=d-o.y-o.vy,p=v*v+s*s;p<l*l&&(0===v&&(p+=(v=u(a))*v),0===s&&(p+=(s=u(a))*s),p=(l-(p=Math.sqrt(p)))/p*c,h.vx+=(v*=p)*(l=(f*=f)/(x+f)),h.vy+=(s*=p)*l,o.vx-=v*(l=1-l),o.vy-=s*l)}}}function v(n){if(n.data)return n.r=r[n.data.index];for(var t=n.r=0;t<4;++t)n[t]&&n[t].r>n.r&&(n.r=n[t].r)}function y(){if(e){var t,i,u=e.length;for(r=new Array(u),t=0;t<u;++t)i=e[t],r[i.index]=+n(i,t,e)}}return"function"!=typeof n&&(n=i(null==n?1:+n)),h.initialize=function(n,t){e=n,a=t,y()},h.iterations=function(n){return arguments.length?(l=+n,h):l},h.strength=function(n){return arguments.length?(c=+n,h):c},h.radius=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),y(),h):n},h},n.forceLink=function(n){var t,e,r,o,f,l,h=a,v=function(n){return 1/Math.min(o[n.source.index],o[n.target.index])},y=i(30),d=1;function g(r){for(var i=0,o=n.length;i<d;++i)for(var a,c,h,v,y,g,x,s=0;s<o;++s)c=(a=n[s]).source,v=(h=a.target).x+h.vx-c.x-c.vx||u(l),y=h.y+h.vy-c.y-c.vy||u(l),v*=g=((g=Math.sqrt(v*v+y*y))-e[s])/g*r*t[s],y*=g,h.vx-=v*(x=f[s]),h.vy-=y*x,c.vx+=v*(x=1-x),c.vy+=y*x}function x(){if(r){var i,u,a=r.length,l=n.length,v=new Map(r.map(((n,t)=>[h(n,t,r),n])));for(i=0,o=new Array(a);i<l;++i)(u=n[i]).index=i,"object"!=typeof u.source&&(u.source=c(v,u.source)),"object"!=typeof u.target&&(u.target=c(v,u.target)),o[u.source.index]=(o[u.source.index]||0)+1,o[u.target.index]=(o[u.target.index]||0)+1;for(i=0,f=new Array(l);i<l;++i)u=n[i],f[i]=o[u.source.index]/(o[u.source.index]+o[u.target.index]);t=new Array(l),s(),e=new Array(l),p()}}function s(){if(r)for(var e=0,i=n.length;e<i;++e)t[e]=+v(n[e],e,n)}function p(){if(r)for(var t=0,i=n.length;t<i;++t)e[t]=+y(n[t],t,n)}return null==n&&(n=[]),g.initialize=function(n,t){r=n,l=t,x()},g.links=function(t){return arguments.length?(n=t,x(),g):n},g.id=function(n){return arguments.length?(h=n,g):h},g.iterations=function(n){return arguments.length?(d=+n,g):d},g.strength=function(n){return arguments.length?(v="function"==typeof n?n:i(+n),s(),g):v},g.distance=function(n){return arguments.length?(y="function"==typeof n?n:i(+n),p(),g):y},g},n.forceManyBody=function(){var n,e,r,o,f,a=i(-30),c=1,l=1/0,y=.81;function d(r){var i,u=n.length,f=t.quadtree(n,h,v).visitAfter(x);for(o=r,i=0;i<u;++i)e=n[i],f.visit(s)}function g(){if(n){var t,e,r=n.length;for(f=new Array(r),t=0;t<r;++t)e=n[t],f[e.index]=+a(e,t,n)}}function x(n){var t,e,r,i,u,o=0,a=0;if(n.length){for(r=i=u=0;u<4;++u)(t=n[u])&&(e=Math.abs(t.value))&&(o+=t.value,a+=e,r+=e*t.x,i+=e*t.y);n.x=r/a,n.y=i/a}else{(t=n).x=t.data.x,t.y=t.data.y;do{o+=f[t.data.index]}while(t=t.next)}n.value=o}function s(n,t,i,a){if(!n.value)return!0;var h=n.x-e.x,v=n.y-e.y,d=a-t,g=h*h+v*v;if(d*d/y<g)return g<l&&(0===h&&(g+=(h=u(r))*h),0===v&&(g+=(v=u(r))*v),g<c&&(g=Math.sqrt(c*g)),e.vx+=h*n.value*o/g,e.vy+=v*n.value*o/g),!0;if(!(n.length||g>=l)){(n.data!==e||n.next)&&(0===h&&(g+=(h=u(r))*h),0===v&&(g+=(v=u(r))*v),g<c&&(g=Math.sqrt(c*g)));do{n.data!==e&&(d=f[n.data.index]*o/g,e.vx+=h*d,e.vy+=v*d)}while(n=n.next)}}return d.initialize=function(t,e){n=t,r=e,g()},d.strength=function(n){return arguments.length?(a="function"==typeof n?n:i(+n),g(),d):a},d.distanceMin=function(n){return arguments.length?(c=n*n,d):Math.sqrt(c)},d.distanceMax=function(n){return arguments.length?(l=n*n,d):Math.sqrt(l)},d.theta=function(n){return arguments.length?(y=n*n,d):Math.sqrt(y)},d},n.forceRadial=function(n,t,e){var r,u,o,f=i(.1);function a(n){for(var i=0,f=r.length;i<f;++i){var a=r[i],c=a.x-t||1e-6,l=a.y-e||1e-6,h=Math.sqrt(c*c+l*l),v=(o[i]-h)*u[i]*n/h;a.vx+=c*v,a.vy+=l*v}}function c(){if(r){var t,e=r.length;for(u=new Array(e),o=new Array(e),t=0;t<e;++t)o[t]=+n(r[t],t,r),u[t]=isNaN(o[t])?0:+f(r[t],t,r)}}return"function"!=typeof n&&(n=i(+n)),null==t&&(t=0),null==e&&(e=0),a.initialize=function(n){r=n,c()},a.strength=function(n){return arguments.length?(f="function"==typeof n?n:i(+n),c(),a):f},a.radius=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),c(),a):n},a.x=function(n){return arguments.length?(t=+n,a):t},a.y=function(n){return arguments.length?(e=+n,a):e},a},n.forceSimulation=function(n){var t,i=1,u=.001,o=1-Math.pow(u,1/300),f=0,a=.6,c=new Map,h=r.timer(g),v=e.dispatch("tick","end"),d=function(){let n=1;return()=>(n=(1664525*n+1013904223)%l)/l}();function g(){x(),v.call("tick",t),i<u&&(h.stop(),v.call("end",t))}function x(e){var r,u,l=n.length;void 0===e&&(e=1);for(var h=0;h<e;++h)for(i+=(f-i)*o,c.forEach((function(n){n(i)})),r=0;r<l;++r)null==(u=n[r]).fx?u.x+=u.vx*=a:(u.x=u.fx,u.vx=0),null==u.fy?u.y+=u.vy*=a:(u.y=u.fy,u.vy=0);return t}function s(){for(var t,e=0,r=n.length;e<r;++e){if((t=n[e]).index=e,null!=t.fx&&(t.x=t.fx),null!=t.fy&&(t.y=t.fy),isNaN(t.x)||isNaN(t.y)){var i=10*Math.sqrt(.5+e),u=e*y;t.x=i*Math.cos(u),t.y=i*Math.sin(u)}(isNaN(t.vx)||isNaN(t.vy))&&(t.vx=t.vy=0)}}function p(t){return t.initialize&&t.initialize(n,d),t}return null==n&&(n=[]),s(),t={tick:x,restart:function(){return h.restart(g),t},stop:function(){return h.stop(),t},nodes:function(e){return arguments.length?(n=e,s(),c.forEach(p),t):n},alpha:function(n){return arguments.length?(i=+n,t):i},alphaMin:function(n){return arguments.length?(u=+n,t):u},alphaDecay:function(n){return arguments.length?(o=+n,t):+o},alphaTarget:function(n){return arguments.length?(f=+n,t):f},velocityDecay:function(n){return arguments.length?(a=1-n,t):1-a},randomSource:function(n){return arguments.length?(d=n,c.forEach(p),t):d},force:function(n,e){return arguments.length>1?(null==e?c.delete(n):c.set(n,p(e)),t):c.get(n)},find:function(t,e,r){var i,u,o,f,a,c=0,l=n.length;for(null==r?r=1/0:r*=r,c=0;c<l;++c)(o=(i=t-(f=n[c]).x)*i+(u=e-f.y)*u)<r&&(a=f,r=o);return a},on:function(n,e){return arguments.length>1?(v.on(n,e),t):v.on(n)}}},n.forceX=function(n){var t,e,r,u=i(.1);function o(n){for(var i,u=0,o=t.length;u<o;++u)(i=t[u]).vx+=(r[u]-i.x)*e[u]*n}function f(){if(t){var i,o=t.length;for(e=new Array(o),r=new Array(o),i=0;i<o;++i)e[i]=isNaN(r[i]=+n(t[i],i,t))?0:+u(t[i],i,t)}}return"function"!=typeof n&&(n=i(null==n?0:+n)),o.initialize=function(n){t=n,f()},o.strength=function(n){return arguments.length?(u="function"==typeof n?n:i(+n),f(),o):u},o.x=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),f(),o):n},o},n.forceY=function(n){var t,e,r,u=i(.1);function o(n){for(var i,u=0,o=t.length;u<o;++u)(i=t[u]).vy+=(r[u]-i.y)*e[u]*n}function f(){if(t){var i,o=t.length;for(e=new Array(o),r=new Array(o),i=0;i<o;++i)e[i]=isNaN(r[i]=+n(t[i],i,t))?0:+u(t[i],i,t)}}return"function"!=typeof n&&(n=i(null==n?0:+n)),o.initialize=function(n){t=n,f()},o.strength=function(n){return arguments.length?(u="function"==typeof n?n:i(+n),f(),o):u},o.y=function(t){return arguments.length?(n="function"==typeof t?t:i(+t),f(),o):n},o},Object.defineProperty(n,"__esModule",{value:!0})}));
`;
// --- END D3_FORCE_BUNDLE ---

/**
 * 构建完整 HTML 模板
 * 将 d3 bundle、图谱数据 JSON、CSS、交互 JS 组装为单文件字符串
 *
 * @param graphDataJson - buildGraphData() 返回的 JSON 字符串
 * @returns 完整 HTML 字符串（单文件，包含所有内联资源）
 */
export function buildHtmlTemplate(graphDataJson: string): string {
  // 对 </script> 标签转义，防止浏览器提前关闭脚本块
  const safeJson = graphDataJson.replace(/<\//g, '<\\/');
  // D3_FORCE_BUNDLE 的占位符将在运行时替换为实际 bundle
  return buildFullHtml(safeJson, D3_FORCE_BUNDLE);
}

/**
 * 组装完整 HTML 字符串（内部函数，便于测试）
 */
export function buildFullHtml(graphDataJson: string, d3Bundle: string): string {
  return `<!DOCTYPE html>
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
  <script>${d3Bundle}</script>
  <script>
(function() {
  'use strict';
  var GRAPH_DATA = ${graphDataJson};
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

  // 展示节点详情面板（FR-009: kind、度数、邻居列表、社区 ID）
  function showDetail(node) {
    document.getElementById('detail-placeholder').style.display = 'none';
    document.getElementById('node-detail').style.display = 'block';
    document.getElementById('node-detail-title').textContent = node.label || node.id;
    var rows = document.getElementById('node-detail-rows');
    rows.innerHTML = '';
    // 基础属性（使用 textContent 防止 XSS）
    [['ID', node.id], ['类型', node.kind || '—'], ['度数', String(node.degree != null ? node.degree : '—')],
     ['社区', node.communityId >= 0 ? '社区 ' + node.communityId : '未分类'],
     ['God Node', node.isGodNode ? '是' : '否']
    ].forEach(function(r) {
      var row = document.createElement('div');
      row.className = 'detail-row';
      var key = document.createElement('span');
      key.className = 'detail-key';
      key.textContent = r[0];
      var val = document.createElement('span');
      val.className = 'detail-value';
      val.textContent = r[1];
      row.appendChild(key);
      row.appendChild(val);
      rows.appendChild(row);
    });
    // 邻居节点列表（FR-009）
    var neighbors = [];
    GRAPH_DATA.links.forEach(function(link) {
      var src = typeof link.source === 'object' ? link.source.id : link.source;
      var tgt = typeof link.target === 'object' ? link.target.id : link.target;
      if (src === node.id && neighbors.indexOf(tgt) === -1) neighbors.push(tgt);
      else if (tgt === node.id && neighbors.indexOf(src) === -1) neighbors.push(src);
    });
    if (neighbors.length > 0) {
      var nRow = document.createElement('div');
      nRow.className = 'detail-row';
      nRow.style.flexDirection = 'column';
      var nKey = document.createElement('span');
      nKey.className = 'detail-key';
      nKey.textContent = '邻居 (' + neighbors.length + ')';
      nRow.appendChild(nKey);
      var nList = document.createElement('div');
      nList.style.cssText = 'max-height:120px;overflow-y:auto;margin-top:4px;';
      neighbors.slice(0, 50).forEach(function(nid) {
        var nNode = GRAPH_DATA.nodes.find(function(nn) { return nn.id === nid; });
        var nItem = document.createElement('div');
        nItem.style.cssText = 'font-size:11px;padding:2px 0;cursor:pointer;color:#58a6ff;';
        nItem.textContent = nNode ? (nNode.label || nNode.id) : nid;
        nItem.addEventListener('click', function() { if (nNode) showDetail(nNode); });
        nList.appendChild(nItem);
      });
      if (neighbors.length > 50) { var more = document.createElement('div'); more.style.cssText='font-size:11px;color:#8b949e;'; more.textContent = '...及其他 ' + (neighbors.length - 50) + ' 个'; nList.appendChild(more); }
      nRow.appendChild(nList);
      rows.appendChild(nRow);
    }
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
</html>`;
}
