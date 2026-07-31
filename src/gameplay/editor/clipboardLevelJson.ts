import { decodeCompactLevelCollection } from '../../game/levelDataFormat';
import type { LevelData } from '../../game/types';
import { MAX_EDITOR_SIZE, MIN_EDITOR_SIZE } from './types';

const getClipboardJsonCandidate = (text: string): string => {
  const trimmed = text.trim();
  if (
    trimmed.length < 2
    || !trimmed.startsWith('"')
    || !trimmed.endsWith('"')
  ) {
    return trimmed;
  }

  // A JSON string containing JSON is a valid clipboard representation.
  try {
    const decoded = JSON.parse(trimmed) as unknown;
    if (typeof decoded === 'string') return decoded.trim();
  } catch {
    // Excel encodes a copied cell as CSV/TSV: outer quotes plus doubled quotes.
  }

  return trimmed.slice(1, -1).replace(/""/g, '"').trim();
};

export const looksLikeClipboardLevelJson = (text: string): boolean => {
  const candidate = getClipboardJsonCandidate(text);
  return candidate.startsWith('{') || candidate.startsWith('[');
};

export const decodeClipboardLevelJson = (text: string): LevelData => {
  const candidate = getClipboardJsonCandidate(text);
  if (!candidate) throw new Error('剪贴板文本为空，请复制关卡 JSON 后重试。');

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    throw new Error('剪贴板文本不是有效的关卡 JSON。');
  }

  const levels = decodeCompactLevelCollection(parsed, true);
  if (levels.length !== 1) {
    throw new Error('识别完整关卡一次只能读取一个关卡 JSON。');
  }
  const level = levels[0];
  if (
    level.rows < MIN_EDITOR_SIZE
    || level.rows > MAX_EDITOR_SIZE
    || level.columns < MIN_EDITOR_SIZE
    || level.columns > MAX_EDITOR_SIZE
  ) {
    throw new Error(
      `编辑器支持的 JSON 棋盘尺寸为每边 ${MIN_EDITOR_SIZE}–${MAX_EDITOR_SIZE} 格，`
      + `当前为 ${level.columns}×${level.rows}。`,
    );
  }
  return level;
};
