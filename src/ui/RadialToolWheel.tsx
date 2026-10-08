import type { CSSProperties } from "react";
import type { ToolType } from "@excalidraw/excalidraw/types";
import { RadialToolIcon } from "./radialToolIcons";
import { RadialColorWheel } from "./RadialColorWheel";
import {
  FALLBACK_COLOR_PICKS,
  RADIAL_WHEEL_HUB_RADIUS,
  RADIAL_WHEEL_INNER_RADIUS,
  RADIAL_WHEEL_OUTER_RADIUS,
  RADIAL_WHEEL_SIZE,
  type RadialWheelSlot,
} from "./radialWheelDefaults";
import { describeArc, iconPosition, sectorAngles } from "./radialWheelGeometry";

export type ColorTarget = "stroke" | "fill";

type RadialToolWheelProps = {
  open: boolean;
  x: number;
  y: number;
  slots: readonly RadialWheelSlot[];
  activeTool: ToolType | null;
  strokeColor: string;
  fillColor: string;
  colorTarget: ColorTarget;
  colorPicks: readonly string[];
  onSelectTool: (type: ToolType) => void;
  onSelectColor: (color: string, autoDismiss?: boolean) => void;
  onSetColorTarget: (target: ColorTarget) => void;
  onDismiss: () => void;
};

function swatchStyle(color: string): CSSProperties {
  if (color === "transparent") {
    return {
      background:
        "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
      backgroundSize: "8px 8px",
      backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
      backgroundColor: "#fff",
    };
  }
  return { backgroundColor: color };
}

export function RadialToolWheel({
  open,
  x,
  y,
  slots,
  activeTool,
  strokeColor,
  fillColor,
  colorTarget,
  colorPicks,
  onSelectTool,
  onSelectColor,
  onSetColorTarget,
  onDismiss,
}: RadialToolWheelProps) {
  if (!open) return null;

  const cx = RADIAL_WHEEL_SIZE / 2;
  const cy = RADIAL_WHEEL_SIZE / 2;
  const count = slots.length;
  const picks = (colorPicks.length ? colorPicks : FALLBACK_COLOR_PICKS).slice(0, 7);
  const currentColor = colorTarget === "stroke" ? strokeColor : fillColor;

  return (
    <div className="radial-wheel-layer" role="presentation">
      <button
        type="button"
        className="radial-wheel-backdrop"
        aria-label="Dismiss tool wheel"
        onClick={onDismiss}
      />
      <div
        className="radial-wheel"
        role="menu"
        aria-label="Tool wheel"
        style={{
          width: RADIAL_WHEEL_SIZE,
          height: RADIAL_WHEEL_SIZE,
          left: x - RADIAL_WHEEL_SIZE / 2,
          top: y - RADIAL_WHEEL_SIZE / 2,
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <svg
          className="radial-wheel-ring"
          width={RADIAL_WHEEL_SIZE}
          height={RADIAL_WHEEL_SIZE}
          viewBox={`0 0 ${RADIAL_WHEEL_SIZE} ${RADIAL_WHEEL_SIZE}`}
        >
          <circle
            className="radial-wheel-frame"
            cx={cx}
            cy={cy}
            r={RADIAL_WHEEL_OUTER_RADIUS}
          />
          {slots.map((slot, index) => {
            const { start, end } = sectorAngles(index, count);
            const active = slot.type === activeTool;
            return (
              <path
                key={`sector-${slot.type}`}
                className={`radial-wheel-sector${active ? " is-active" : ""}`}
                d={describeArc(
                  cx,
                  cy,
                  RADIAL_WHEEL_INNER_RADIUS,
                  RADIAL_WHEEL_OUTER_RADIUS,
                  start,
                  end,
                )}
              />
            );
          })}
          <circle
            className="radial-wheel-hub"
            cx={cx}
            cy={cy}
            r={RADIAL_WHEEL_HUB_RADIUS}
          />
        </svg>

        {slots.map((slot, index) => {
          const pos = iconPosition(index, count, cx, cy);
          const active = slot.type === activeTool;
          return (
            <button
              key={`slot-${slot.type}`}
              type="button"
              role="menuitem"
              className={`radial-wheel-slot${active ? " is-active" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              title={`${slot.label} (${slot.shortcut})`}
              onClick={() => onSelectTool(slot.type)}
            >
              <RadialToolIcon type={slot.type} />
              <span className="radial-wheel-shortcut">{slot.shortcut}</span>
            </button>
          );
        })}

        <div className="radial-wheel-hub-content">
          <div className="radial-wheel-target-toggle">
            <button
              type="button"
              className={`radial-wheel-target-btn${colorTarget === "stroke" ? " is-active" : ""}`}
              onClick={() => onSetColorTarget("stroke")}
              title="Stroke color"
            >
              <span className="radial-wheel-swatch-dot" style={swatchStyle(strokeColor)} />
              <span>Stroke</span>
            </button>
            <button
              type="button"
              className={`radial-wheel-target-btn${colorTarget === "fill" ? " is-active" : ""}`}
              onClick={() => onSetColorTarget("fill")}
              title="Fill color"
            >
              <span className="radial-wheel-swatch-dot" style={swatchStyle(fillColor)} />
              <span>Fill</span>
            </button>
          </div>

          <RadialColorWheel
            color={currentColor}
            size={120}
            onChange={(hex) => onSelectColor(hex, false)}
          />

          <div className="radial-wheel-quick-picks">
            {picks.map((color, index) => (
              <button
                key={`${color}-${index}`}
                type="button"
                className="radial-wheel-pick"
                style={swatchStyle(color)}
                title={color}
                aria-label={`Use color ${color}`}
                onClick={() => onSelectColor(color, false)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
