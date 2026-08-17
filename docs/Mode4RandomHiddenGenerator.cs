#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;

namespace NCWeb.Algorithms;

/// <summary>
/// 玩法4简单随机分散隐藏选择器。
/// Cell 为接入方提供的棋盘坐标类型，path 按数字顺序排列。
/// 本类不接收动态难度；不同档位的差异只能来自传入的配置值。
/// </summary>
public static class Mode4RandomHiddenGenerator
{
    public static HashSet<int> SelectHiddenLayout(
        IReadOnlyList<Cell> path,
        double hiddenPercent,
        int seed,
        int maxVisibleRun,
        int maxHiddenRun,
        int firstNumberWindow = 4,
        int maxHiddenInFirstWindow = 1)
    {
        ArgumentNullException.ThrowIfNull(path);
        int pathLength = path.Count;
        if (pathLength < 3 || hiddenPercent <= 0)
            return new HashSet<int>();

        int normalizedWindow = Math.Max(
            1,
            Math.Min(pathLength, firstNumberWindow));
        var allCandidates = Enumerable
            .Range(1, pathLength - 2)
            .ToList();
        int firstWindowCandidateCount = allCandidates.Count(
            index => index < normalizedWindow);
        int normalizedFirstWindowMaximum = Math.Max(
            0,
            Math.Min(firstWindowCandidateCount, maxHiddenInFirstWindow));
        int maximumSelectableCount = allCandidates.Count
            - firstWindowCandidateCount
            + normalizedFirstWindowMaximum;
        int targetCount = Math.Min(
            maximumSelectableCount,
            JsRoundNonNegative(
                pathLength * Math.Min(100, hiddenPercent) / 100.0));
        int normalizedMaxVisibleRun = Math.Max(1, maxVisibleRun);
        int normalizedMaxHiddenRun = Math.Max(1, maxHiddenRun);
        var hidden = new HashSet<int>();

        // 固定种子的 Fisher-Yates 打散只负责完全同分时的随机顺序。
        var randomizedCandidates = new List<int>(allCandidates);
        var random = new Mulberry32(unchecked((uint)(seed ^ (int)0x4f1bbcdcu)));
        Shuffle(randomizedCandidates, random);
        var randomRank = randomizedCandidates
            .Select((index, rank) => new { index, rank })
            .ToDictionary(item => item.index, item => item.rank);

        while (hidden.Count < targetCount)
        {
            int hiddenInFirstWindow = hidden.Count(
                index => index < normalizedWindow);
            var candidates = allCandidates
                .Where(index =>
                    !hidden.Contains(index)
                    && (index >= normalizedWindow
                        || hiddenInFirstWindow < normalizedFirstWindowMaximum))
                .ToList();
            if (candidates.Count == 0)
                break;

            var scores = new List<CandidateScore>(candidates.Count);
            foreach (int index in candidates)
            {
                var projected = new HashSet<int>(hidden) { index };
                RunMetrics runs = CalculateRunMetrics(pathLength, projected);
                scores.Add(new CandidateScore(
                    Index: index,
                    HiddenOverflow: Math.Max(
                        0,
                        runs.LongestHiddenRun - normalizedMaxHiddenRun),
                    VisibleOverflow: Math.Max(
                        0,
                        runs.LongestVisibleRun - normalizedMaxVisibleRun),
                    LongestVisibleRun: runs.LongestVisibleRun,
                    LongestHiddenRun: runs.LongestHiddenRun,
                    NearestHiddenDistance: NearestHiddenDistance(
                        index,
                        hidden,
                        pathLength),
                    RandomRank: randomRank[index]));
            }

            scores.Sort(CompareCandidates);
            hidden.Add(scores[0].Index);
        }

        // 双重保护：即使调用方传入异常配置，也不隐藏首尾。
        hidden.Remove(0);
        hidden.Remove(pathLength - 1);
        return hidden;
    }

    public static RunMetrics CalculateRunMetrics(
        int pathLength,
        ISet<int> hidden)
    {
        int longestVisibleRun = 0;
        int longestHiddenRun = 0;
        int visibleRun = 0;
        int hiddenRun = 0;

        for (int index = 0; index < pathLength; index++)
        {
            if (hidden.Contains(index))
            {
                hiddenRun++;
                visibleRun = 0;
                longestHiddenRun = Math.Max(longestHiddenRun, hiddenRun);
            }
            else
            {
                visibleRun++;
                hiddenRun = 0;
                longestVisibleRun = Math.Max(longestVisibleRun, visibleRun);
            }
        }

        return new RunMetrics(longestVisibleRun, longestHiddenRun);
    }

    private static int CompareCandidates(CandidateScore left, CandidateScore right)
    {
        int result = left.HiddenOverflow.CompareTo(right.HiddenOverflow);
        if (result != 0) return result;

        result = left.VisibleOverflow.CompareTo(right.VisibleOverflow);
        if (result != 0) return result;

        result = left.LongestVisibleRun.CompareTo(right.LongestVisibleRun);
        if (result != 0) return result;

        result = right.NearestHiddenDistance.CompareTo(left.NearestHiddenDistance);
        if (result != 0) return result;

        return left.RandomRank.CompareTo(right.RandomRank);
    }

    private static int NearestHiddenDistance(
        int index,
        IReadOnlyCollection<int> hidden,
        int pathLength)
    {
        if (hidden.Count == 0)
            return Math.Min(index, pathLength - 1 - index);

        int minimum = int.MaxValue;
        foreach (int hiddenIndex in hidden)
            minimum = Math.Min(minimum, Math.Abs(index - hiddenIndex));
        return minimum;
    }

    private static int JsRoundNonNegative(double value) =>
        (int)Math.Floor(Math.Max(0, value) + 0.5);

    private static void Shuffle<T>(IList<T> items, Mulberry32 random)
    {
        for (int index = items.Count - 1; index > 0; index--)
        {
            int swapIndex = (int)Math.Floor(random.NextDouble() * (index + 1));
            (items[index], items[swapIndex]) = (items[swapIndex], items[index]);
        }
    }

    private readonly record struct CandidateScore(
        int Index,
        int HiddenOverflow,
        int VisibleOverflow,
        int LongestVisibleRun,
        int LongestHiddenRun,
        int NearestHiddenDistance,
        int RandomRank);

    public readonly record struct RunMetrics(
        int LongestVisibleRun,
        int LongestHiddenRun);

    /// <summary>复现网页端 createRandom 的 Mulberry32 伪随机序列。</summary>
    private sealed class Mulberry32
    {
        private uint _state;

        public Mulberry32(uint seed)
        {
            _state = seed;
        }

        public double NextDouble()
        {
            unchecked
            {
                _state += 0x6d2b79f5u;
                uint value = _state;
                value = Multiply(value ^ (value >> 15), value | 1u);
                value ^= value + Multiply(value ^ (value >> 7), value | 61u);
                return (value ^ (value >> 14)) / 4294967296.0;
            }
        }

        private static uint Multiply(uint left, uint right) =>
            unchecked(left * right);
    }
}
