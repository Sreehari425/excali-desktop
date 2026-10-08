import type { AppState, LibraryItems, ToolType } from "@excalidraw/excalidraw/types";
import {
  DEFAULT_RADIAL_WHEEL_PREFERENCES,
  type RadialWheelPreferences,
} from "./radialWheelDefaults";

export const editorSettingsFile = "editor-settings.json";
export const lastSessionFile = "last-session.excalidraw";
export const recentFileLimit = 10;

export type HostPreferences = {
  radialWheel: RadialWheelPreferences;
};

export interface PersistedEditorSettings {
  version: 1;
  appState: Partial<AppState>;
  libraryItems: LibraryItems;
  recentFiles: string[];
  hostPreferences?: HostPreferences;
}

export function addRecentFile(path: string, recentFiles: readonly string[]): string[] {
  return [path, ...recentFiles.filter((recentPath) => recentPath !== path)].slice(0, recentFileLimit);
}

// Keep this aligned with Excalidraw's browser-persisted AppState fields. The
// embed API exposes those fields through onChange/initialData but leaves their
// storage to the host application.
const persistedAppStateKeys = [
  "showWelcomeScreen",
  "theme",
  "currentItemBackgroundColor",
  "currentItemEndArrowhead",
  "currentItemFillStyle",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemRoundness",
  "currentItemArrowType",
  "currentItemOpacity",
  "currentItemRoughness",
  "currentItemStrokeVariability",
  "currentItemStartArrowhead",
  "currentItemStrokeColor",
  "currentItemStickynoteStrokeColor",
  "currentItemStickynoteBackgroundColor",
  "currentItemStrokeStyle",
  "currentItemStrokeWidthKey",
  "currentItemTextAlign",
  "cursorButton",
  "editingGroupId",
  "activeTool",
  "preferredSelectionTool",
  "penMode",
  "penDetected",
  "exportBackground",
  "exportEmbedScene",
  "exportScale",
  "exportWithDarkMode",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "isBindingEnabled",
  "boxSelectionMode",
  "bindingPreference",
  "isMidpointSnappingEnabled",
  "showHints",
  "inputDevice",
  "defaultSidebarDockedPreference",
  "lastPointerDownWith",
  "name",
  "openMenu",
  "openSidebar",
  "previousSelectedElementIds",
  "scrolledOutside",
  "scrollX",
  "scrollY",
  "selectedElementIds",
  "selectedGroupIds",
  "shouldCacheIgnoreZoom",
  "stats",
  "viewBackgroundColor",
  "zenModeEnabled",
  "zoom",
  "selectedLinearElement",
  "objectsSnapModeEnabled",
  "lockedMultiSelections",
  "bindMode",
  "colorTopPicks",
  "fontTopPicks",
] as const satisfies readonly (keyof AppState)[];

const KNOWN_RADIAL_TOOLS = new Set<ToolType>(DEFAULT_RADIAL_WHEEL_PREFERENCES.slots);

export function pickPersistedAppState(appState: Partial<AppState>): Partial<AppState> {
  const persisted: Partial<AppState> = {};
  for (const key of persistedAppStateKeys) {
    // `undefined` values are omitted by JSON serialization; keeping them out
    // also makes the persisted object easier to inspect and migrate.
    const value = appState[key];
    if (value !== undefined) {
      Object.assign(persisted, { [key]: value });
    }
  }
  return persisted;
}

function parseRadialWheelPreferences(raw: unknown): RadialWheelPreferences {
  const defaults = DEFAULT_RADIAL_WHEEL_PREFERENCES;
  if (typeof raw !== "object" || raw === null) return { ...defaults, slots: [...defaults.slots] };

  const source = raw as Record<string, unknown>;
  const enabled = typeof source.enabled === "boolean" ? source.enabled : defaults.enabled;
  const pointerButton =
    typeof source.pointerButton === "number" && Number.isFinite(source.pointerButton)
      ? Math.trunc(source.pointerButton)
      : defaults.pointerButton;
  let keyboardHoldKey: string | null = defaults.keyboardHoldKey;
  if (source.keyboardHoldKey === null) keyboardHoldKey = null;
  else if (typeof source.keyboardHoldKey === "string" && source.keyboardHoldKey.length > 0) {
    keyboardHoldKey = source.keyboardHoldKey;
  }

  let slots = [...defaults.slots];
  if (Array.isArray(source.slots)) {
    const parsed: ToolType[] = [];
    for (const entry of source.slots) {
      if (typeof entry === "string" && KNOWN_RADIAL_TOOLS.has(entry as ToolType)) {
        const tool = entry as ToolType;
        if (!parsed.includes(tool)) parsed.push(tool);
      }
      if (parsed.length === 12) break;
    }
    if (parsed.length > 0) slots = parsed;
  }

  return { enabled, pointerButton, keyboardHoldKey, slots };
}

export function parseHostPreferences(raw: unknown): HostPreferences {
  if (typeof raw !== "object" || raw === null) {
    return {
      radialWheel: {
        ...DEFAULT_RADIAL_WHEEL_PREFERENCES,
        slots: [...DEFAULT_RADIAL_WHEEL_PREFERENCES.slots],
      },
    };
  }
  const source = raw as Record<string, unknown>;
  return {
    radialWheel: parseRadialWheelPreferences(source.radialWheel),
  };
}

export function parsePersistedEditorSettings(source: string): PersistedEditorSettings {
  const parsed: unknown = JSON.parse(source);
  if (
    typeof parsed !== "object" || parsed === null ||
    !("version" in parsed) || parsed.version !== 1 ||
    !("appState" in parsed) || typeof parsed.appState !== "object" || parsed.appState === null ||
    !("libraryItems" in parsed) || !Array.isArray(parsed.libraryItems)
  ) {
    throw new Error("Unsupported or malformed editor settings");
  }

  const recentFiles: string[] = [];
  if ("recentFiles" in parsed && Array.isArray(parsed.recentFiles)) {
    for (const path of parsed.recentFiles) {
      if (typeof path === "string" && path.length > 0 && !recentFiles.includes(path)) {
        recentFiles.push(path);
        if (recentFiles.length === recentFileLimit) break;
      }
    }
  }

  const hostPreferences =
    "hostPreferences" in parsed
      ? parseHostPreferences(parsed.hostPreferences)
      : parseHostPreferences(undefined);

  return {
    version: 1,
    appState: pickPersistedAppState(parsed.appState as Partial<AppState>),
    libraryItems: parsed.libraryItems as LibraryItems,
    recentFiles,
    hostPreferences,
  };
}
