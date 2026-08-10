#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;

namespace NCWeb.Algorithms;

/// <summary>棋盘视觉邻接类型。正方形、长方形、菱形均使用四方向邻接。</summary>
public enum BoardShape
{
    Square,
    Rectangle,
    Diamond,
    Hex,
}

/// <summary>棋盘坐标；path 中的下标就是数字顺序（下标 0 对应数字 1）。</summary>
public readonly record struct Cell(int X, int Y);

public sealed class Algorithm8HiddenLayoutOptions
{
    public int MaxVisibleRun { get; init; } = 8;
    public int MaxHiddenRun { get; init; } = 4;
    public Action<double>? OnProgress { get; init; }
}

public readonly record struct Algorithm8SpatialMetrics(
    int HiddenComponentCount,
    int VisibleComponentCount,
    double LargestHiddenComponentRatio,
    double LargestVisibleComponentRatio,
    double MixedBoundaryRatio);

public readonly record struct Algorithm8ExperienceMetrics(
    double AverageDifficulty,
    double HardStepRatio,
    double PeakDifficulty);

/// <summary>
/// 算法 8 的“隐藏布局阶段”C# 移植。
/// 输入必须是已经生成好的完整数字路径；路径生成阶段仍沿用算法 2。
/// </summary>
public static class Algorithm8HiddenGenerator
{
    public const double MaxHiddenComponentRatio = 0.40;
    public const double PreferredHiddenComponentRatio = 0.25;

    private static readonly DifficultyTarget[] DifficultyTargets =
    {
        new(0.02, 0.01, 0.3),
        new(0.06, 0.04, 0.6),
        new(0.12, 0.08, 1.0),
        new(0.20, 0.14, 1.4),
        new(0.30, 0.20, 1.9),
        new(0.42, 0.27, 2.4),
        new(0.56, 0.34, 3.0),
        new(0.70, 0.40, 3.6),
        new(0.84, 0.46, 4.2),
        new(1.00, 0.52, 5.0),
    };

    /// <summary>
    /// 生成与网页端 runAlgorithm8 相同口径的隐藏阶段种子。
    /// unchecked 用于复现 JavaScript Math.imul/位运算的 32 位溢出行为。
    /// </summary>
    public static int BuildSeed(int generationIndex, int rows, int columns, int pathLength)
    {
        unchecked
        {
            return ((generationIndex + 1) * 104729)
                ^ ((rows + 1) * 73856093)
                ^ ((columns + 1) * 19349663)
                ^ pathLength
                ^ 0x2b7e1516;
        }
    }

    /// <summary>实际隐藏占比 = 基础隐藏占比 + 难度对应的百分点，最高 100%。</summary>
    public static double EffectiveHiddenPercent(double requestedPercent, double targetDifficulty)
    {
        var basePercent = Math.Clamp(requestedPercent, 0, 100);
        var difficultyLevel = NormalizeDifficultyLevel(targetDifficulty);
        return Math.Min(100, basePercent + difficultyLevel);
    }

    /// <summary>
    /// 新规则：基准点数量为目标隐藏数量的前 10%，向上取整。
    /// 例如 1/10/11/64/100 个隐藏格对应 1/1/2/7/10 个基准点。
    /// </summary>
    public static int BaseSelectionCount(int targetHiddenCount)
    {
        var count = Math.Max(0, targetHiddenCount);
        return Math.Min(count, (int)Math.Ceiling(count * 0.10));
    }

    public static double AdjacentExpansionProbability(double targetDifficulty) =>
        NormalizedDifficulty(targetDifficulty) * 0.85;

    public static int AdjacentExpansionCount(int expansionCount, double targetDifficulty)
    {
        var count = Math.Max(0, expansionCount);
        return JsRoundNonNegative(count * AdjacentExpansionProbability(targetDifficulty));
    }

