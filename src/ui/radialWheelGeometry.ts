import {
  RADIAL_WHEEL_HUB_RADIUS,
  RADIAL_WHEEL_INNER_RADIUS,
  RADIAL_WHEEL_OUTER_RADIUS,
  RADIAL_WHEEL_SIZE,
} from "./radialWheelDefaults";

export type RadialHit =
  | { kind: "tool"; index: number }
  | { kind: "hub" }
  | { kind: "none" };

/** Angle for sector `i` of `count`, measured clockwise from top (-90°). */
export function sectorAngles(index: number, count: number): { start: number; end: number; mid: number } {
  const sweep = (Math.PI * 2) / Math.max(count, 1);
  const start = -Math.PI / 2 + index * sweep;
  const end = start + sweep;
  return { start, end, mid: start + sweep / 2 };
}

export function polarFromClient(
  clientX: number,
  clientY: number,
  centerX: number,
  centerY: number,
): { angle: number; radius: number } {
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  // atan2 returns -π..π with 0 at +X; convert so 0 is at top, clockwise.
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  return { angle, radius: Math.hypot(dx, dy) };
}

export function hitTestRadial(
  clientX: number,
  clientY: number,
  centerX: number,
  centerY: number,
  slotCount: number,
): RadialHit {
  const { angle, radius } = polarFromClient(clientX, clientY, centerX, centerY);

  if (radius <= RADIAL_WHEEL_HUB_RADIUS) {
    return { kind: "hub" };
  }

  if (radius < RADIAL_WHEEL_INNER_RADIUS || radius > RADIAL_WHEEL_OUTER_RADIUS + 8) {
    return { kind: "none" };
  }

  if (slotCount <= 0) return { kind: "none" };

  const sweep = (Math.PI * 2) / slotCount;
  const index = Math.min(slotCount - 1, Math.floor(angle / sweep));
  return { kind: "tool", index };
}

export function clampWheelPosition(
  clientX: number,
  clientY: number,
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 720,
): { x: number; y: number } {
  const half = RADIAL_WHEEL_SIZE / 2;
  const margin = 8;
  return {
    x: Math.min(viewportWidth - half - margin, Math.max(half + margin, clientX)),
    y: Math.min(viewportHeight - half - margin, Math.max(half + margin, clientY)),
  };
}

export function describeArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const toPoint = (r: number, a: number) => ({
    x: cx + Math.cos(a) * r,
    y: cy + Math.sin(a) * r,
  });

  const outerStart = toPoint(outerR, startAngle);
  const outerEnd = toPoint(outerR, endAngle);
  const innerEnd = toPoint(innerR, endAngle);
  const innerStart = toPoint(innerR, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export function iconPosition(index: number, count: number, cx: number, cy: number) {
  const { mid } = sectorAngles(index, count);
  const r = (RADIAL_WHEEL_INNER_RADIUS + RADIAL_WHEEL_OUTER_RADIUS) / 2;
  return {
    x: cx + Math.cos(mid) * r,
    y: cy + Math.sin(mid) * r,
  };
}
