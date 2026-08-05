import { afterEach, describe, expect, it, vi } from 'vitest';
import { LevelEditorModel } from './LevelEditorModel';
import {
  loadLevelEditorPreferences,
  normalizeSimulationReasoningLevel,
  normalizeSimulationRunCount,
  saveLevelEditorPreferences,
} from './editorPreferences';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('level editor preferences', () => {
  it('restores and validates board and algorithm configuration', () => {
    const model = new LevelEditorModel();

    model.applyConfiguration({
      shape: 'rectangle',
      squareSize: 99,
      diamondSize: 1,
      hexSize: 99,
      rectangleColumns: 17,
      rectangleRows: 11.8,
      algorithm: {
        id: 'algorithm-5',
        parameters: {
          turnProbability: 73,
          earlyHiddenProbability: 61,
          maxHiddenRun: 99,
        },
      },
    });

    expect(model.configuration()).toMatchObject({
      shape: 'rectangle',
      squareSize: 20,
      diamondSize: 3,
      hexSize: 10,
      rectangleColumns: 17,
      rectangleRows: 11,
      algorithm: {
        id: 'algorithm-5',
        parameters: {
          turnProbability: 73,
          earlyHiddenProbability: 61,
          maxHiddenRun: 8,
        },
      },
    });
    expect(model.size()).toEqual({ columns: 17, rows: 11 });
  });

  it('round-trips preferences through the versioned local storage key', () => {
    const values = new Map<string, string>();
    const getItem = vi.fn((key: string) => values.get(key) ?? null);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('window', { localStorage: { getItem, setItem } });
    const model = new LevelEditorModel();
    model.setAlgorithm('algorithm-4');
    const preferences = {
      configuration: model.configuration(),
      simulationRunCount: 24,
      simulationReasoningLevel: 'high' as const,
      presets: [{
        id: 'preset-expert',
        name: '专家配置',
        configuration: model.configuration(),
      }],
      selectedPresetId: 'preset-expert',
    };

    saveLevelEditorPreferences(preferences);

    expect(setItem).toHaveBeenCalledWith(
      'number-connect.level-editor.preferences.v1',
      JSON.stringify(preferences),
    );
    expect(loadLevelEditorPreferences()).toEqual(preferences);
  });

  it('restores rectangle dimensions below the shared editor minimum', () => {
    const model = new LevelEditorModel();

    model.applyConfiguration({
      ...model.configuration(),
      shape: 'rectangle',
      rectangleColumns: 0,
      rectangleRows: 2,
    });

    expect(model.size()).toEqual({ columns: 1, rows: 2 });
  });

  it('normalizes persisted presets and drops malformed or duplicate entries', () => {
    const stored = {
      presets: [
        {
          id: 'preset-fast',
          name: '快速生成',
          configuration: {
            shape: 'rectangle',
            rectangleColumns: 999,
            rectangleRows: 9,
            algorithm: {
              id: 'algorithm-5',
              parameters: { turnProbability: 999 },
            },
          },
        },
        {
          id: 'preset-duplicate-name',
          name: '快速生成',
          configuration: {},
        },
        { id: 'preset-invalid', name: '', configuration: {} },
      ],
      selectedPresetId: 'preset-fast',
    };
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => JSON.stringify(stored)) },
    });

    expect(loadLevelEditorPreferences()).toMatchObject({
      selectedPresetId: 'preset-fast',
      presets: [{
        id: 'preset-fast',
        name: '快速生成',
        configuration: {
          shape: 'rectangle',
          rectangleColumns: 20,
          rectangleRows: 9,
          algorithm: {
            id: 'algorithm-5',
            parameters: { turnProbability: 100 },
          },
        },
      }],
    });
  });

  it('falls back safely for corrupt storage and invalid simulation values', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => '{not-json'),
      },
    });

    expect(loadLevelEditorPreferences()).toEqual({ presets: [] });
    expect(normalizeSimulationRunCount(500)).toBe(100);
    expect(normalizeSimulationRunCount('bad')).toBe(1);
    expect(normalizeSimulationReasoningLevel('expert')).toBe('medium');
  });
});
