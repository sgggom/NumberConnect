import { describe, expect, it } from 'vitest';
import { createThumbPose, createReachingThumbPose, THUMB_ROOT, THUMB_TIP } from './thumbRig';

describe('grip movement beyond natural reach', () => {
  const dx = THUMB_TIP.x - THUMB_ROOT.x;
  const dy = THUMB_TIP.y - THUMB_ROOT.y;
  const naturalLength = Math.hypot(dx, dy);
  it('keeps the palm fixed for nearby targets', () => {
    const target = { x: THUMB_ROOT.x + dx * .8, y: THUMB_ROOT.y + dy * .8 };
    const pose = createReachingThumbPose(target);
    expect(pose(THUMB_ROOT)).toEqual(THUMB_ROOT);
    expect(pose({ x: 800, y: 1000 })).toEqual({ x: 800, y: 1000 });
  });
  it('moves the palm to make distant targets reachable with at most 4% stretch', () => {
    for (const factor of [1.01, 1.2, 2, 4]) {
      const target = { x: THUMB_ROOT.x + dx * factor, y: THUMB_ROOT.y + dy * factor };
      const pose = createReachingThumbPose(target);
      const tip = pose(THUMB_TIP);
      const root = pose(THUMB_ROOT);
      expect(tip.x).toBeCloseTo(target.x, 4);
      expect(tip.y).toBeCloseTo(target.y, 4);
      expect(Math.hypot(root.x - THUMB_ROOT.x, root.y - THUMB_ROOT.y)).toBeGreaterThan(0);
      expect(Math.hypot(tip.x - root.x, tip.y - root.y)).toBeLessThanOrEqual(naturalLength * 1.040001);
      const palmA = pose({ x: 800, y: 1000 });
      const palmB = pose({ x: 650, y: 1400 });
      expect(Math.hypot(palmA.x - palmB.x, palmA.y - palmB.y)).toBeLessThanOrEqual(Math.hypot(150, 400) * 1.040001);
    }
  });
});

