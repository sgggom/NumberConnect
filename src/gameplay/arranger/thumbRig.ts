export interface Point { x: number; y: number }
export const THUMB_ROOT: Point = { x: 555, y: 590 };
export const THUMB_TIP: Point = { x: 255, y: 320 };
const dx = THUMB_TIP.x - THUMB_ROOT.x;
const dy = THUMB_TIP.y - THUMB_ROOT.y;
const length = Math.hypot(dx, dy);
const axis = { x: dx / length, y: dy / length };
const normal = { x: -axis.y, y: axis.x };
export const THUMB_REVERSE_LIMIT_DEGREES = 15;
const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

/** Reach beyond the natural thumb length by moving the whole grip, with at most 4% shared stretch. */
export function createReachingThumbPose(target: Point): (point: Point) => Point {
  const tx = target.x - THUMB_ROOT.x;
  const ty = target.y - THUMB_ROOT.y;
  const distance = Math.hypot(tx, ty);
  const direction = distance > .001 ? { x: tx / distance, y: ty / distance } : axis;
  // Screen Y decreases upward: reverse as soon as the target rises above the rest tip.
  // A fixed-length finger cannot both cap its bend and reach every nearby target;
  // the grip translates to make up that difference, just as for distant targets.
  const rise = THUMB_TIP.y - target.y;
  const reverseMix = smooth(rise / (length * Math.sin(THUMB_REVERSE_LIMIT_DEGREES * Math.PI / 180)));
  const first = length * .55, second = length * .45;
  const reach = Math.max(Math.abs(first - second) + .01, Math.min(distance, length));
  const forwardBend = Math.acos(Math.max(-1, Math.min(1, (reach * reach - first * first - second * second) / (2 * first * second))));
  // Ease out forward flexion just below the boundary, avoiding a side-switch snap.
  const bendAngle = rise > 0 ? -THUMB_REVERSE_LIMIT_DEGREES * Math.PI / 180 * reverseMix
    : forwardBend * smooth(-rise / 20);
  const localPose = createThumbPose(target, bendAngle);
  const localTip = localPose(THUMB_TIP);
  const localReach = Math.hypot(localTip.x - THUMB_ROOT.x, localTip.y - THUMB_ROOT.y);
  const excess = Math.max(0, distance - length);
  // Most extra reach comes from translating the palm; the texture only stretches slightly as a whole.
  const extension = Math.min(localReach * .04, excess * .2);
  const travel = distance - localReach - extension;
  return (point) => {
    const posed = localPose(point);
    const along = (posed.x - THUMB_ROOT.x) * direction.x + (posed.y - THUMB_ROOT.y) * direction.y;
    const shift = travel + along * extension / localReach;
    return { x: posed.x + direction.x * shift, y: posed.y + direction.y * shift };
  };
}

/** Fixed-length thumb joints connected to a stationary palm. Source units are 1024 × 1536. */
export function createThumbPose(target: Point, bendAngle?: number): (point: Point) => Point {
  const tx = target.x - THUMB_ROOT.x;
  const ty = target.y - THUMB_ROOT.y;
  const distance = Math.hypot(tx, ty);
  const direction = distance > .001 ? { x: tx / distance, y: ty / distance } : axis;
  const reach = Math.min(distance, length);
  // Neither segment scales: the proximal segment stays attached to the palm.
  // Unreachable targets only change direction once the joints are straight.
  const second = length * .45;
  const first = length * .55;
  const angle = bendAngle === undefined ? undefined : Math.max(-THUMB_REVERSE_LIMIT_DEGREES * Math.PI / 180, Math.min(Math.PI, bendAngle));
  const d = angle === undefined ? Math.max(Math.abs(first - second) + .01, reach)
    : Math.sqrt(first * first + second * second + 2 * first * second * Math.cos(angle));
  const along = (first * first - second * second + d * d) / (2 * d);
  const bend = Math.sqrt(Math.max(0, first * first - along * along)) * (angle !== undefined && angle < 0 ? -1 : 1);
  const joint = {
    x: THUMB_ROOT.x + direction.x * along - direction.y * bend,
    y: THUMB_ROOT.y + direction.y * along + direction.x * bend,
  };
  const tip = { x: THUMB_ROOT.x + direction.x * d, y: THUMB_ROOT.y + direction.y * d };
  const firstAxis = { x: (joint.x - THUMB_ROOT.x) / first, y: (joint.y - THUMB_ROOT.y) / first };
  const secondAxis = { x: (tip.x - joint.x) / second, y: (tip.y - joint.y) / second };
  return (point) => {
    const rx = point.x - THUMB_ROOT.x;
    const ry = point.y - THUMB_ROOT.y;
    const t = (rx * axis.x + ry * axis.y) / length;
    const side = rx * normal.x + ry * normal.y;
    if (t <= 0) return { ...point };
    const proximal = {
      x: THUMB_ROOT.x + firstAxis.x * t * length - firstAxis.y * side,
      y: THUMB_ROOT.y + firstAxis.y * t * length + firstAxis.x * side,
    };
    const distal = {
      x: joint.x + secondAxis.x * (t - .55) * length - secondAxis.y * side,
      y: joint.y + secondAxis.y * (t - .55) * length + secondAxis.x * side,
    };
    const jointWeight = smooth((t - .43) / .24);
    const influence = smooth(t / .24) * (1 - smooth((Math.abs(side) - 125) / 85));
    return {
      x: point.x + ((proximal.x * (1 - jointWeight) + distal.x * jointWeight) - point.x) * influence,
      y: point.y + ((proximal.y * (1 - jointWeight) + distal.y * jointWeight) - point.y) * influence,
    };
  };
}