    /// <summary>
    /// 选择隐藏数字，返回 path 下标集合。首尾下标 0 和 path.Count - 1 永远不会隐藏。
    /// 结果是集合语义，序列化时建议按下标排序。
    /// </summary>
    public static HashSet<int> SelectHiddenLayout(
        IReadOnlyList<Cell> path,
        BoardShape shape,
        double requestedPercent,
        double targetDifficulty,
        int seed,
        Algorithm8HiddenLayoutOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(path);
        options ??= new Algorithm8HiddenLayoutOptions();

        var availableCount = Math.Max(0, path.Count - 2);
        var effectivePercent = EffectiveHiddenPercent(requestedPercent, targetDifficulty);
        var targetCount = Math.Min(
            availableCount,
            Math.Max(0, JsRoundNonNegative(path.Count * effectivePercent / 100.0)));

        var hidden = new HashSet<int>();
        var baseHidden = new HashSet<int>();
        var maximumVisibleRun = Math.Max(1, options.MaxVisibleRun);
        var maximumHiddenRun = Math.Max(1, options.MaxHiddenRun);
        var neighbors = BuildVisualNeighborIndexes(path, shape);
        var random = new JavaScriptRandom(unchecked((uint)seed) ^ 0x6f29d417u);
        var baseCount = BaseSelectionCount(targetCount);
        var expansionCount = Math.Max(0, targetCount - baseCount);
        var adjacentExpansionCount = AdjacentExpansionCount(expansionCount, targetDifficulty);
        var edgeCount = neighbors.Sum(items => items.Count) / 2;

        for (var pass = 0; pass < targetCount; pass += 1)
        {
            var allCandidates = Enumerable.Range(1, availableCount)
                .Where(index => !hidden.Contains(index))
                .ToList();

            var progress = (pass + 1.0) / Math.Max(1, targetCount);
            var isBaseSelection = pass < baseCount;
            var candidates = allCandidates;

            // 基准阶段优先选“峰值难度为 0”的分散位置。
            if (isBaseSelection)
            {
                var neutralCandidates = allCandidates.Where(candidate =>
                {
                    var projected = CopyAndAdd(hidden, candidate);
                    var metrics = CalculateExperienceMetrics(path, projected, neighbors);
                    return metrics.PeakDifficulty == 0;
                }).ToList();
                if (neutralCandidates.Count > 0) candidates = neutralCandidates;
            }
            else
            {
                // 扩张阶段按难度配额，均匀安排“贴近基准点”的选择次数。
                var adjacentCandidates = allCandidates
                    .Where(candidate => neighbors[candidate].Any(baseHidden.Contains))
                    .ToList();
                var nonAdjacentCandidates = allCandidates
                    .Where(candidate => !neighbors[candidate].Any(baseHidden.Contains))
                    .ToList();
                var useAdjacentCandidate = adjacentCandidates.Count > 0
                    && IsScheduledAdjacentExpansion(
                        pass - baseCount,
                        expansionCount,
                        adjacentExpansionCount);
                candidates = useAdjacentCandidate
                    ? adjacentCandidates
                    : nonAdjacentCandidates.Count > 0
                        ? nonAdjacentCandidates
                        : allCandidates;
            }

            // 预测每个候选加入后隐藏连通块与显隐交界的变化。
            var componentState = BuildHiddenComponentState(hidden, neighbors);
            var mixedBoundaryCount = CalculateMixedBoundaryCount(hidden, neighbors);
            var projectedSpatial = allCandidates.ToDictionary(
                candidate => candidate,
                candidate => CalculateProjectedSpatialMetrics(
                    candidate,
                    hidden,
                    neighbors,
                    componentState,
                    mixedBoundaryCount,
                    edgeCount));

            var preferredDistributed = FilterByComponentRatio(
                candidates,
                projectedSpatial,
                PreferredHiddenComponentRatio);
            var allDistributed = FilterByComponentRatio(
                allCandidates,
                projectedSpatial,
                PreferredHiddenComponentRatio);
            var preferredClusterSafe = FilterByComponentRatio(
                candidates,
                projectedSpatial,
                MaxHiddenComponentRatio);
            var allClusterSafe = FilterByComponentRatio(
                allCandidates,
                projectedSpatial,
                MaxHiddenComponentRatio);

            if (preferredDistributed.Count > 0) candidates = preferredDistributed;
            else if (allDistributed.Count > 0) candidates = allDistributed;
            else if (preferredClusterSafe.Count > 0) candidates = preferredClusterSafe;
            else if (allClusterSafe.Count > 0) candidates = allClusterSafe;

            // 连续段约束：必须还能在剩余次数内拆开过长的显示段。
            var remainingSelections = targetCount - pass - 1;
            var runStateByCandidate = allCandidates.ToDictionary(
                candidate => candidate,
                candidate => CalculateRunState(
                    path.Count,
                    CopyAndAdd(hidden, candidate),
                    maximumVisibleRun));

            var preferredRunSafe = FilterWithinRunLimits(
                candidates,
                runStateByCandidate,
                maximumHiddenRun,
                remainingSelections);
            var clusterRunSafe = FilterWithinRunLimits(
                allClusterSafe,
                runStateByCandidate,
                maximumHiddenRun,
                remainingSelections);
            var allRunSafe = FilterWithinRunLimits(
                allCandidates,
                runStateByCandidate,
                maximumHiddenRun,
                remainingSelections);
            var preferredHiddenSafe = FilterWithinHiddenLimit(
                candidates,
                runStateByCandidate,
                maximumHiddenRun);
            var clusterHiddenSafe = FilterWithinHiddenLimit(
                allClusterSafe,
                runStateByCandidate,
                maximumHiddenRun);
            var allHiddenSafe = FilterWithinHiddenLimit(
                allCandidates,
                runStateByCandidate,
                maximumHiddenRun);

            if (preferredRunSafe.Count > 0) candidates = preferredRunSafe;
            else if (clusterRunSafe.Count > 0) candidates = clusterRunSafe;
            else if (allRunSafe.Count > 0) candidates = allRunSafe;
            else if (preferredHiddenSafe.Count > 0) candidates = preferredHiddenSafe;
            else if (clusterHiddenSafe.Count > 0) candidates = clusterHiddenSafe;
            else if (allHiddenSafe.Count > 0) candidates = allHiddenSafe;

            var evaluations = candidates.Select(candidate =>
            {
                var projected = CopyAndAdd(hidden, candidate);
                var directHiddenCount = neighbors[candidate].Count(hidden.Contains);
                var distance = MinimumGraphDistance(candidate, hidden, neighbors);
                var spatial = projectedSpatial[candidate];
                var spatialLoss = spatial.LargestHiddenComponentRatio * 4
                    - spatial.MixedBoundaryRatio * 2;
                var experienceMetrics = CalculateExperienceMetrics(path, projected, neighbors);
                var difficultyLoss = CalculateDifficultyLoss(
                    experienceMetrics,
                    targetDifficulty,
                    progress);
                var adjacentBaseLoads = neighbors[candidate]
                    .Where(baseHidden.Contains)
                    .Select(baseIndex => neighbors[baseIndex].Count(neighbor =>
                        hidden.Contains(neighbor) && !baseHidden.Contains(neighbor)))
                    .ToList();
                var baseLoad = adjacentBaseLoads.Count == 0 ? 0 : adjacentBaseLoads.Min();
                var runState = runStateByCandidate[candidate];
                var runLoss = Math.Max(0, runState.LongestHiddenRun - maximumHiddenRun) * 50
                    + Math.Max(
                        0,
                        runState.MinimumAdditionalHiddenCount - remainingSelections) * 50
                    + (remainingSelections == 0
                        ? Math.Max(0, runState.LongestVisibleRun - maximumVisibleRun) * 5
                        : 0);
                var secondRingCount = SecondRingHiddenCount(candidate, hidden, neighbors);
                var baseLoss = spatialLoss * 1.2
                    + directHiddenCount * 8
                    + secondRingCount * 1.5
                    - distance * 0.8
                    + runLoss;

                return new CandidateEvaluation(
                    candidate,
                    baseLoad,
                    baseLoss,
                    difficultyLoss,
                    directHiddenCount,
                    distance,
                    CalculateExperienceValue(experienceMetrics),
                    runLoss,
                    secondRingCount,
                    spatialLoss);
            }).ToList();

            var minimumExperience = evaluations.Min(item => item.ExperienceValue);
            var maximumExperience = evaluations.Max(item => item.ExperienceValue);
            var experienceRange = maximumExperience - minimumExperience;
            var difficultyRatio = NormalizedDifficulty(targetDifficulty);

            // LINQ OrderBy 是稳定排序；相同损失时保持候选下标的原始顺序。
            var scoredCandidates = evaluations.Select(evaluation =>
            {
                var relativeExperience = experienceRange <= 1e-9
                    ? 0.5
                    : (evaluation.ExperienceValue - minimumExperience) / experienceRange;
                var relativeDifficultyLoss = Math.Abs(relativeExperience - difficultyRatio);
                var loss = isBaseSelection
                    ? evaluation.BaseLoss
                    : relativeDifficultyLoss * 8
                        + evaluation.DifficultyLoss * 0.5
                        + evaluation.SpatialLoss * 0.35
                        + evaluation.DirectHiddenCount * 0.45
                        + evaluation.SecondRingCount * 0.15
                        + evaluation.BaseLoad * 1.2
                        - evaluation.Distance * 0.05
                        + evaluation.RunLoss;
                return new ScoredCandidate(evaluation.Candidate, loss);
            }).OrderBy(item => item.Loss).ToList();

            // 不固定取唯一最优：在少量最优候选中按种子加权抽取，避免图案僵化。
            var poolSize = Math.Min(
                isBaseSelection ? 5 : 2,
                Math.Max(1, (int)Math.Ceiling(Math.Sqrt(scoredCandidates.Count) / 2.0)));
            var pool = scoredCandidates.Take(poolSize).ToList();
            var bestLoss = pool[0].Loss;
            var weights = pool
                .Select(item => Math.Exp(
                    -(item.Loss - bestLoss) / (isBaseSelection ? 0.75 : 0.12)))
                .ToList();
            var totalWeight = weights.Sum();
            var cursor = random.NextDouble() * totalWeight;
            var selected = pool[^1].Candidate;
            for (var index = 0; index < pool.Count; index += 1)
            {
                cursor -= weights[index];
                if (cursor > 0) continue;
                selected = pool[index].Candidate;
                break;
            }

            hidden.Add(selected);
            if (isBaseSelection) baseHidden.Add(selected);
            options.OnProgress?.Invoke((pass + 1.0) / Math.Max(1, targetCount));
        }

        if (targetCount == 0) options.OnProgress?.Invoke(1);
        return hidden;
    }

