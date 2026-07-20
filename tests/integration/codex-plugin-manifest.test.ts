import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { loadReleaseContract } from '../../scripts/lib/release-contract-core.mjs';

// Feature 213（T019）— 对真实两份 .codex-plugin/plugin.json 做结构性断言（FR-010(a) 必选层）
// + FR-006 hooks ship 断言（两份 hooks/hooks.json 存在且引用脚本随包实存）。

const REPO_ROOT = resolve('.');
const { contract: RELEASE_CONTRACT } = loadReleaseContract(REPO_ROOT);

interface CodexManifest {
  name: string;
  skills: string;
  mcpServers?: string;
  version: string;
  description: string;
  hooks?: unknown;
}

const CASES = [
  {
    id: 'spectra',
    pluginDir: join(REPO_ROOT, 'plugins/spectra'),
    manifestPath: join(REPO_ROOT, 'plugins/spectra/.codex-plugin/plugin.json'),
    expectedSkills: './skills/',
    expectMcpServers: true,
  },
  {
    id: 'spec-driver',
    pluginDir: join(REPO_ROOT, 'plugins/spec-driver'),
    manifestPath: join(REPO_ROOT, 'plugins/spec-driver/.codex-plugin/plugin.json'),
    expectedSkills: './skills-codex/',
    expectMcpServers: false,
  },
];

describe('codex plugin manifest 结构性验证', () => {
  for (const c of CASES) {
    describe(c.id, () => {
      const manifest = JSON.parse(readFileSync(c.manifestPath, 'utf-8')) as CodexManifest;
      const product = RELEASE_CONTRACT.products[c.id];

      it('JSON 合法且 name 正确', () => {
        expect(manifest.name).toBe(c.id);
      });

      it('无 hooks 字段（FR-006）', () => {
        expect('hooks' in manifest).toBe(false);
      });

      it('skills 字段值正确且引用目录实存', () => {
        expect(manifest.skills).toBe(c.expectedSkills);
        const skillsDir = join(c.pluginDir, manifest.skills.replace(/^\.\/+/, '').replace(/\/$/, ''));
        expect(existsSync(skillsDir), `${c.id} skills 目录不存在: ${skillsDir}`).toBe(true);
      });

      if (c.expectMcpServers) {
        it('mcpServers 字段值正确且引用文件实存（FR-003）', () => {
          expect(manifest.mcpServers).toBe('./.mcp.json');
          const mcpPath = join(c.pluginDir, '.mcp.json');
          expect(existsSync(mcpPath)).toBe(true);
          const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8')) as { mcpServers: Record<string, unknown> };
          expect('spectra' in mcp.mcpServers).toBe(true);
        });
      } else {
        it('无 mcpServers 字段（spec-driver 不含 MCP）', () => {
          expect('mcpServers' in manifest).toBe(false);
        });
      }

      // T011 已 sync：受控字段与 release contract 精确相等
      it('version === contract.product.version（受控字段闭环）', () => {
        expect(manifest.version).toBe(product.version);
      });

      it('description === contract.product.pluginDescription（受控字段闭环）', () => {
        expect(manifest.description).toBe(product.pluginDescription);
      });
    });
  }

  // ---- FR-006 hooks ship 断言（CRITICAL #6(b)）----
  describe('hooks ship（FR-006）', () => {
    // 从 hooks.json command 字符串提取脚本相对路径：剥离可选 `bash ` 前缀，
    // 将 ${CLAUDE_PLUGIN_ROOT} 替换为 pluginDir，校验脚本实存。
    function collectHookScripts(hooksJson: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>): string[] {
      const commands: string[] = [];
      for (const matchers of Object.values(hooksJson)) {
        for (const matcher of matchers) {
          for (const hook of matcher.hooks) {
            if (hook.type === 'command' && typeof hook.command === 'string') {
              commands.push(hook.command);
            }
          }
        }
      }
      return commands;
    }

    for (const c of CASES) {
      it(`${c.id} hooks/hooks.json 存在、合法，且引用脚本随包实存`, () => {
        const hooksPath = join(c.pluginDir, 'hooks', 'hooks.json');
        expect(existsSync(hooksPath), `${c.id} 缺 hooks/hooks.json`).toBe(true);
        const parsed = JSON.parse(readFileSync(hooksPath, 'utf-8')) as { hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> };
        expect(parsed.hooks).toBeDefined();

        const commands = collectHookScripts(parsed.hooks);
        expect(commands.length).toBeGreaterThan(0);
        for (const command of commands) {
          const withoutBash = command.replace(/^bash\s+/, '').trim();
          const scriptRel = withoutBash.replace('${CLAUDE_PLUGIN_ROOT}/', '');
          const scriptPath = join(c.pluginDir, scriptRel);
          expect(existsSync(scriptPath), `${c.id} hook 引用脚本不存在: ${scriptRel}`).toBe(true);
        }
      });
    }
  });
});
