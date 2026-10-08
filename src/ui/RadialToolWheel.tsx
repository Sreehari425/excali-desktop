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
  theme?: "light" | "dark";
  slots: readonly RadialWheelSlot[];
  activeTool: ToolType | null;
  strokeColor: string;
  fillColor: string;
  colorTarget: ColorTarget;
  colorPicks: readonly string[];
  zoom: number;
  onSelectTool: (type: ToolType) => void;
  onSelectColor: (color: string, autoDismiss?: boolean) => void;
  onSetColorTarget: (target: ColorTarget) => void;
  onSetZoom: (zoom: number) => void;
  onResetZoom: () => void;
  onFitContent: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
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
  theme,
  slots,
  activeTool,
  strokeColor,
  fillColor,
  colorTarget,
  colorPicks,
  zoom,
  onSelectTool,
  onSelectColor,
  onSetColorTarget,
  onSetZoom,
  onResetZoom,
  onFitContent,
  onDeleteSelected,
  onUndo,
  onRedo,
  onDismiss,
}: RadialToolWheelProps) {
  if (!open) return null;

  const cx = RADIAL_WHEEL_SIZE / 2;
  const cy = RADIAL_WHEEL_SIZE / 2;
  const count = slots.length;
  const picks = (colorPicks.length ? colorPicks : FALLBACK_COLOR_PICKS).slice(0, 7);
  const currentColor = colorTarget === "stroke" ? strokeColor : fillColor;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="radial-wheel-layer" role="presentation">
      <button
        type="button"
        className="radial-wheel-backdrop"
        aria-label="Dismiss tool wheel"
        onClick={onDismiss}
      />
      <div
        className={`radial-wheel-container is-${theme ?? "dark"}`}
        style={{
          left: x - RADIAL_WHEEL_SIZE / 2,
          top: y - RADIAL_WHEEL_SIZE / 2,
          width: RADIAL_WHEEL_SIZE,
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className="radial-wheel"
          role="menu"
          aria-label="Tool wheel"
          style={{
            width: RADIAL_WHEEL_SIZE,
            height: RADIAL_WHEEL_SIZE,
          }}
        >
          {/* Krita-style top-left overlapping color target ears (Stroke & Fill) - underlapping the wheel ring */}
          <div className="radial-wheel-target-ears" role="group" aria-label="Color targets">
            <button
              type="button"
              className={`radial-wheel-ear-btn is-fill${colorTarget === "fill" ? " is-active" : ""}`}
              style={swatchStyle(fillColor)}
              onClick={() => onSetColorTarget("fill")}
              title="Fill color (Background)"
              aria-label="Set fill color target"
            />
            <button
              type="button"
              className={`radial-wheel-ear-btn is-stroke${colorTarget === "stroke" ? " is-active" : ""}`}
              style={swatchStyle(strokeColor)}
              onClick={() => onSetColorTarget("stroke")}
              title="Stroke color (Foreground)"
              aria-label="Set stroke color target"
            />
          </div>

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

          {/* Central hub with only the color wheel */}
          <div className="radial-wheel-hub-content">
            <RadialColorWheel
              color={currentColor}
              size={124}
              onChange={(hex) => onSelectColor(hex, false)}
            />
          </div>
        </div>

        {/* Color picks dock */}
        <div className="radial-wheel-quick-picks" role="toolbar" aria-label="Favorite colors">
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

        {/* Krita-inspired floating bottom quick-bar */}
        <div className="radial-wheel-quickbar" role="toolbar" aria-label="Quick canvas actions">
          <button
            type="button"
            className="radial-wheel-quickbar-btn"
            title="Fit content to view"
            aria-label="Fit content to view"
            onClick={onFitContent}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>

          <button
            type="button"
            className="radial-wheel-quickbar-btn"
            title="Delete selection (Del)"
            aria-label="Delete selection"
            onClick={onDeleteSelected}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
            </svg>
          </button>

          <div className="radial-wheel-quickbar-divider" />

          <button
            type="button"
            className="radial-wheel-quickbar-btn"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            onClick={onUndo}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 14 4 9 9 4" />
              <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
            </svg>
          </button>

          <button
            type="button"
            className="radial-wheel-quickbar-btn"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            onClick={onRedo}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 14 20 9 15 4" />
              <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
            </svg>
          </button>

          <div className="radial-wheel-quickbar-divider" />

          <div className="radial-wheel-quickbar-slider-wrap" title={`Zoom: ${zoomPercent}%`}>
            <input
              type="range"
              min="10"
              max="400"
              step="5"
              value={zoomPercent}
              className="radial-wheel-quickbar-slider"
              onChange={(event) => onSetZoom(Number(event.target.value) / 100)}
              aria-label="Canvas zoom"
            />
          </div>

          <button
            type="button"
            className="radial-wheel-quickbar-zoom-btn"
            title="Click to reset zoom to 100%"
            aria-label="Reset zoom to 100%"
            onClick={onResetZoom}
          >
            {zoomPercent}%
          </button>
        </div>
      </div>
    </div>
  );
}