    public static Algorithm8SpatialMetrics CalculateSpatialMetrics(
        IReadOnlyList<Cell> path,
        IReadOnlySet<int> hiddenIndices,
        BoardShape shape)
    {
        var neighbors = BuildVisualNeighborIndexes(path, shape);
        var hiddenComponents = ComponentSizes(path.Count, hiddenIndices, neighbors, true);
        var visibleComponents = ComponentSizes(path.Count, hiddenIndices, neighbors, false);
        var edgeCount = 0;
        var mixedBoundaryCount = 0;
        for (var index = 0; index < neighbors.Length; index += 1)
        {
            foreach (var neighbor in neighbors[index])
            {
                if (neighbor <= index) continue;
                edgeCount += 1;
                if (hiddenIndices.Contains(index) != hiddenIndices.Contains(neighbor))
                    mixedBoundaryCount += 1;
            }
        }

        var hiddenCount = hiddenIndices.Count;
        var visibleCount = Math.Max(0, path.Count - hiddenCount);
        return new Algorithm8SpatialMetrics(
            hiddenComponents.Count,
            visibleComponents.Count,
            hiddenCount == 0 ? 0 : hiddenComponents.DefaultIfEmpty(0).Max() / (double)hiddenCount,
            visibleCount == 0 ? 0 : visibleComponents.DefaultIfEmpty(0).Max() / (double)visibleCount,
            edgeCount == 0 ? 0 : mixedBoundaryCount / (double)edgeCount);
    }

