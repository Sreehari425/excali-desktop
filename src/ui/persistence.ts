import type { AppState, LibraryItems } from "@excalidraw/excalidraw/types";

export const editorSettingsFile = "editor-settings.json";
export const lastSessionFile = "last-session.excalidraw";

export interface PersistedEditorSettings {
  version: 1;
  appState: Partial<AppState>;
  libraryItems: LibraryItems;
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

  return {
    version: 1,
    appState: pickPersistedAppState(parsed.appState as Partial<AppState>),
    libraryItems: parsed.libraryItems as LibraryItems,
  };
}
