// fixture: 仅类型导入（FR-28 / AC-11，importType='type-only'）
import type { Bar } from './bar';

export const makeBar = (name: string): Bar => ({ name });