    public static double CalculateSpatialLoss(Algorithm8SpatialMetrics metrics) =>
        metrics.LargestHiddenComponentRatio * 4
        + metrics.LargestVisibleComponentRatio * 1.5
        - metrics.MixedBoundaryRatio * 2;

    public static Algorithm8ExperienceMetrics CalculateExperienceMetrics(
        IReadOnlyList<Cell> path,
        IReadOnlySet<int> hiddenIndices,
        BoardShape shape) =>
        CalculateExperienceMetrics(path, hiddenIndices, BuildVisualNeighborIndexes(path, shape));

    public static double CalculateExperienceValue(Algorithm8ExperienceMetrics metrics) =>
        metrics.AverageDifficulty * 2.5
        + metrics.HardStepRatio * 2
        + metrics.PeakDifficulty * 0.4;

    public static double CalculateDifficultyLoss(
        Algorithm8ExperienceMetrics metrics,
        double targetDifficulty,
        double progress = 1)
    {
        var level = NormalizeDifficultyLevel(targetDifficulty);
        var target = DifficultyTargets[level - 1];
        var scaledProgress = Math.Clamp(progress, 0, 1);
        return Math.Abs(metrics.AverageDifficulty - target.AverageDifficulty * scaledProgress) / 0.3 * 0.5
            + Math.Abs(metrics.HardStepRatio - target.HardStepRatio * scaledProgress) / 0.2 * 0.3
            + Math.Abs(metrics.PeakDifficulty - target.PeakDifficulty * scaledProgress) / 1.5 * 0.2;
    }

