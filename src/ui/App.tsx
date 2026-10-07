import { useCallback, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  editorSettingsFile,
  lastSessionFile,
  parsePersistedEditorSettings,
  pickPersistedAppState,
} from "./persistence";

const drawingFilter = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

export default function App() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const filePath = useRef<string | null>(null);
  const [fileName, setFileName] = useState("Untitled");
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<AppState["theme"]>("light");
  const persistenceReadyRef = useRef(false);
  const appStateRef = useRef<Partial<AppState>>({});
  const libraryItemsRef = useRef<LibraryItems>([]);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const scheduleSettingsSave = useCallback(() => {
    if (!persistenceReadyRef.current) return;
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);

    settingsSaveTimerRef.current = setTimeout(() => {
      const snapshot = {
        version: 1 as const,
        appState: appStateRef.current,
        libraryItems: libraryItemsRef.current,
      };
      const serialized = JSON.stringify(snapshot);
      settingsSaveQueueRef.current = settingsSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
          await writeTextFile(editorSettingsFile, serialized, {
            baseDir: BaseDirectory.AppLocalData,
          });
        })
        .catch((error: unknown) => {
          setMessage(`Could not save editor settings: ${String(error)}`);
        });
    }, 400);
  }, []);

  const scheduleSessionSave = useCallback(() => {
    if (!persistenceReadyRef.current) return;
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);

    sessionSaveTimerRef.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const serialized = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      sessionSaveQueueRef.current = sessionSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
          await writeTextFile(lastSessionFile, serialized, {
            baseDir: BaseDirectory.AppLocalData,
          });
        })
        .catch((error: unknown) => {
          setMessage(`Could not autosave drawing: ${String(error)}`);
        });
    }, 400);
  }, []);

  const loadEditorSettings = useCallback(async (): Promise<ExcalidrawInitialDataState> => {
    let initialData: ExcalidrawInitialDataState = {};
    try {
      await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      if (await exists(editorSettingsFile, { baseDir: BaseDirectory.AppLocalData })) {
        const source = await readTextFile(editorSettingsFile, {
          baseDir: BaseDirectory.AppLocalData,
        });
        const settings = parsePersistedEditorSettings(source);
        appStateRef.current = settings.appState;
        libraryItemsRef.current = settings.libraryItems;
        if (settings.appState.theme === "light" || settings.appState.theme === "dark") {
          setTheme(settings.appState.theme);
        }
      }
    } catch (error) {
      // A missing or invalid settings file should never prevent the editor
      // from opening; the next preference change will write a fresh file.
      appStateRef.current = {};
      libraryItemsRef.current = [];
      setMessage(`Could not load saved editor settings: ${String(error)}`);
    }

    try {
      if (await exists(lastSessionFile, { baseDir: BaseDirectory.AppLocalData })) {
        const source = await readTextFile(lastSessionFile, {
          baseDir: BaseDirectory.AppLocalData,
        });
        const restored = await loadFromBlob(
          new Blob([source], { type: "application/json" }),
          null,
          null,
        );
        initialData = {
          elements: restored.elements,
          appState: { ...restored.appState, ...appStateRef.current },
          files: restored.files,
        };
      }
    } catch (error) {
      // Ignore a broken session snapshot and let the user start with a blank
      // canvas; editor preferences and the Library are still restored above.
      setMessage(`Could not restore last drawing: ${String(error)}`);
    }

    persistenceReadyRef.current = true;
    return {
      ...initialData,
      appState: initialData.appState ?? appStateRef.current,
      libraryItems: libraryItemsRef.current,
    };
  }, []);

  const handleEditorChange = useCallback((
    _elements: readonly unknown[],
    appState: AppState,
  ) => {
    if (!persistenceReadyRef.current) return;
    appStateRef.current = pickPersistedAppState(appState);
    scheduleSettingsSave();
    scheduleSessionSave();
  }, [scheduleSessionSave, scheduleSettingsSave]);

  const handleThemeChange = useCallback((nextTheme: AppState["theme"] | "system") => {
    const resolvedTheme = nextTheme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : nextTheme;
    setTheme(resolvedTheme);
    if (!persistenceReadyRef.current) return;
    appStateRef.current = { ...appStateRef.current, theme: resolvedTheme };
    scheduleSettingsSave();
  }, [scheduleSettingsSave]);

  const handleLibraryChange = useCallback((libraryItems: LibraryItems) => {
    if (!persistenceReadyRef.current) return;
    libraryItemsRef.current = libraryItems;
    scheduleSettingsSave();
  }, [scheduleSettingsSave]);

  const openDrawing = useCallback(async () => {
    try {
      const path = await open({ multiple: false, filters: drawingFilter });
      if (!path || Array.isArray(path)) return;
      const source = await readTextFile(path);
      const restored = await loadFromBlob(
        new Blob([source], { type: "application/json" }),
        null,
        null,
      );
      apiRef.current?.updateScene({
        elements: restored.elements,
        appState: restored.appState,
      });
      apiRef.current?.addFiles(Object.values(restored.files));
      filePath.current = path;
      setFileName(path.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, "") || "Untitled");
      setMessage("");
    } catch (error) {
      setMessage(`Could not open drawing: ${String(error)}`);
    }
  }, []);

  const saveDrawing = useCallback(async (saveAs = false) => {
    try {
      const api = apiRef.current;
      if (!api) return;
      let path = filePath.current;
      if (!path || saveAs) {
        path = await save({
          defaultPath: `${fileName}.excalidraw`,
          filters: drawingFilter,
        });
      }
      if (!path) return;
      const json = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      await writeTextFile(path, json);
      filePath.current = path;
      setFileName(path.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, "") || "Untitled");
      setMessage("Saved");
    } catch (error) {
      setMessage(`Could not save drawing: ${String(error)}`);
    }
  }, [fileName]);

  const newDrawing = useCallback(() => {
    apiRef.current?.resetScene();
    filePath.current = null;
    setFileName("Untitled");
    setMessage("");
  }, []);

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">Excalidraw <span>Desktop</span></div>
        <div className="file-name" title={fileName}>{fileName}</div>
        <nav aria-label="Drawing files">
          <button onClick={newDrawing}>New</button>
          <button onClick={openDrawing}>Open</button>
          <button className="primary" onClick={() => void saveDrawing()}>Save</button>
          <button onClick={() => void saveDrawing(true)}>Save as</button>
        </nav>
        <span className="status" role="status">{message}</span>
      </header>
      <section className="canvas" aria-label="Excalidraw canvas">
        <Excalidraw
          initialData={loadEditorSettings}
          theme={theme}
          onChange={handleEditorChange}
          onThemeChange={handleThemeChange}
          onLibraryChange={handleLibraryChange}
          onExcalidrawAPI={(api) => { apiRef.current = api; }}
          autoFocus
        />
      </section>
    </main>
  );
}
