# Graph Report - /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2  (2026-04-30)

## Corpus Check
- 5 files · ~4,125 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 41 nodes · 56 edges · 9 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `Value` - 23 edges
2. `Layer` - 9 edges
3. `Neuron` - 8 edges
4. `Module` - 7 edges
5. `MLP` - 7 edges
6. `test_sanity_check()` - 4 edges
7. `test_more_ops()` - 4 edges
8. `stores a single scalar value and its gradient` - 1 edges

## Surprising Connections (you probably didn't know these)
- `test_sanity_check()` --calls--> `Value`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/test/test_engine.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/engine.py
- `test_more_ops()` --calls--> `Value`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/test/test_engine.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/engine.py
- `Module` --uses--> `Value`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/nn.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/engine.py
- `Neuron` --uses--> `Value`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/nn.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/engine.py
- `Layer` --uses--> `Value`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/nn.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-ORrgK2/micrograd/engine.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (2): stores a single scalar value and its gradient, Value

### Community 1 - "Community 1"
Cohesion: 0.47
Nodes (2): test_more_ops(), test_sanity_check()

### Community 2 - "Community 2"
Cohesion: 0.4
Nodes (1): Neuron

### Community 3 - "Community 3"
Cohesion: 0.5
Nodes (1): MLP

### Community 4 - "Community 4"
Cohesion: 0.67
Nodes (1): Module

### Community 5 - "Community 5"
Cohesion: 0.67
Nodes (1): Layer

### Community 6 - "Community 6"
Cohesion: 0.67
Nodes (0): 

### Community 7 - "Community 7"
Cohesion: 1.0
Nodes (0): 

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **1 isolated node(s):** `stores a single scalar value and its gradient`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 7`** (1 nodes): `setup.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Value` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.692) - this node is a cross-community bridge._
- **Why does `Layer` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.198) - this node is a cross-community bridge._
- **Why does `Neuron` connect `Community 2` to `Community 0`, `Community 1`, `Community 4`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `Value` (e.g. with `Module` and `Neuron`) actually correct?**
  _`Value` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `stores a single scalar value and its gradient` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._