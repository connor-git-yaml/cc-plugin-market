# Graph Report - /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR  (2026-04-30)

## Corpus Check
- 15 files · ~16,924 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 55 nodes · 61 edges · 17 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.5)
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
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]

## God Nodes (most connected - your core abstractions)
1. `GPT` - 12 edges
2. `LayerNorm` - 6 edges
3. `MLP` - 5 edges
4. `Block` - 5 edges
5. `GPTConfig` - 5 edges
6. `CausalSelfAttention` - 4 edges
7. `A much shorter version of train.py for benchmarking` - 3 edges
8. `from_pretrained()` - 3 edges
9. `This training script can be run both on a single gpu in debug mode, and also in` - 3 edges
10. `Sample from a trained model` - 3 edges

## Surprising Connections (you probably didn't know these)
- `A much shorter version of train.py for benchmarking` --uses--> `GPT`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/bench.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/model.py
- `This training script can be run both on a single gpu in debug mode, and also in` --uses--> `GPTConfig`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/train.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/model.py
- `Sample from a trained model` --uses--> `GPTConfig`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/sample.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/model.py
- `This training script can be run both on a single gpu in debug mode, and also in` --uses--> `GPT`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/train.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/model.py
- `A much shorter version of train.py for benchmarking` --uses--> `GPTConfig`  [INFERRED]
  /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/bench.py → /private/var/folders/38/ryfq5rt572vgkm2vpq61jtwc0000gn/T/graphify-eval-GY5fCR/model.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.24
Nodes (4): Block, LayerNorm, MLP, LayerNorm but with an optional bias. PyTorch doesn't support simply bias=False

### Community 1 - "Community 1"
Cohesion: 0.22
Nodes (4): GPT, Return the number of parameters in the model.         For non-embedding count (d, estimate model flops utilization (MFU) in units of A100 bfloat16 peak FLOPS, Sample from a trained model

### Community 2 - "Community 2"
Cohesion: 0.29
Nodes (4): A much shorter version of train.py for benchmarking, from_pretrained(), GPTConfig, Full definition of a GPT Language Model, all of it in this single file. Referenc

### Community 3 - "Community 3"
Cohesion: 0.5
Nodes (3): estimate_loss(), get_batch(), This training script can be run both on a single gpu in debug mode, and also in

### Community 4 - "Community 4"
Cohesion: 0.5
Nodes (1): Prepare the Shakespeare dataset for character-level language modeling. So instea

### Community 5 - "Community 5"
Cohesion: 0.67
Nodes (1): CausalSelfAttention

### Community 6 - "Community 6"
Cohesion: 1.0
Nodes (1): Poor Man's Configurator. Probably a terrible idea. Example usage: $ python train

### Community 7 - "Community 7"
Cohesion: 1.0
Nodes (0): 

### Community 8 - "Community 8"
Cohesion: 1.0
Nodes (1): Take a conditioning sequence of indices idx (LongTensor of shape (b,t)) and comp

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 1.0
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **7 isolated node(s):** `Full definition of a GPT Language Model, all of it in this single file. Referenc`, `LayerNorm but with an optional bias. PyTorch doesn't support simply bias=False`, `Return the number of parameters in the model.         For non-embedding count (d`, `estimate model flops utilization (MFU) in units of A100 bfloat16 peak FLOPS`, `Take a conditioning sequence of indices idx (LongTensor of shape (b,t)) and comp` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 6`** (2 nodes): `Poor Man's Configurator. Probably a terrible idea. Example usage: $ python train`, `configurator.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 7`** (2 nodes): `process()`, `prepare.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (1 nodes): `Take a conditioning sequence of indices idx (LongTensor of shape (b,t)) and comp`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (1 nodes): `train_gpt2.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (1 nodes): `eval_gpt2_xl.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (1 nodes): `eval_gpt2_large.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (1 nodes): `finetune_shakespeare.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (1 nodes): `eval_gpt2_medium.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (1 nodes): `train_shakespeare_char.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (1 nodes): `eval_gpt2.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (1 nodes): `prepare.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GPT` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.247) - this node is a cross-community bridge._
- **Why does `This training script can be run both on a single gpu in debug mode, and also in` connect `Community 3` to `Community 1`, `Community 2`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `LayerNorm` connect `Community 0` to `Community 2`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `GPT` (e.g. with `A much shorter version of train.py for benchmarking` and `This training script can be run both on a single gpu in debug mode, and also in`) actually correct?**
  _`GPT` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `GPTConfig` (e.g. with `A much shorter version of train.py for benchmarking` and `This training script can be run both on a single gpu in debug mode, and also in`) actually correct?**
  _`GPTConfig` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Full definition of a GPT Language Model, all of it in this single file. Referenc`, `LayerNorm but with an optional bias. PyTorch doesn't support simply bias=False`, `Return the number of parameters in the model.         For non-embedding count (d` to the rest of the system?**
  _7 weakly-connected nodes found - possible documentation gaps or missing edges._