describe('fixed grip thumb rig', () => {
  it('caps reverse bend at 15 degrees while preserving both bone lengths', () => {
    const dx = THUMB_TIP.x - THUMB_ROOT.x, dy = THUMB_TIP.y - THUMB_ROOT.y;
    const length = Math.hypot(dx, dy);
    const joint = { x: THUMB_ROOT.x + dx * .55, y: THUMB_ROOT.y + dy * .55 };
    for (const requested of [-15, -45, -180]) {
      const pose = createThumbPose(THUMB_TIP, requested * Math.PI / 180);
      const root = pose(THUMB_ROOT), middle = pose(joint), tip = pose(THUMB_TIP);
      const a = { x: middle.x - root.x, y: middle.y - root.y };
      const b = { x: tip.x - middle.x, y: tip.y - middle.y };
      expect(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180 / Math.PI).toBeCloseTo(15, 5);
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(length * .55, 5);
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(length * .45, 5);
    }
  });
  it('reverses above the initial fingertip height regardless of horizontal position', () => {
    const dx = THUMB_TIP.x - THUMB_ROOT.x, dy = THUMB_TIP.y - THUMB_ROOT.y;
    const joint = { x: THUMB_ROOT.x + dx * .55, y: THUMB_ROOT.y + dy * .55 };
    for (const x of [50, 255, 450, 555]) for (const rise of [-40, 0, 10, 60, 110, 150]) {
      const target = { x, y: THUMB_TIP.y - rise };
      const pose = createReachingThumbPose(target);
      const root = pose(THUMB_ROOT), middle = pose(joint), tip = pose(THUMB_TIP);
      expect(tip.x).toBeCloseTo(target.x, 5);
      expect(tip.y).toBeCloseTo(target.y, 5);
      const a = { x: middle.x - root.x, y: middle.y - root.y };
      const b = { x: tip.x - middle.x, y: tip.y - middle.y };
      const angle = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * 180 / Math.PI;
      if (rise > 0) expect(angle).toBeGreaterThan(0);
      else expect(angle).toBeLessThanOrEqual(.00001);
      expect(angle).toBeLessThanOrEqual(15.000001);
      if (rise === 110 && x === 555) expect(angle).toBeCloseTo(15, 5);
      expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(Math.hypot(dx, dy) * .55 * 1.040001);
      expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(Math.hypot(dx, dy) * .45 * 1.040001);
    }
  });
  it('switches bend sides continuously across the initial height', () => {
    const dx = THUMB_TIP.x - THUMB_ROOT.x, dy = THUMB_TIP.y - THUMB_ROOT.y;
    const joint = { x: THUMB_ROOT.x + dx * .55, y: THUMB_ROOT.y + dy * .55 };
    let previous: { x: number; y: number } | undefined;
    for (let y = THUMB_TIP.y + 25; y >= THUMB_TIP.y - 120; y -= .1) {
      const current = createReachingThumbPose({ x: 450, y })(joint);
      if (previous) expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThan(4);
      previous = current;
    }
  });
  it('preserves both segment lengths even for unreachable targets', () => {
    const dx = THUMB_TIP.x - THUMB_ROOT.x;
    const dy = THUMB_TIP.y - THUMB_ROOT.y;
    const length = Math.hypot(dx, dy);
    const joint = { x: THUMB_ROOT.x + dx * .55, y: THUMB_ROOT.y + dy * .55 };
    for (const reach of [.6, 1, 1.4, 1.85]) {
      const pose = createThumbPose({ x: THUMB_ROOT.x + dx * reach, y: THUMB_ROOT.y + dy * reach });
      const bentJoint = pose(joint);
      const tip = pose(THUMB_TIP);
      expect(Math.hypot(bentJoint.x - THUMB_ROOT.x, bentJoint.y - THUMB_ROOT.y)).toBeCloseTo(length * .55, 4);
      expect(Math.hypot(tip.x - bentJoint.x, tip.y - bentJoint.y)).toBeCloseTo(length * .45, 4);
      // The nail and fingertip region also retain their local length.
      const nail = pose({ x: THUMB_ROOT.x + dx * .8, y: THUMB_ROOT.y + dy * .8 });
      expect(Math.hypot(tip.x - nail.x, tip.y - nail.y)).toBeCloseTo(length * .2, 4);
    }
  });
  it('keeps the root, palm and wrist fixed across targets', () => {
    for (const target of [{ x: 200, y: 100 }, { x: 650, y: 400 }, { x: 350, y: 750 }]) {
      const pose = createThumbPose(target);
      for (const point of [THUMB_ROOT, { x: 800, y: 1000 }, { x: 650, y: 1400 }]) {
        expect(pose(point)).toEqual(point);
      }
    }
  });
  it('places the thumb contact point on reachable targets', () => {
    for (const target of [{ x: 300, y: 320 }, { x: 300, y: 450 }, { x: 500, y: 300 }]) {
      const tip = createThumbPose(target)(THUMB_TIP);
      expect(tip.x).toBeCloseTo(target.x, 5);
      expect(tip.y).toBeCloseTo(target.y, 5);
    }
  });
  it('limits extreme extension and remains finite at the root', () => {
    const tip = createThumbPose({ x: -10000, y: -10000 })(THUMB_TIP);
    expect(Math.hypot(tip.x - THUMB_ROOT.x, tip.y - THUMB_ROOT.y))
      .toBeCloseTo(Math.hypot(THUMB_TIP.x - THUMB_ROOT.x, THUMB_TIP.y - THUMB_ROOT.y), 4);
    const collapsed = createThumbPose(THUMB_ROOT)(THUMB_TIP);
    expect(Number.isFinite(collapsed.x) && Number.isFinite(collapsed.y)).toBe(true);
  });
  it('bends for near targets and stays straight without stretching for far targets', () => {
    const dx = THUMB_TIP.x - THUMB_ROOT.x;
    const dy = THUMB_TIP.y - THUMB_ROOT.y;
    const length = Math.hypot(dx, dy);
    const sourceJoint = { x: THUMB_ROOT.x + dx * .55, y: THUMB_ROOT.y + dy * .55 };
    const bends = [.5, .8, 1, 1.5].map((distance) => {
      const pose = createThumbPose({ x: THUMB_ROOT.x + dx * distance, y: THUMB_ROOT.y + dy * distance });
      const joint = pose(sourceJoint);
      return Math.abs((joint.x - THUMB_ROOT.x) * dy - (joint.y - THUMB_ROOT.y) * dx) / length;
    });
    expect(bends[0]).toBeGreaterThan(bends[1]);
    expect(bends[1]).toBeGreaterThan(50);
    expect(bends[2]).toBeCloseTo(0, 4);
    expect(bends[3]).toBeCloseTo(0, 4);
  });
});
