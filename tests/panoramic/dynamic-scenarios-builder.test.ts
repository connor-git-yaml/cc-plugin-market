import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildComponentView } from '../../src/panoramic/component-view-builder.js';
import { buildDynamicScenarios, renderDynamicScenarios } from '../../src/panoramic/dynamic-scenarios-builder.js';
import type { DynamicScenario } from '../../src/panoramic/component-view-model.js';
import {
  cleanupComponentDynamicFixture,
  setupComponentDynamicFixture,
  type ComponentDynamicFixture,
} from './utils/component-dynamic-fixtures.js';

describe('dynamic-scenarios-builder', () => {
  let fixture: ComponentDynamicFixture;

  beforeEach(() => {
    fixture = setupComponentDynamicFixture();
  });

  afterEach(() => {
    cleanupComponentDynamicFixture(fixture);
  });

  it('组合 component view、runtime 与 event surface 生成主链路 / 事件 / 会话场景', () => {
    const componentView = buildComponentView({
      architectureIR: fixture.architectureIR,
      storedModules: fixture.storedModules,
      runtime: fixture.runtime,
      eventSurface: fixture.eventSurface,
    });

    const output = buildDynamicScenarios({
      componentView: componentView.model,
      storedModules: fixture.storedModules,
      runtime: fixture.runtime,
      eventSurface: fixture.eventSurface,
    });
    const markdown = renderDynamicScenarios(output);

    const scenarioIds = output.model.scenarios.map((scenario) => scenario.id);
    expect(scenarioIds).toEqual(
      expect.arrayContaining(['primary-flow', 'event-query.completed', 'session-flow']),
    );

    const primary = findScenario(output.model.scenarios, 'primary-flow');
    expect(primary.title).toBe('query 主链路');
    expect(primary.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor: 'Query', action: '接收 query' }),
        expect.objectContaining({ actor: 'Query', target: 'SubprocessCLITransport', action: '委托 transport' }),
        expect.objectContaining({ target: 'MessageParser', action: '交给解析层' }),
        expect.objectContaining({ target: 'SessionStore', action: '更新会话状态' }),
        expect.objectContaining({ target: 'gateway', action: '运行于目标宿主' }),
      ]),
    );

    const eventScenario = findScenario(output.model.scenarios, 'event-query.completed');
    expect(eventScenario.participants).toEqual(['Query', 'SessionStore']);
    expect(eventScenario.summary).toContain('query.completed');

    const sessionScenario = findScenario(output.model.scenarios, 'session-flow');
    expect(sessionScenario.trigger).toBe('loadSession');
    expect(sessionScenario.outcome).toContain('SessionStore');

    expect(markdown).toContain('# 动态链路: component-fixture');
    expect(markdown).toContain('### query 主链路');
    expect(markdown).toContain('#### Steps');
  });
});

function findScenario(scenarios: DynamicScenario[], id: string): DynamicScenario {
  const scenario = scenarios.find((item) => item.id === id);
  expect(scenario).toBeDefined();
  return scenario!;
}
