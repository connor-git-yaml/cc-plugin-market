# #2 pyWalk 独占覆盖样本（F259）：与 consumer.py 构成真实 py→py import + call，
# #11 pythonSymbolScan（extractSymbolNodes）只产出 module/component 节点与 contains 边，
# 结构上不读取 imports/callSites，产不出这条边——本样本用于让护栏对 #2 具备独占可见性。
def make() -> int:
    return 42
