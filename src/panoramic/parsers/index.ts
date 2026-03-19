/**
 * 非代码制品解析器模块 — 统一导出
 *
 * 导出内容：
 * - 全部输出类型和 Zod Schema（types.ts）
 * - AbstractArtifactParser 抽象基类
 * - SkillMdParser / BehaviorYamlParser / DockerfileParser 具体实现
 */

// 类型和 Schema
export type {
  SkillMdSection,
  SkillMdInfo,
  BehaviorState,
  BehaviorInfo,
  DockerfileInstruction,
  DockerfileStage,
  DockerfileInfo,
} from './types.js';

export {
  SkillMdSectionSchema,
  SkillMdInfoSchema,
  BehaviorStateSchema,
  BehaviorInfoSchema,
  DockerfileInstructionSchema,
  DockerfileStageSchema,
  DockerfileInfoSchema,
} from './types.js';

// 抽象基类
export { AbstractArtifactParser } from './abstract-artifact-parser.js';

// 具体 Parser 实现
export { SkillMdParser } from './skill-md-parser.js';
export { BehaviorYamlParser } from './behavior-yaml-parser.js';
export { DockerfileParser } from './dockerfile-parser.js';
