import type { ToolType } from "@excalidraw/excalidraw/types";

export type RadialWheelSlot = {
  type: ToolType;
  label: string;
  shortcut: string;
};

export type RadialWheelPreferences = {
  enabled: boolean;
  pointerButton: number;
  keyboardHoldKey: string | null;
  slots: ToolType[];
};

export const DEFAULT_RADIAL_SLOTS = [
  "selection",
  "hand",
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "eraser",
  "stickynote",
  "laser",
] as const satisfies readonly ToolType[];

export type RadialDefaultTool = (typeof DEFAULT_RADIAL_SLOTS)[number];

export const RADIAL_SLOT_META: Record<RadialDefaultTool, Omit<RadialWheelSlot, "type">> = {
  selection: { label: "Selection", shortcut: "V" },
  hand: { label: "Hand", shortcut: "H" },
  rectangle: { label: "Rectangle", shortcut: "R" },
  diamond: { label: "Diamond", shortcut: "D" },
  ellipse: { label: "Ellipse", shortcut: "O" },
  arrow: { label: "Arrow", shortcut: "A" },
  line: { label: "Line", shortcut: "L" },
  freedraw: { label: "Draw", shortcut: "P" },
  text: { label: "Text", shortcut: "T" },
  eraser: { label: "Eraser", shortcut: "E" },
  stickynote: { label: "Sticky note", shortcut: "N" },
  laser: { label: "Laser", shortcut: "K" },
};

export const DEFAULT_RADIAL_WHEEL_PREFERENCES: RadialWheelPreferences = {
  enabled: true,
  pointerButton: 2,
  keyboardHoldKey: "`",
  slots: [...DEFAULT_RADIAL_SLOTS] as ToolType[],
};

export const RADIAL_WHEEL_OUTER_RADIUS = 168;
export const RADIAL_WHEEL_INNER_RADIUS = 78;
export const RADIAL_WHEEL_HUB_RADIUS = 72;
export const RADIAL_WHEEL_SIZE = RADIAL_WHEEL_OUTER_RADIUS * 2 + 24;

export const FALLBACK_COLOR_PICKS = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#ffffff",
  "transparent",
] as const;

export function resolveRadialSlots(slots: readonly ToolType[]): RadialWheelSlot[] {
  return slots
    .filter((type): type is RadialDefaultTool => type in RADIAL_SLOT_META)
    .slice(0, 12)
    .map((type) => ({ type, ...RADIAL_SLOT_META[type] }));
}