    private static List<int>[] BuildVisualNeighborIndexes(
        IReadOnlyList<Cell> path,
        BoardShape shape)
    {
        var indexByCell = new Dictionary<Cell, int>();
        for (var index = 0; index < path.Count; index += 1)
            indexByCell[path[index]] = index;

        var result = new List<int>[path.Count];
        for (var index = 0; index < path.Count; index += 1)
        {
            var cell = path[index];
            Cell[] visualNeighbors;
            if (shape == BoardShape.Hex)
            {
                visualNeighbors = cell.X % 2 == 0
                    ? new[]
                    {
                        new Cell(cell.X, cell.Y - 1),
                        new Cell(cell.X, cell.Y + 1),
                        new Cell(cell.X - 1, cell.Y - 1),
                        new Cell(cell.X - 1, cell.Y),
                        new Cell(cell.X + 1, cell.Y - 1),
                        new Cell(cell.X + 1, cell.Y),
                    }
                    : new[]
                    {
                        new Cell(cell.X, cell.Y - 1),
                        new Cell(cell.X, cell.Y + 1),
                        new Cell(cell.X - 1, cell.Y),
                        new Cell(cell.X - 1, cell.Y + 1),
                        new Cell(cell.X + 1, cell.Y),
                        new Cell(cell.X + 1, cell.Y + 1),
                    };
            }
            else
            {
                visualNeighbors = new[]
                {
                    new Cell(cell.X - 1, cell.Y),
                    new Cell(cell.X + 1, cell.Y),
                    new Cell(cell.X, cell.Y - 1),
                    new Cell(cell.X, cell.Y + 1),
                };
            }

            result[index] = visualNeighbors
                .Where(indexByCell.ContainsKey)
                .Select(neighbor => indexByCell[neighbor])
                .ToList();
        }

        return result;
    }

