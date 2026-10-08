// Inspired by Krita's pop-up palette & color triangle wheel
import { useCallback, useEffect, useRef, useState } from "react";

export type HSV = {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
};

export function hexToRgb(hex: string): [number, number, number] {
  let cleaned = hex.trim().replace(/^#/, "");
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (cleaned.length !== 6) return [30, 30, 30];
  const num = parseInt(cleaned, 16);
  if (Number.isNaN(num)) return [30, 30, 30];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, v };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hh >= 0 && hh < 1) {
    r = c;
    g = x;
  } else if (hh >= 1 && hh < 2) {
    r = x;
    g = c;
  } else if (hh >= 2 && hh < 3) {
    g = c;
    b = x;
  } else if (hh >= 3 && hh < 4) {
    g = x;
    b = c;
  } else if (hh >= 4 && hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hexToHsv(hex: string): HSV {
  if (hex === "transparent") return { h: 0, s: 0, v: 0 };
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

type Point = { x: number; y: number };

function getTriangleVertices(cx: number, cy: number, radius: number, hueDeg: number) {
  const rad = (hueDeg * Math.PI) / 180;
  // Pure hue vertex points towards hue angle
  const pPure: Point = {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
  // White vertex at angle + 120 deg
  const pWhite: Point = {
    x: cx + radius * Math.cos(rad + (2 * Math.PI) / 3),
    y: cy + radius * Math.sin(rad + (2 * Math.PI) / 3),
  };
  // Black vertex at angle - 120 deg (or + 240 deg)
  const pBlack: Point = {
    x: cx + radius * Math.cos(rad - (2 * Math.PI) / 3),
    y: cy + radius * Math.sin(rad - (2 * Math.PI) / 3),
  };
  return { pPure, pWhite, pBlack };
}

// Compute barycentric coordinates of point P relative to triangle A, B, C
function barycentric(p: Point, a: Point, b: Point, c: Point): [number, number, number] {
  const v0 = { x: b.x - a.x, y: b.y - a.y };
  const v1 = { x: c.x - a.x, y: c.y - a.y };
  const v2 = { x: p.x - a.x, y: p.y - a.y };
  const d00 = v0.x * v0.x + v0.y * v0.y;
  const d01 = v0.x * v1.x + v0.y * v1.y;
  const d11 = v1.x * v1.x + v1.y * v1.y;
  const d20 = v2.x * v0.x + v2.y * v0.y;
  const d21 = v2.x * v1.x + v2.y * v1.y;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-6) return [1 / 3, 1 / 3, 1 / 3];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1.0 - v - w;
  return [u, v, w]; // [weightA (pure), weightB (white), weightC (black)]
}

// Project arbitrary barycentric weights into the valid triangle simplex
function clampBarycentric(wPure: number, wWhite: number, wBlack: number): [number, number, number] {
  let u = Math.max(0, wPure);
  let v = Math.max(0, wWhite);
  let w = Math.max(0, wBlack);
  const sum = u + v + w;
  if (sum < 1e-6) return [0, 0, 1]; // default black
  return [u / sum, v / sum, w / sum];
}

type RadialColorWheelProps = {
  color: string;
  size?: number;
  onChange: (hex: string) => void;
};

export function RadialColorWheel({ color, size = 116, onChange }: RadialColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color));
  const activeDragRef = useRef<"hue" | "triangle" | null>(null);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  // Sync external color when it changes
  useEffect(() => {
    if (color === "transparent") return;
    const next = hexToHsv(color);
    setHsv((prev) => {
      // Keep hue stable when saturation/value is near zero
      if (next.s < 0.02 || next.v < 0.02) return { ...next, h: prev.h };
      return next;
    });
  }, [color]);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = size / 2 - 14;
  const rTri = rInner - 3;

  // Render the color wheel & rotated triangle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    // 1. Draw Outer Hue Ring
    const ringThickness = rOuter - rInner;
    const rMid = (rOuter + rInner) / 2;
    ctx.save();
    const segments = 180;
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1.2) / segments) * Math.PI * 2;
      const midAngleDeg = ((i + 0.5) / segments) * 360;
      ctx.beginPath();
      ctx.arc(cx, cy, rMid, a1, a2);
      ctx.strokeStyle = `hsl(${midAngleDeg}, 100%, 50%)`;
      ctx.lineWidth = ringThickness;
      ctx.stroke();
    }
    ctx.restore();

    // Hue ring borders
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. Draw Hue Indicator
    const hueRad = (hsv.h * Math.PI) / 180;
    const indX = cx + rMid * Math.cos(hueRad);
    const indY = cy + rMid * Math.sin(hueRad);
    ctx.save();
    ctx.translate(indX, indY);
    ctx.rotate(hueRad);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-3, -ringThickness / 2 + 1, 6, ringThickness - 2, 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Draw Rotated Color Triangle
    const { pPure, pWhite, pBlack } = getTriangleVertices(cx, cy, rTri, hsv.h);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pPure.x, pPure.y);
    ctx.lineTo(pWhite.x, pWhite.y);
    ctx.lineTo(pBlack.x, pBlack.y);
    ctx.closePath();
    ctx.clip();

    // Draw triangle gradient
    // Layer A: Base pure hue color
    ctx.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
    ctx.fillRect(0, 0, size, size);

    // Layer B: White gradient from pWhite
    const gradWhite = ctx.createLinearGradient(
      pWhite.x,
      pWhite.y,
      (pPure.x + pBlack.x) / 2,
      (pPure.y + pBlack.y) / 2,
    );
    gradWhite.addColorStop(0, "rgba(255,255,255,1)");
    gradWhite.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradWhite;
    ctx.fillRect(0, 0, size, size);

    // Layer C: Black gradient from pBlack
    const gradBlack = ctx.createLinearGradient(
      pBlack.x,
      pBlack.y,
      (pPure.x + pWhite.x) / 2,
      (pPure.y + pWhite.y) / 2,
    );
    gradBlack.addColorStop(0, "rgba(0,0,0,1)");
    gradBlack.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradBlack;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // Triangle outline
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pPure.x, pPure.y);
    ctx.lineTo(pWhite.x, pWhite.y);
    ctx.lineTo(pBlack.x, pBlack.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 4. Draw Current SV Cursor inside the Triangle
    const wBlack = 1 - hsv.v;
    const wPure = hsv.s * hsv.v;
    const wWhite = hsv.v * (1 - hsv.s);
    const curX = wPure * pPure.x + wWhite * pWhite.x + wBlack * pBlack.x;
    const curY = wPure * pPure.y + wWhite * pWhite.y + wBlack * pBlack.y;

    ctx.save();
    ctx.beginPath();
    ctx.arc(curX, curY, 4, 0, Math.PI * 2);
    ctx.fillStyle = hsvToHex(hsv.h, hsv.s, hsv.v);
    ctx.strokeStyle = hsv.v > 0.6 && hsv.s < 0.5 ? "#000000" : "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [cx, cy, hsv, rInner, rOuter, rTri, size]);

  const updateFromPosition = useCallback(
    (clientX: number, clientY: number, mode: "hue" | "triangle") => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const dx = px - cx;
      const dy = py - cy;

      if (mode === "hue") {
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angleDeg < 0) angleDeg += 360;
        const next: HSV = { ...hsvRef.current, h: angleDeg };
        setHsv(next);
        onChange(hsvToHex(next.h, next.s, next.v));
      } else {
        const { pPure, pWhite, pBlack } = getTriangleVertices(cx, cy, rTri, hsvRef.current.h);
        const [wP, wW, wB] = barycentric({ x: px, y: py }, pPure, pWhite, pBlack);
        const [cwP, cwW, cwB] = clampBarycentric(wP, wW, wB);
        // Compute S, V from clamped barycentric weights
        const v = 1 - cwB;
        const s = v <= 1e-4 ? 0 : Math.min(1, cwP / v);
        const next: HSV = { h: hsvRef.current.h, s, v };
        setHsv(next);
        onChange(hsvToHex(next.h, next.s, next.v));
      }
    },
    [cx, cy, onChange, rTri],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const dist = Math.hypot(px - cx, py - cy);

    let mode: "hue" | "triangle";
    if (dist >= rInner - 2) {
      mode = "hue";
    } else {
      mode = "triangle";
    }

    activeDragRef.current = mode;
    canvas.setPointerCapture(event.pointerId);
    updateFromPosition(event.clientX, event.clientY, mode);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    updateFromPosition(event.clientX, event.clientY, activeDragRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeDragRef.current) {
      activeDragRef.current = null;
      try {
        canvasRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        // pointer may already be released
      }
    }
  };

  return (
    <div className="radial-color-wheel-wrapper" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        className="radial-color-wheel-canvas"
        style={{ width: size, height: size, cursor: "crosshair", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
