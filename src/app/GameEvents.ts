import type { GameMode } from '../game/types';
import type { VideoPlacement } from '../game/videoStats';

interface LevelEventContext {
  mode: GameMode;
  levelId: number;
  stage?: number;
}

export interface GameEventMap {
  'level.started': LevelEventContext & { total: number };
  'level.progressed': LevelEventContext & { current: number; total: number };
  'level.wrong-move': LevelEventContext & { current: number; message: string };
  'level.completed': LevelEventContext & { total: number };
  'video.rewarded': { placement: VideoPlacement; stage?: number };
  'editor.level-saved': { levelId: number; cells: number };
}