    private static Algorithm8ExperienceMetrics CalculateExperienceMetrics(
        IReadOnlyList<Cell> path,
        IReadOnlySet<int> hiddenIndices,
        IReadOnlyList<int>[] neighbors)
    {
        var scores = new List<double>();
        for (var index = 0; index < path.Count - 1; index += 1)
        {
            if (!hiddenIndices.Contains(index + 1))
            {
                scores.Add(0);
                continue;
            }

            var hiddenChoices = neighbors[index].Count(neighbor =>
                neighbor > index && hiddenIndices.Contains(neighbor));
            var nextVisibleIndex = index + 1;
            while (nextVisibleIndex < path.Count - 1 && hiddenIndices.Contains(nextVisibleIndex))
                nextVisibleIndex += 1;

            var clueDistance = nextVisibleIndex - index;
            var reasoning = CountReasoningBranches(
                index,
                nextVisibleIndex,
                hiddenIndices,
                neighbors);
            var locallyImpossibleChoices = Math.Max(
                0,
                hiddenChoices - reasoning.ValidFirstChoiceCount);
            var alternativeValidChoices = Math.Max(
                0,
                reasoning.ValidFirstChoiceCount - 1);
            var extraReasoningBranches = Math.Max(
                0,
                reasoning.BranchCount - reasoning.ValidFirstChoiceCount);
            var score = locallyImpossibleChoices * (0.9 + Math.Max(0, clueDistance - 2) * 0.18)
                + alternativeValidChoices * 0.25
                + extraReasoningBranches * 0.12
                + Math.Max(0, clueDistance - 2) * 0.06;
            scores.Add(Math.Min(5, score));
        }

        var total = Math.Max(1, scores.Count);
        return new Algorithm8ExperienceMetrics(
            scores.Sum() / total,
            scores.Count(score => score >= 1) / (double)total,
            scores.DefaultIfEmpty(0).Max());
    }

    private static ReasoningBranches CountReasoningBranches(
        int startIndex,
        int targetIndex,
        IReadOnlySet<int> hiddenIndices,
        IReadOnlyList<int>[] neighbors)
    {
        var requiredMoves = targetIndex - startIndex;
        if (requiredMoves <= 1) return new ReasoningBranches(0, 0);

        var visited = new HashSet<int> { startIndex };
        var validFirstChoices = new HashSet<int>();
        var branchCount = 0;
        const int maximumTrackedBranches = 100;

        void Search(int current, int movesUsed, int? firstChoice)
        {
            if (branchCount >= maximumTrackedBranches) return;
            var movesRemaining = requiredMoves - movesUsed;
            if (movesRemaining == 1)
            {
                if (neighbors[current].Contains(targetIndex))
                {
                    branchCount += 1;
                    if (firstChoice.HasValue) validFirstChoices.Add(firstChoice.Value);
                }
                return;
            }

            foreach (var neighbor in neighbors[current])
            {
                if (neighbor == targetIndex
                    || neighbor <= startIndex
                    || !hiddenIndices.Contains(neighbor)
                    || visited.Contains(neighbor))
                {
                    continue;
                }

                visited.Add(neighbor);
                Search(neighbor, movesUsed + 1, firstChoice ?? neighbor);
                visited.Remove(neighbor);
            }
        }

        Search(startIndex, 0, null);
        return new ReasoningBranches(branchCount, validFirstChoices.Count);
    }

    private static HiddenComponentState BuildHiddenComponentState(
        IReadOnlySet<int> hidden,
        IReadOnlyList<int>[] neighbors)
    {
        var componentByIndex = Enumerable.Repeat(-1, neighbors.Length).ToArray();
        var componentSizes = new List<int>();
        foreach (var start in hidden)
        {
            if (componentByIndex[start] != -1) continue;
            var componentId = componentSizes.Count;
            var pending = new Stack<int>();
            pending.Push(start);
            componentByIndex[start] = componentId;
            var size = 0;
            while (pending.Count > 0)
            {
                var current = pending.Pop();
                size += 1;
                foreach (var neighbor in neighbors[current])
                {
                    if (!hidden.Contains(neighbor) || componentByIndex[neighbor] != -1) continue;
                    componentByIndex[neighbor] = componentId;
                    pending.Push(neighbor);
                }
            }
            componentSizes.Add(size);
        }

        return new HiddenComponentState(
            componentByIndex,
            componentSizes.ToArray(),
            componentSizes.DefaultIfEmpty(0).Max());
    }

    private static int CalculateMixedBoundaryCount(
        IReadOnlySet<int> hidden,
        IReadOnlyList<int>[] neighbors)
    {
        var total = 0;
        for (var index = 0; index < neighbors.Length; index += 1)
        {
            total += neighbors[index].Count(neighbor =>
                neighbor > index && hidden.Contains(index) != hidden.Contains(neighbor));
        }
        return total;
    }

