// fixture: 循环依赖端点 B（A → B → A）
import { valueA } from './circular-a';

export const useB = (): string => `B->${valueA}`;
