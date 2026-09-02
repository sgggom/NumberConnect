import { calculateHeldCellScore } from '../../../game/boardNeighborhood';
import { PathCompletionSolver } from '../../../game/pathCompletionSolver';
import type { BoardHoldScore, BoardShape, Cell } from '../../../game/types';
import type { DynamicDifficultyTier, DynamicTierCounts } from './dynamicHiddenProfiles';

export interface DynamicStepDifficulty {
  centerIndex: number;
  targetIndex: number;
  tier: DynamicDifficultyTier;
  strictTier0: boolean;
  tier2WithinRange: boolean;
  score: BoardHoldScore;
}

export interface DynamicStepAnalysis {
  steps: DynamicStepDifficulty[];
  tierCounts: DynamicTierCounts;
  ambiguousStepCount: number;
  unsafeTier0Count: number;
  tier2OverRangeCount: number;
  earlyTier2Count: number;
  longestTier2Run: number;
  peakActualScore: number;
}

const normalizedTier = (score: BoardHoldScore): DynamicDifficultyTier => (
  Math.min(3, Math.max(0, score.totalDigitScore)) as DynamicDifficultyTier
);

export const analyzeDynamicHiddenLayout = (
  path: ReadonlyArray<Cell>,
  boardShape: BoardShape,
  hiddenIndices: ReadonlySet<number>,
  maxTier2ActualScore = 40,
): DynamicStepAnalysis => {
  const pathCells = path.map((cell) => ({ ...cell }));
  const hidden = new Set([...hiddenIndices].filter((index) => (
    Number.isInteger(index) && index > 0 && index < path.length - 1
  )));
  const fixedPositions = new Map<number, number>();
  path.forEach((_cell, index) => {
    if (!hidden.has(index)) fixedPositions.set(index, index);
  });
  const requiredEdges: Array<readonly [number, number]> = [];
  const solver = new PathCompletionSolver(pathCells, boardShape);
  const steps: DynamicStepDifficulty[] = [];

  for (let centerIndex = 0; centerIndex < path.length - 1; centerIndex += 1) {
    fixedPositions.set(centerIndex, centerIndex);
    const targetIndex = centerIndex + 1;
    if (hidden.has(targetIndex)) {
      const score = calculateHeldCellScore(
        { boardShape, solutionPath: pathCells },
        centerIndex,
        (index) => index > centerIndex && hidden.has(index),
        (index) => index <= centerIndex || !hidden.has(index),
        (index) => index + 1,
        (candidateIndex) => {
          if (candidateIndex === targetIndex) return false;
          return solver.findCompletion({
            fixedPositions,
            requiredEdges: [...requiredEdges, [centerIndex, candidateIndex]],
            directedStep: { from: centerIndex, to: candidateIndex, direction: 1 },
          }) === null;
        },
      );
      const tier = normalizedTier(score);
      steps.push({
        centerIndex,
        targetIndex,
        tier,
        strictTier0: tier !== 0 || (
          score.choiceScore <= 1
          && score.nextNumberDistance <= 2
          && score.feasibleChoiceCount === 1
        ),
        tier2WithinRange: tier !== 2 || score.actualScore <= maxTier2ActualScore,
        score,
      });
    }
    requiredEdges.push([centerIndex, targetIndex]);
    fixedPositions.set(targetIndex, targetIndex);
  }

  const tierCounts: [number, number, number, number] = [0, 0, 0, 0];
  let longestTier2Run = 0;
  let tier2Run = 0;
  steps.forEach((step) => {
    tierCounts[step.tier] += 1;
    if (step.tier === 2) {
      tier2Run += 1;
      longestTier2Run = Math.max(longestTier2Run, tier2Run);
    } else {
      tier2Run = 0;
    }
  });

  return {
    steps,
    tierCounts,
    ambiguousStepCount: steps.filter((step) => step.score.feasibleChoiceCount > 1).length,
    unsafeTier0Count: steps.filter((step) => step.tier === 0 && !step.strictTier0).length,
    tier2OverRangeCount: steps.filter((step) => step.tier === 2 && !step.tier2WithinRange).length,
    earlyTier2Count: steps.slice(0, 2).filter((step) => step.tier === 2).length,
    longestTier2Run,
    peakActualScore: Math.max(0, ...steps.map((step) => step.score.actualScore)),
  };
};
