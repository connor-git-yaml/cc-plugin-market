/**
 * llm-client 单元测试
 * 验证 parseLLMResponse、buildSystemPrompt（不调用真实 API）
 */
import { describe, it, expect } from 'vitest';
import {
  parseLLMResponse,
  buildSystemPrompt,
} from '../../src/core/llm-client.js';

describe('llm-client', () => {
  describe('parseLLMResponse', () => {
    it('应解析完整的 9 章节响应', () => {
      const raw = `## 1. 意图
此模块用于处理用户认证

## 2. 接口定义
导出 login() 和 logout() 函数

## 3. 业务逻辑
验证用户凭证并生成 JWT token

## 4. 数据结构
User 类型包含 id、name、email 字段

## 5. 约束条件
JWT 过期时间默认 24 小时

## 6. 边界条件
密码为空时抛出 ValidationError

## 7. 技术债务
缺少密码强度验证

## 8. 测试覆盖
覆盖了登录成功和失败场景

## 9. 依赖关系
依赖 jsonwebtoken 和 bcrypt`;

      const result = parseLLMResponse(raw);

      expect(result.sections.intent).toContain('用户认证');
      expect(result.sections.interfaceDefinition).toContain('login');
      expect(result.sections.businessLogic).toContain('JWT');
      expect(result.sections.dataStructures).toContain('User');
      expect(result.sections.constraints).toContain('24 小时');
      expect(result.sections.edgeCases).toContain('ValidationError');
      expect(result.sections.technicalDebt).toContain('密码强度');
      expect(result.sections.testCoverage).toContain('登录');
      expect(result.sections.dependencies).toContain('jsonwebtoken');
      expect(result.parseWarnings).toHaveLength(0);
    });

    it('缺失章节应填充占位符', () => {
      const raw = `## 1. 意图
此模块用于测试

## 2. 接口定义
无导出`;

      const result = parseLLMResponse(raw);

      // 应有 7 个缺失章节的警告
      expect(result.parseWarnings.length).toBeGreaterThan(0);
      expect(result.sections.businessLogic).toBe('[LLM 未生成此段落]');
    });

    it('应提取不确定性标记', () => {
      const raw = `## 1. 意图
此模块 [推断: 基于函数命名] 用于数据转换

## 2. 接口定义
接口定义

## 3. 业务逻辑
[不明确: 缺少类型信息] 可能进行了类型转换

## 4. 数据结构
数据结构

## 5. 约束条件
约束

## 6. 边界条件
[SYNTAX ERROR: 解析失败] 部分代码

## 7. 技术债务
债务

## 8. 测试覆盖
覆盖

## 9. 依赖关系
依赖`;

      const result = parseLLMResponse(raw);

      expect(result.uncertaintyMarkers).toHaveLength(3);

      const types = result.uncertaintyMarkers.map((m) => m.type);
      expect(types).toContain('推断');
      expect(types).toContain('不明确');
      expect(types).toContain('SYNTAX ERROR');

      const inferMarker = result.uncertaintyMarkers.find((m) => m.type === '推断');
      expect(inferMarker?.rationale).toContain('基于函数命名');
    });

    it('空响应应返回全部占位符', () => {
      const result = parseLLMResponse('');

      // 所有 9 个章节都应该有占位符
      expect(result.parseWarnings.length).toBe(9);
      expect(result.sections.intent).toBe('[LLM 未生成此段落]');
    });

    it('应处理非标准标题格式', () => {
      const raw = `# 意图
模块目的

### 2. 接口定义
导出信息`;

      const result = parseLLMResponse(raw);

      expect(result.sections.intent).toContain('模块目的');
      expect(result.sections.interfaceDefinition).toContain('导出信息');
    });
  });

  describe('buildSystemPrompt', () => {
    it('spec-generation 模式应包含关键指令', () => {
      const prompt = buildSystemPrompt('spec-generation');

      expect(prompt).toContain('9 个章节');
      expect(prompt).toContain('绝不捏造');
      expect(prompt).toContain('[推断');
      expect(prompt).toContain('中文');
    });

    it('semantic-diff 模式应包含变更分析指令', () => {
      const prompt = buildSystemPrompt('semantic-diff');

      expect(prompt).toContain('行为');
      expect(prompt).toContain('漂移');
      expect(prompt).toContain('HIGH');
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('LOW');
    });

    it('两种模式应返回不同内容', () => {
      const specPrompt = buildSystemPrompt('spec-generation');
      const diffPrompt = buildSystemPrompt('semantic-diff');

      expect(specPrompt).not.toBe(diffPrompt);
    });
  });
});
