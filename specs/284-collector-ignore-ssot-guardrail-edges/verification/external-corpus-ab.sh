#!/usr/bin/env bash
# F284 外部语料 A/B：用两份 dist 分别对语料副本跑 graph-only，归一化后比对。
# 用法：f284-ab.sh <distA> <distB> <out-dir>
set -euo pipefail
DA="$1"; DB="$2"; OUT="$3"; mkdir -p "$OUT"
CORPORA=(gorm HikariCP micrograd)
for c in "${CORPORA[@]}"; do
  src="$HOME/.spectra-baselines/$c"; [ -d "$src" ] || { echo "缺语料 $c"; continue; }
  for side in A B; do
    dist=$([ "$side" = A ] && echo "$DA" || echo "$DB")
    work="$OUT/$c-$side"; rm -rf "$work"; mkdir -p "$work"
    # 只拷源码树（含 .git 供 sourceCommit），排除既有 specs/_meta 产物
    rsync -a --exclude 'specs/_meta' "$src/" "$work/"
    ( cd "$work" && node "$dist/cli/index.js" batch --mode graph-only >/dev/null 2>"$OUT/$c-$side.log" ) || echo "[$c-$side] batch 非零退出"
    node -e '
      const fs=require("fs"); const g=JSON.parse(fs.readFileSync(process.argv[1]+"/specs/_meta/graph.json","utf8"));
      const meta={...g.graph}; delete meta.generatedAt; delete meta.builder; delete meta.sourceCommit; delete meta.fingerprint;
      const norm={graph:meta, nodes:[...g.nodes].sort((a,b)=>a.id<b.id?-1:1), links:[...g.links].map(l=>JSON.stringify(l,Object.keys(l).sort())).sort()};
      fs.writeFileSync(process.argv[2], JSON.stringify(norm));
      console.log(process.argv[3], "nodes="+g.nodes.length, "links="+g.links.length);
    ' "$work" "$OUT/$c-$side.norm.json" "$c-$side"
  done
  if cmp -s "$OUT/$c-A.norm.json" "$OUT/$c-B.norm.json"; then echo "== $c: A/B 归一化后逐字节相同"; else echo "!! $c: A/B 有差异"; fi
done
