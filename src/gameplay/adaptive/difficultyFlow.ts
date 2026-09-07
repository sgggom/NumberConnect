import { DDA_CONFIG, type DifficultyRecord, type StageAttempt, type StageOutcome, type StageDifficultyState } from './stageDifficulty';
import type { PlayerPlayStats } from '../../game/playerPlayStats';
import { rhythmOffset } from './fiveGameRhythm';

export interface FlowResult {
  levelId: number;
  stage: number;
  outcome: StageOutcome;
  record?: DifficultyRecord;
  stressBefore: number;
  skillBefore: number;
  reason?: string;
}
export interface FlowInput {
  playStats?: PlayerPlayStats;
  persisted?: StageDifficultyState;
  active: boolean;
  phase: 'playing' | 'result';
  levelId: number;
  stage: number;
  totalStages: number;
  formationId: string;
  entry?: StageAttempt;
  skill: number;
  stress: number;
  progress: number;
  total: number;
  lastResult?: FlowResult;
}
export type FlowNodeState = 'waiting' | 'done' | 'active' | 'skipped';
export interface FlowNode { title: string; detail: string; state: FlowNodeState }
export interface DifficultyFlow {
  stageLabel: string;
  status: string;
  currentStep: number;
  nodes: FlowNode[];
  branch: 'waiting' | 'retry' | 'advance';
  next: string;
  summary: string;
}
const TITLES = ['读取玩家状态', '确定目标通过率', '比较十档并选档', '限制升降幅度',
  '锁定棋盘并游玩', '更新能力', '更新受挫', '决定后续去向'];
const OUTCOMES: Record<StageOutcome, string> = {
  clean: '无错误独立完成', normal: '有错误独立完成', assisted: '辅助完成', fail: '失败',
};
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;

