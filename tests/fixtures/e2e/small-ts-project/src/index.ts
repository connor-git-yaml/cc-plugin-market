/**
 * E2E 测试用 fixture — 入口模块
 * import utils.ts，确保 AST 解析能识别跨文件依赖关系
 */

import { distance, normalize, type Point } from './utils.js';

export { distance, normalize, type Point };

/**
 * 计算一组点的质心
 */
export function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  return { x: sumX / points.length, y: sumY / points.length };
}

/**
 * 对数值数组求和
 */
export function sum(values: number[]): number {
  return normalize(values).reduce((acc, v) => acc + v, 0);
}
