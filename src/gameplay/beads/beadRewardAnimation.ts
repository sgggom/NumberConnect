export interface BeadClusterPose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface BeadRewardTiming {
  stagger: number;
  flightDuration: number;
  settleDuration: number;
}

const noise = (value: number): number => {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
};

export const beadClusterPose = (index: number, total: number): BeadClusterPose => {
  const safeIndex = Math.max(0, Math.floor(index));
  const safeTotal = Math.max(1, Math.floor(total));
  const seed = safeIndex + safeTotal * 0.173;
  const maxDistance = Math.min(64, 30 + safeTotal * 1.05);
  const distance = maxDistance * (0.08 + Math.sqrt(noise(seed * 1.91 + 3.7)) * 0.92);
  const angle = noise(seed * 2.47 + 11.3) * Math.PI * 2;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance * 0.74,
    rotation: noise(seed * 3.17 + 19.1) * 104 - 52,
    scale: 0.58 + noise(seed * 4.03 + 29.7) * 0.24,
  };
};

export const beadRewardTiming = (total: number, reducedMotion = false): BeadRewardTiming => {
  if (reducedMotion) return { stagger: 0, flightDuration: 1, settleDuration: 1 };
  const safeTotal = Math.max(1, Math.floor(total));
  return {
    stagger: Math.max(44, Math.min(76, Math.round(2040 / safeTotal))),
    flightDuration: 560,
    settleDuration: 360,
  };
};