    private static ProjectedSpatialMetrics CalculateProjectedSpatialMetrics(
        int candidate,
        IReadOnlySet<int> hidden,
        IReadOnlyList<int>[] neighbors,
        HiddenComponentState componentState,
        int mixedBoundaryCount,
        int edgeCount)
    {
        var adjacentComponents = new HashSet<int>();
        var directHiddenCount = 0;
        foreach (var neighbor in neighbors[candidate])
        {
            if (!hidden.Contains(neighbor)) continue;
            directHiddenCount += 1;
            var componentId = componentState.ComponentByIndex[neighbor];
            if (componentId >= 0) adjacentComponents.Add(componentId);
        }

        var mergedComponentSize = 1 + adjacentComponents.Sum(
            componentId => componentState.ComponentSizes[componentId]);
        var projectedMixedBoundaryCount = mixedBoundaryCount
            + (neighbors[candidate].Count - directHiddenCount)
            - directHiddenCount;
        return new ProjectedSpatialMetrics(
            Math.Max(componentState.LargestSize, mergedComponentSize)
                / (double)Math.Max(1, hidden.Count + 1),
            edgeCount == 0 ? 0 : projectedMixedBoundaryCount / (double)edgeCount);
    }

    private static RunState CalculateRunState(
        int pathCount,
        IReadOnlySet<int> hidden,
        int maximumVisibleRun)
    {
        var hiddenRun = 0;
        var visibleRun = 0;
        var longestHiddenRun = 0;
        var longestVisibleRun = 0;
        var minimumAdditionalHiddenCount = 0;

        void FinishVisibleRun()
        {
            longestVisibleRun = Math.Max(longestVisibleRun, visibleRun);
            minimumAdditionalHiddenCount += visibleRun / (maximumVisibleRun + 1);
            visibleRun = 0;
        }

        for (var index = 0; index < pathCount; index += 1)
        {
            if (hidden.Contains(index))
            {
                FinishVisibleRun();
                hiddenRun += 1;
                longestHiddenRun = Math.Max(longestHiddenRun, hiddenRun);
            }
            else
            {
                hiddenRun = 0;
                visibleRun += 1;
            }
        }
        FinishVisibleRun();
        return new RunState(longestHiddenRun, longestVisibleRun, minimumAdditionalHiddenCount);
    }

    private static int MinimumGraphDistance(
        int start,
        IReadOnlySet<int> targets,
        IReadOnlyList<int>[] neighbors)
    {
        if (targets.Count == 0) return 0;
        var visited = new HashSet<int> { start };
        var frontier = new List<int> { start };
        var distance = 0;
        while (frontier.Count > 0)
        {
            distance += 1;
            var nextFrontier = new List<int>();
            foreach (var current in frontier)
            {
                foreach (var neighbor in neighbors[current])
                {
                    if (targets.Contains(neighbor)) return distance;
                    if (!visited.Add(neighbor)) continue;
                    nextFrontier.Add(neighbor);
                }
            }
            frontier = nextFrontier;
        }
        return neighbors.Length;
    }

    private static int SecondRingHiddenCount(
        int index,
        IReadOnlySet<int> hidden,
        IReadOnlyList<int>[] neighbors)
    {
        var secondRing = new HashSet<int>();
        foreach (var neighbor in neighbors[index])
        {
            foreach (var secondNeighbor in neighbors[neighbor])
            {
                if (secondNeighbor != index && !neighbors[index].Contains(secondNeighbor))
                    secondRing.Add(secondNeighbor);
            }
        }
        return secondRing.Count(hidden.Contains);
    }

    private static bool IsScheduledAdjacentExpansion(
        int expansionIndex,
        int expansionCount,
        int adjacentExpansionCount)
    {
        if (expansionCount <= 0 || adjacentExpansionCount <= 0) return false;
        var completedBefore = (long)expansionIndex * adjacentExpansionCount / expansionCount;
        var completedAfter = (long)(expansionIndex + 1) * adjacentExpansionCount / expansionCount;
        return completedAfter > completedBefore;
    }

    private static List<int> FilterByComponentRatio(
        IEnumerable<int> source,
        IReadOnlyDictionary<int, ProjectedSpatialMetrics> projectedSpatial,
        double maximumRatio) =>
        source.Where(candidate =>
            projectedSpatial[candidate].LargestHiddenComponentRatio <= maximumRatio).ToList();

