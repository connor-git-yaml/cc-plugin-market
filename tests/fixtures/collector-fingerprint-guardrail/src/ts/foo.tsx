// #1 tsjsSkeletonWalk 样本（.tsx）。不含 JSX 元素：本 fixture 只需覆盖"扩展名被采集"，
// 引入 JSX 会额外依赖 jsx 编译配置，与护栏目的无关且会削弱跨环境确定性。
export function widget(): string {
  return 'widget';
}
