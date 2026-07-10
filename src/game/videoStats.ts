export type VideoPlacement = 'endless-stage-complete' | 'normal-life-depleted' | 'endless-life-depleted';

export interface VideoViewRecord {
  id: string;
  placement: VideoPlacement;
  stage?: number;
  viewedAtUtc: string;
}

export interface VideoViewGroup {
  placement: VideoPlacement;
  count: number;
}

const VIDEO_PLACEMENTS: VideoPlacement[] = [
  'endless-stage-complete',
  'normal-life-depleted',
  'endless-life-depleted',
];

const VIDEO_VIEWS_KEY = 'number-connect.video-views.v1';

const hasStorage = (): boolean => typeof window !== 'undefined' && 'localStorage' in window;

export const parseVideoViews = (value: string | null): VideoViewRecord[] => {
  if (!value) return [];
  try {
    const records = JSON.parse(value) as unknown;
    if (!Array.isArray(records)) return [];
    return records.filter((record): record is VideoViewRecord => {
      if (!record || typeof record !== 'object') return false;
      const candidate = record as Partial<VideoViewRecord>;
      const placementValid = candidate.placement === 'endless-stage-complete'
        || candidate.placement === 'normal-life-depleted'
        || candidate.placement === 'endless-life-depleted';
      const needsStage = candidate.placement !== 'normal-life-depleted';
      const stageValid = typeof candidate.stage === 'number'
        && Number.isInteger(candidate.stage)
        && candidate.stage > 0;
      return typeof candidate.id === 'string'
        && placementValid
        && (!needsStage || stageValid)
        && typeof candidate.viewedAtUtc === 'string';
    });
  } catch {
    return [];
  }
};

export const loadVideoViews = (): VideoViewRecord[] => {
  if (!hasStorage()) return [];
  return parseVideoViews(window.localStorage.getItem(VIDEO_VIEWS_KEY));
};

export const saveVideoViews = (records: VideoViewRecord[]): void => {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(VIDEO_VIEWS_KEY, JSON.stringify(records));
  } catch {
    // Keep the in-memory statistics usable when browser storage is unavailable.
  }
};

export const createVideoView = (placement: VideoPlacement, stage?: number, viewedAt = new Date()): VideoViewRecord => ({
  id: `${viewedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
  placement,
  stage: stage === undefined ? undefined : Math.max(1, Math.floor(stage)),
  viewedAtUtc: viewedAt.toISOString(),
});

export const videoPlacementLabel = (placement: VideoPlacement): string => {
  if (placement === 'normal-life-depleted') return '普通模式 · 生命耗尽续关';
  if (placement === 'endless-life-depleted') return '无尽模式 · 生命耗尽续关';
  return '无尽模式 · 阶段结算奖励';
};

export const groupVideoViews = (records: VideoViewRecord[]): VideoViewGroup[] =>
  VIDEO_PLACEMENTS.map((placement) => ({
    placement,
    count: records.filter((record) => record.placement === placement).length,
  })).filter((group) => group.count > 0);