    private static List<int> FilterWithinRunLimits(
        IEnumerable<int> source,
        IReadOnlyDictionary<int, RunState> runStateByCandidate,
        int maximumHiddenRun,
        int remainingSelections) =>
        source.Where(candidate =>
        {
            var state = runStateByCandidate[candidate];
            return state.LongestHiddenRun <= maximumHiddenRun
                && state.MinimumAdditionalHiddenCount <= remainingSelections;
        }).ToList();

    private static List<int> FilterWithinHiddenLimit(
        IEnumerable<int> source,
        IReadOnlyDictionary<int, RunState> runStateByCandidate,
        int maximumHiddenRun) =>
        source.Where(candidate =>
            runStateByCandidate[candidate].LongestHiddenRun <= maximumHiddenRun).ToList();

    private static List<int> ComponentSizes(
        int pathCount,
        IReadOnlySet<int> hiddenIndices,
        IReadOnlyList<int>[] neighbors,
        bool hiddenState)
    {
        var remaining = new HashSet<int>(Enumerable.Range(0, pathCount).Where(index =>
            hiddenIndices.Contains(index) == hiddenState));
        var sizes = new List<int>();
        while (remaining.Count > 0)
        {
            var first = remaining.First();
            remaining.Remove(first);
            var pending = new Stack<int>();
            pending.Push(first);
            var size = 0;
            while (pending.Count > 0)
            {
                var current = pending.Pop();
                size += 1;
                foreach (var neighbor in neighbors[current])
                {
                    if (!remaining.Remove(neighbor)) continue;
                    pending.Push(neighbor);
                }
            }
            sizes.Add(size);
        }
        return sizes;
    }

    private static HashSet<int> CopyAndAdd(IReadOnlySet<int> source, int value)
    {
        var result = new HashSet<int>(source) { value };
        return result;
    }

    private static int NormalizeDifficultyLevel(double targetDifficulty) =>
        Math.Clamp((int)Math.Floor(targetDifficulty), 1, 10);

    private static double NormalizedDifficulty(double targetDifficulty) =>
        (NormalizeDifficultyLevel(targetDifficulty) - 1) / 9.0;

    /// <summary>复现 JavaScript Math.round 对非负数的行为，避免 C# 默认银行家舍入。</summary>
    private static int JsRoundNonNegative(double value) => (int)Math.Floor(value + 0.5);

    private readonly record struct DifficultyTarget(
        double AverageDifficulty,
        double HardStepRatio,
        double PeakDifficulty);

    private readonly record struct ReasoningBranches(
        int BranchCount,
        int ValidFirstChoiceCount);

    private sealed record HiddenComponentState(
        int[] ComponentByIndex,
        int[] ComponentSizes,
        int LargestSize);

    private readonly record struct ProjectedSpatialMetrics(
        double LargestHiddenComponentRatio,
        double MixedBoundaryRatio);

    private readonly record struct RunState(
        int LongestHiddenRun,
        int LongestVisibleRun,
        int MinimumAdditionalHiddenCount);

    private readonly record struct CandidateEvaluation(
        int Candidate,
        int BaseLoad,
        double BaseLoss,
        double DifficultyLoss,
        int DirectHiddenCount,
        int Distance,
        double ExperienceValue,
        double RunLoss,
        int SecondRingCount,
        double SpatialLoss);

    private readonly record struct ScoredCandidate(int Candidate, double Loss);

    /// <summary>与 src/game/random.ts 的 createRandom 相同（Mulberry32 变体）。</summary>
    private sealed class JavaScriptRandom
    {
        private uint _state;

        public JavaScriptRandom(uint seed) => _state = seed;

        public double NextDouble()
        {
            unchecked
            {
                _state += 0x6d2b79f5u;
                var value = _state;
                value = (value ^ (value >> 15)) * (value | 1u);
                value ^= value + (value ^ (value >> 7)) * (value | 61u);
                return (value ^ (value >> 14)) / 4294967296.0;
            }
        }
    }
}
