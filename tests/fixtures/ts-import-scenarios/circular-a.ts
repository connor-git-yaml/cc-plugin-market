// fixture: 循环依赖端点 A（A → B → A）
import { useB } from './circular-b';

export const useA = (): string => `A->${useB()}`;
export const valueA = 'A';
