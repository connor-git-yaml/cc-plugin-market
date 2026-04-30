import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface JudgeModule {
  parseArgs: (argv: string[]) => Record<string, unknown>;
  anonymizeFixture: (fixture: Record<string, unknown>) => {
    anonymized: Record<string, unknown>;
    reverseMap: Map<string, string>;
  };
  reverseAnonymize: (text: string, reverseMap: Map<string, string>) => string;
  parseJudgeOutput: (rawOutput: string) => { score: number | null; rationale: string | null };
}

async function loadJudge(): Promise<JudgeModule> {
  const url = pathToFileURL(resolve('scripts/eval-judge.mjs')).href;
  return (await import(url)) as JudgeModule;
}

describe('eval-judge', () => {
  describe('parseArgs', () => {
    it('rejects unknown rubric', async () => {
      const { parseArgs } = await loadJudge();
      expect(() => parseArgs(['--rubric', 'bogus'])).toThrow(/--rubric must be/);
    });

    it('accepts valid rubrics', async () => {
      const { parseArgs } = await loadJudge();
      const r = parseArgs(['--fixture', 'x.json', '--rubric', 'task-execution', '--inter-rater', '2']);
      expect(r.rubric).toBe('task-execution');
      expect(r.interRater).toBe(2);
    });
  });

  describe('anonymizeFixture (Codex C4 双盲)', () => {
    it('replaces tool name in meta + paths', async () => {
      const { anonymizeFixture } = await loadJudge();
      const fixture = {
        meta: {
          tool: 'spec-driver',
          outputDir: '/home/user/.spectra-baselines/proj-output/spec-driver-full',
          stdoutLogPath: '/home/user/spec-driver/stdout.log',
          command: 'spec-driver-cli',
        },
      };
      const { anonymized, reverseMap } = anonymizeFixture(fixture);
      expect((anonymized.meta as { tool: string }).tool).toMatch(/^<TOOL_/);
      expect((anonymized.meta as { outputDir: string }).outputDir).not.toContain('spec-driver');
      expect(reverseMap.size).toBeGreaterThan(0);
    });

    it('reverseAnonymize restores original text', async () => {
      const { anonymizeFixture, reverseAnonymize } = await loadJudge();
      const fixture = { meta: { tool: 'graphify' } };
      const { reverseMap } = anonymizeFixture(fixture);
      const anonName = [...reverseMap.keys()][0];
      const text = `工具 ${anonName} 在该项目上表现良好。`;
      const restored = reverseAnonymize(text, reverseMap);
      expect(restored).toBe('工具 graphify 在该项目上表现良好。');
    });

    it('does not leak unrelated string with same prefix', async () => {
      const { anonymizeFixture } = await loadJudge();
      const fixture = {
        meta: { tool: 'spectra' },
        unrelated: 'This is not a tool name; spectroscopy is irrelevant.',
      };
      const { anonymized } = anonymizeFixture(fixture);
      // 顶层 unrelated 字段应原样（不在 anonymize 范围内）
      expect((anonymized as { unrelated: string }).unrelated).toContain('spectroscopy');
    });
  });

  describe('parseJudgeOutput', () => {
    it('extracts score + rationale from standard format', async () => {
      const { parseJudgeOutput } = await loadJudge();
      const output = `SCORE: 8\nRATIONALE: Spec 结构完整，4 章节齐全。`;
      const r = parseJudgeOutput(output);
      expect(r.score).toBe(8);
      expect(r.rationale).toBe('Spec 结构完整，4 章节齐全。');
    });

    it('handles decimal scores', async () => {
      const { parseJudgeOutput } = await loadJudge();
      const output = `SCORE: 7.5\nRATIONALE: 中等质量。`;
      const r = parseJudgeOutput(output);
      expect(r.score).toBe(7.5);
    });

    it('returns nulls when format malformed', async () => {
      const { parseJudgeOutput } = await loadJudge();
      const output = `Some random text without score format.`;
      const r = parseJudgeOutput(output);
      expect(r.score).toBeNull();
      expect(r.rationale).toBeNull();
    });

    it('extracts only first SCORE line + rationale', async () => {
      const { parseJudgeOutput } = await loadJudge();
      const output = `SCORE: 6\nRATIONALE: 第一段。\n\nSCORE: 9\nRATIONALE: 第二段（应忽略）`;
      const r = parseJudgeOutput(output);
      expect(r.score).toBe(6);
      expect(r.rationale).toBe('第一段。');
    });
  });
});
