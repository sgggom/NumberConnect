import { describe, expect, it } from 'vitest';
import { beadClusterPose, beadRewardTiming } from '../gameplay/beads';

describe('bead reward animation layout', () => {
  it('creates deterministic scattered poses around the screen center', () => {
    const poses = Array.from({ length: 32 }, (_, index) => beadClusterPose(index, 32));
    expect(beadClusterPose(7, 32)).toEqual(beadClusterPose(7, 32));
    expect(new Set(poses.map((pose) => `${pose.x.toFixed(2)},${pose.y.toFixed(2)}`)).size).toBe(32);
    expect(Math.max(...poses.map((pose) => Math.abs(pose.x)))).toBeLessThanOrEqual(64);
    expect(Math.max(...poses.map((pose) => Math.abs(pose.y)))).toBeLessThanOrEqual(48);
    expect(Math.min(...poses.map((pose) => pose.scale))).toBeGreaterThanOrEqual(0.58);
    expect(Math.max(...poses.map((pose) => pose.scale))).toBeLessThanOrEqual(0.82);

    const radii = poses.map((pose) => Math.hypot(pose.x, pose.y));
    const radiusDrops = radii.slice(1).filter((radius, index) => radius < radii[index]).length;
    expect(radiusDrops).toBeGreaterThan(8);
  });

  it('keeps long rewards moving in order without making the sequence excessively slow', () => {
    expect(beadRewardTiming(8)).toEqual({ stagger: 76, flightDuration: 560, settleDuration: 360 });
    expect(beadRewardTiming(40).stagger).toBe(51);
    expect(beadRewardTiming(40, true)).toEqual({ stagger: 0, flightDuration: 1, settleDuration: 1 });
  });
});
