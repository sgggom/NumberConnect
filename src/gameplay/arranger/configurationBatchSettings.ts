import { DEFAULT_PLAYER_CONFIG, DEFAULT_WEIGHT_CONFIG, type PlayerConfig, type WeightConfig } from './occlusionSimulation';
import { readPlaytestPreference } from './playtestPreferences';
import type { LevelData } from '../../game/types';
import type { OcclusionGeometry } from './handOcclusion';
export type ConfigurationBatchSettings = ReturnType<typeof readConfigurationBatchSettings> & { workerCount?: number };

export function readConfigurationBatchSettings() {
  const number = (key: string, fallback: number, min: number, max = Infinity) => {
    const raw = readPlaytestPreference(key), value = Number(raw);
    return raw !== undefined && raw.trim() !== '' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  const reasoning = readPlaytestPreference('player.reasoning');
  const player: PlayerConfig = {
    reasoning: reasoning === 'medium' || reasoning === 'high' ? reasoning : 'low',
    normal: number('player.normal', DEFAULT_PLAYER_CONFIG.normal * 100, 0, 100) / 100,
    afterError: number('player.afterError', DEFAULT_PLAYER_CONFIG.afterError * 100, 0, 100) / 100,
    reasoningObservation: number('player.reasoningObservation', 0, 0, 100) / 100,
  };
  const weights = { ...DEFAULT_WEIGHT_CONFIG };
  for (const key of Object.keys(weights) as Array<keyof WeightConfig>) {
    weights[key] = number(`weight.${key}`, weights[key], 0, key === 'occludedMultiplier' ? 1 : Infinity);
  }
  return { player, weights, mode: readPlaytestPreference('hand.type') === 'index' ? 'index' as const : 'thumb' as const,
    handSize: number('hand.size', .8, .5, 1), leftHand: readPlaytestPreference('hand.side') === 'left' };
}

export function configurationBatchGeometry(level: LevelData, board: DOMRect, viewport: { width: number; height: number; pixelRatio?: number },
  settings: ReturnType<typeof readConfigurationBatchSettings>): OcclusionGeometry {
  const scale = Math.min(board.width / level.columns, board.height / level.rows);
  const x = board.left + (board.width - level.columns * scale) / 2;
  const y = board.top + (board.height - level.rows * scale) / 2;
  const bounds = { x: board.x, y: board.y, left: board.left, top: board.top, right: board.right, bottom: board.bottom, width: board.width, height: board.height };
  return { board: bounds, viewportWidth: viewport.width, viewportHeight: viewport.height, pixelRatio: viewport.pixelRatio ?? 1,
    centers: level.solutionPath.map((cell) => ({ x: x + (cell.x + .5) * scale, y: y + (cell.y + .5) * scale })),
    radius: .38 * scale, clipBoard: { x, y, left: x, top: y, right: x + level.columns * scale, bottom: y + level.rows * scale, width: level.columns * scale, height: level.rows * scale },
    handSize: settings.handSize, leftHand: settings.leftHand };
}
