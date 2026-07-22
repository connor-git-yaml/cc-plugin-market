import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildComponentView, renderComponentView } from '../../src/panoramic/builders/component-view-builder.js';
import type { ComponentDescriptor } from '../../src/panoramic/models/component-view-model.js';
import {
  cleanupComponentDynamicFixture,
  setupComponentDynamicFixture,
  type ComponentDynamicFixture,
} from './utils/component-dynamic-fixtures.js';

describe('component-view-builder', () => {
  let fixture: ComponentDynamicFixture;

  beforeEach(() => {
    fixture = setupComponentDynamicFixture();
  });

  afterEach(() => {
    cleanupComponentDynamicFixture(fixture);
  });

  it('基于 stored module specs、Architecture IR 与 event surface 提炼关键组件视图', () => {
    const output = buildComponentView({
      architectureIR: fixture.architectureIR,
      storedModules: fixture.storedModules,
      runtime: fixture.runtime,
      eventSurface: fixture.eventSurface,
    });
    const markdown = renderComponentView(output);

    const names = output.model.components.map((component) => component.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Query',
        'SubprocessCLITransport',
        'MessageParser',
        'SessionStore',
      ]),
    );
    expect(names).not.toContain('TestQuery');

    const query = findComponent(output.model.components, 'Query');
    const transport = findComponent(output.model.components, 'SubprocessCLITransport');
    const parser = findComponent(output.model.components, 'MessageParser');
    const session = findComponent(output.model.components, 'SessionStore');

    expect(query.keyMethods.map((method) => method.name)).toEqual(
      expect.arrayContaining(['connect', 'interrupt', 'query']),
    );
    expect(query.evidence.map((evidence) => evidence.sourceType)).toEqual(
      expect.arrayContaining(['module-spec', 'baseline-skeleton']),
    );

    expect(output.model.groups.map((group) => group.name)).toEqual(
      expect.arrayContaining(['src/client', 'src/parser', 'src/session', 'src/transport']),
    );

    expect(output.model.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromId: query.id,
          toId: transport.id,
          kind: 'uses-transport',
        }),
        expect.objectContaining({
          fromId: transport.id,
          toId: parser.id,
          kind: 'parses',
        }),
        expect.objectContaining({
          fromId: query.id,
          toId: session.id,
          kind: 'manages-session',
        }),
        expect.objectContaining({
          fromId: query.id,
          toId: session.id,
          kind: 'publishes',
        }),
      ]),
    );

    expect(output.mermaidDiagram).toContain('flowchart LR');
    expect(markdown).toContain('# 组件视图: component-fixture');
    expect(markdown).toContain('## 4. 关键组件');
    expect(markdown).toContain('SubprocessCLITransport');
  });
});

function findComponent(components: ComponentDescriptor[], name: string): ComponentDescriptor {
  const component = components.find((item) => item.name === name);
  expect(component).toBeDefined();
  return component!;
}

// F221：re-export 别名不参与组件评分（真身组件由目标模块自身贡献，
// 二者 sourceTarget 不同无法去重，评分提升会造出重复别名组件）。
describe('component-view-builder — re-export 别名过滤（F221）', () => {
  let fixture: ComponentDynamicFixture;

  beforeEach(() => {
    fixture = setupComponentDynamicFixture();
  });

  afterEach(() => {
    cleanupComponentDynamicFixture(fixture);
  });

  it('re-export 条目不被提升为组件；同名真身 class 则会（阳性对照）', () => {
    const target = fixture.storedModules.find((m) => m.baselineSkeleton);
    expect(target).toBeDefined();
    const aliasEntry = {
      name: 'FacadeAliasClient',
      kind: 're-export' as const,
      signature: "export { FacadeAliasClient } from './real.js'",
      isDefault: false,
      startLine: 1,
      endLine: 1,
      reExportFrom: './real.js',
    };
    target!.baselineSkeleton!.exports.push(aliasEntry);

    const withAlias = buildComponentView({
      architectureIR: fixture.architectureIR,
      storedModules: fixture.storedModules,
      runtime: fixture.runtime,
      eventSurface: fixture.eventSurface,
    });
    expect(withAlias.model.components.map((c) => c.name)).not.toContain('FacadeAliasClient');

    // 阳性对照：同名条目改为 class 真身后经 CLASSLIKE 捷径成为组件，
    // 证明上面的缺席来自 re-export 过滤而非评分不足
    target!.baselineSkeleton!.exports.pop();
    target!.baselineSkeleton!.exports.push({ ...aliasEntry, kind: 'class' as const, signature: 'class FacadeAliasClient {}' });
    const withClass = buildComponentView({
      architectureIR: fixture.architectureIR,
      storedModules: fixture.storedModules,
      runtime: fixture.runtime,
      eventSurface: fixture.eventSurface,
    });
    expect(withClass.model.components.map((c) => c.name)).toContain('FacadeAliasClient');
  });
});