/** Presentation of actual state only; this does not choose ranks or modify scoring. */
export const buildDifficultyFlow = (input: FlowInput): DifficultyFlow => {
  const { entry, lastResult: last } = input;
  const result = input.phase === 'result' && last?.levelId === input.levelId && last.stage === input.stage
    ? last : undefined;
  const skip = !entry ? input.formationId.startsWith('guide_') ? '引导关：固定布局，不计分'
    : '动态难度关闭：使用配置档位' : entry.excluded ? '手动调试：本阶段不计分'
      : entry.completed && !result ? '已完成阶段回放：不重复计分' : '';
  const scoring = !!entry && !skip;
  const currentStep = input.active ? result ? 8 : 5 : 0;
  const currentRank = input.formationId.startsWith('level_') ? input.formationId.split('_').at(-1) : '固定';
  const details = Array<string>(8).fill('等待处理');
  if (input.active) {
    details[0] = entry
      ? `选档时能力 ${entry.selection.skill.toFixed(3)} · 受挫 ${entry.selection.stress}；现在 ${input.skill.toFixed(3)} / ${input.stress}`
      : `能力 ${input.skill.toFixed(3)} · 受挫 ${input.stress}（保持）`;
    details[1] = entry ? `基础 ${pct(DDA_CONFIG.targets[Math.min(input.stage - 1, 3)])} + 受挫保护 → ${pct(entry.selection.target)}（上限 97%）` : skip;
    details[2] = entry ? `理想第 ${entry.selection.desired} 档；原始选档预计 ${pct(entry.selection.p)} · 难度值 ${entry.selection.rating.toFixed(2)}` : skip;
    details[3] = entry ? `第 ${entry.selection.desired} 档 → 第 ${entry.selection.difficulty} 档 · ${entry.selection.limited ? '已限制升降幅度' : '无需限制'}`
      + (entry.selection.bound ? '；目标超出曲线范围' : '') : skip;
    details[4] = `当前第 ${currentRank} 档 · 进度 ${input.progress}/${input.total}`
      + (entry ? ` · 本次错误 ${entry.errors}${entry.assisted ? ' · 已用辅助' : ''}` : '');
    details[5] = skip || (entry?.measured ? '首次结果已计分；后续结果不再加减能力' : '等待首次结果：独立完成加分，失败／辅助完成扣分');
    details[6] = skip || `当前受挫 ${input.stress}/3；无错 −1，有错完成不变，失败／辅助 +1`;
    details[7] = entry && !entry.excluded ? '完成 → 下一新阶段；重开临时 −1 档（最低 1）；复活保留棋盘' : '完成 → 下一新阶段；重开／复活保持档位';
    if (entry?.replayDifficulty !== undefined) {
      details[4] += ` · 临时降档（原始第 ${entry.selection.difficulty} 档）；不影响整体评价`;
    }
    if (entry?.assessment) {
      details[1] = '首个正式关：考察真实水平，本关各阶段固定从第 5 档开始';
      details[2] = `考察档位 5 · 初始预计 ${pct(entry.selection.p)} · 难度值 ${entry.selection.rating.toFixed(2)}`;
      details[3] = '考察关不受自动选档与升降幅度限制；下一关恢复自动选档';
    }
    if (entry?.rhythm) {
      const plannedOffset = rhythmOffset(entry.rhythm.position, input.stage);
      const offset = entry.selection.difficulty - (entry.baselineDifficulty ?? entry.selection.difficulty);
      details[3] = `动态基线 ${entry.baselineDifficulty} 档 ${offset >= 0 ? '+' : '−'} ${Math.abs(offset)} → 初始 ${entry.selection.difficulty} 档；当前 ${currentRank} 档（计划 ${plannedOffset > 0 ? "+" : ""}${plannedOffset}，初始已锁定）`;
      details[2] = `动态理想第 ${entry.selection.desired} 档；节奏调整后初始预计 ${pct(entry.selection.p)} · 难度值 ${entry.selection.rating.toFixed(2)}`;
    }
    if (entry?.excluded) {
      details[1] = '已进入手动调试，自动目标不用于当前棋盘';
      details[2] = `当前手动第 ${currentRank} 档，不展示自动选档的预计通过率`;
      details[3] = '手动调试不受自动升降幅度限制';
    }
  }
  if (result) {
    details[5] = result.record
      ? `${result.record.skillBefore.toFixed(3)} → ${result.record.skillAfter.toFixed(3)}（${signed(result.record.delta)}）· ${result.record.evidenceUsed ? '首次评价' : '已评价，不重复计分'}`
      : result.reason ?? '本次不计分';
    details[6] = result.record
      ? `${result.stressBefore} → ${result.record.stress} · ${OUTCOMES[result.outcome]}`
      : result.reason ?? '受挫保持不变';
    details[7] = result.outcome === 'fail' ? entry && !entry.excluded ? '重开 → 临时降 1 档后回第 5 步（最低 1）；复活 → 原棋盘；离开 → 保留' : '重开／复活 → 第 5 步；保持档位'
      : input.stage < input.totalStages ? '本阶段完成 → 下一阶段，从第 1 步重新选档'
        : '本关全部完成 → 结算；下一新阶段从第 1 步开始';
  }
  const branch = !result ? 'waiting' : result.outcome === 'fail' ? 'retry' : 'advance';
  return {
    stageLabel: `Level ${input.levelId} · 阶段 ${input.stage}/${input.totalStages}`,
    currentStep,
    status: !input.active ? '等待普通拼图关卡' : result
      ? result.record ? OUTCOMES[result.outcome] : result.outcome === 'fail' ? '失败（不计分）' : '完成（不计分）'
      : skip || (entry?.started ? '游玩中' : '棋盘已锁定'),
    nodes: TITLES.map((title, i) => ({ title, detail: details[i], state: !input.active ? 'waiting'
      : i >= 1 && i <= 3 && (!entry || entry.excluded) ? 'skipped'
        : (i === 5 || i === 6) && (!scoring || (result && !result.record)) ? 'skipped'
          : i + 1 === currentStep ? 'active' : i + 1 < currentStep ? 'done' : 'waiting' })),
    branch,
    next: details[7],
    summary: last ? `最近处理 · Level ${last.levelId}-${last.stage} · ${last.record ? OUTCOMES[last.outcome] : last.outcome === 'fail' ? '失败（不计分）' : '完成（不计分）'}\n`
      + (last.record ? `能力 ${signed(last.record.delta)} → ${last.record.skillAfter.toFixed(3)}；受挫 ${last.stressBefore} → ${last.record.stress}`
        : last.reason ?? '本次不计分') : '尚无结果。开始游玩后，处理到的步骤会高亮，并显示实际变化。',
  };
};
