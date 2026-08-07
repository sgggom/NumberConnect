import type { SimulationReasoningLevel } from './simulateLevelPlay';
import { LevelEditorModel, type LevelEditorConfiguration } from './LevelEditorModel';

const LEVEL_EDITOR_PREFERENCES_KEY = 'number-connect.level-editor.preferences.v1';

export type LevelEditorPreferencesSaveResult = 'persistent' | 'session' | 'unavailable';

export interface LevelEditorPreferences {
  configuration: LevelEditorConfiguration;
  simulationRunCount: number;
  simulationReasoningLevel: SimulationReasoningLevel;
  presets: LevelEditorPreset[];
  selectedPresetId?: string;
}

export interface StoredLevelEditorPreferences {
  configuration?: unknown;
  simulationRunCount?: unknown;
  simulationReasoningLevel?: unknown;
  presets: LevelEditorPreset[];
  selectedPresetId?: string;
}

export interface LevelEditorPreset {
  id: string;
  name: string;
  configuration: LevelEditorConfiguration;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const normalizedPresetName = (value: unknown): string => (
  typeof value === 'string' ? value.trim().slice(0, 30) : ''
);

export const normalizeLevelEditorPresets = (value: unknown): LevelEditorPreset[] => {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return value.slice(0, 100).flatMap((candidate): LevelEditorPreset[] => {
    if (!isRecord(candidate) || !isRecord(candidate.configuration)) return [];
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 120) : '';
    const name = normalizedPresetName(candidate.name);
    const normalizedName = name.toLocaleLowerCase();
    if (!id || !name || seenIds.has(id) || seenNames.has(normalizedName)) return [];
    seenIds.add(id);
    seenNames.add(normalizedName);
    const model = new LevelEditorModel();
    model.applyConfiguration(candidate.configuration);
    return [{ id, name, configuration: model.configuration() }];
  });
};

export const normalizeSimulationRunCount = (value: unknown): number => (
  Number.isFinite(Number(value))
    ? Math.max(1, Math.min(100, Math.round(Number(value))))
    : 1
);

export const normalizeSimulationReasoningLevel = (
  value: unknown,
): SimulationReasoningLevel => (
  value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
);

const parseLevelEditorPreferences = (value: string | null): StoredLevelEditorPreferences | undefined => {
  if (value === null) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    const presets = normalizeLevelEditorPresets(parsed.presets);
    const selectedPresetId = typeof parsed.selectedPresetId === 'string'
      && presets.some(({ id }) => id === parsed.selectedPresetId)
      ? parsed.selectedPresetId
      : undefined;
    return {
      configuration: parsed.configuration,
      simulationRunCount: parsed.simulationRunCount,
      simulationReasoningLevel: parsed.simulationReasoningLevel,
      presets,
      selectedPresetId,
    };
  } catch {
    return undefined;
  }
};

const browserStorage = (name: 'localStorage' | 'sessionStorage'): Storage | undefined => {
  if (typeof window === 'undefined' || !(name in window)) return undefined;
  try {
    return window[name];
  } catch {
    return undefined;
  }
};

const loadPreferencesFromStorage = (storage: Storage | undefined): StoredLevelEditorPreferences | undefined => {
  if (!storage) return undefined;
  try {
    return parseLevelEditorPreferences(storage.getItem(LEVEL_EDITOR_PREFERENCES_KEY));
  } catch {
    return undefined;
  }
};

export const loadLevelEditorPreferences = (): StoredLevelEditorPreferences => (
  // The session copy is written together with the durable copy. Prefer it in the
  // current tab so a rejected or stale localStorage write cannot erase presets on reload.
  loadPreferencesFromStorage(browserStorage('sessionStorage'))
  ?? loadPreferencesFromStorage(browserStorage('localStorage'))
  ?? { presets: [] }
);

const savePreferencesToStorage = (storage: Storage | undefined, value: string): boolean => {
  if (!storage) return false;
  try {
    storage.setItem(LEVEL_EDITOR_PREFERENCES_KEY, value);
    return storage.getItem(LEVEL_EDITOR_PREFERENCES_KEY) === value;
  } catch {
    return false;
  }
};

export const saveLevelEditorPreferences = (
  preferences: LevelEditorPreferences,
): LevelEditorPreferencesSaveResult => {
  let value: string;
  try {
    value = JSON.stringify(preferences);
  } catch {
    return 'unavailable';
  }

  const sessionSaved = savePreferencesToStorage(browserStorage('sessionStorage'), value);
  const persistentSaved = savePreferencesToStorage(browserStorage('localStorage'), value);
  if (persistentSaved) return 'persistent';
  return sessionSaved ? 'session' : 'unavailable';
};
