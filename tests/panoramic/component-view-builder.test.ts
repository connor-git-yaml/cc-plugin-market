import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildComponentView, renderComponentView } from '../../src/panoramic/component-view-builder.js';
import type { ComponentDescriptor } from '../../src/panoramic/component-view-model.js';
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
