import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  addRecentFile,
  editorSettingsFile,
  lastSessionFile,
  parseHostPreferences,
  parsePersistedEditorSettings,
  pickPersistedAppState,
  type HostPreferences,
} from "./persistence";
import {
  collaborationSettingsFile,
  connectRoom,
  createRoomCredentials,
  makeRoomLink,
  parseCollaborationSettings,
  parseRoomLink,
  publicCollaborationSettings,
  saveRoomScene,
  type CollaborationSettings,
} from "./collaboration";
import { RadialToolWheel } from "./RadialToolWheel";
import {
  DEFAULT_RADIAL_WHEEL_PREFERENCES,
  type RadialWheelPreferences,
} from "./radialWheelDefaults";
import { useRadialWheelController } from "./useRadialWheelController";

const drawingFilter = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

const nameFromPath = (path: string) =>
  path.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, "") || "Untitled";

type PaletteCommand = {
  id: string;
  label: string;
  description: string;
  keywords: string;
  run: () => void;
};

const openPublicRoom = async (url: string) => {
  if (isTauri()) await invoke("navigate_to_public_room", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
};

export default function App() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const filePath = useRef<string | null>(null);
  const [fileName, setFileName] = useState("Untitled");
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<AppState["theme"]>("light");
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteView, setPaletteView] = useState<"commands" | "recent">("commands");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabSettings, setCollabSettings] = useState<CollaborationSettings>(publicCollaborationSettings);
  const [collabDraft, setCollabDraft] = useState<CollaborationSettings>(publicCollaborationSettings);
  const [roomLinkInput, setRoomLinkInput] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [collabStatus, setCollabStatus] = useState("Offline");
  const [radialSettingsOpen, setRadialSettingsOpen] = useState(false);
  const [hostPreferences, setHostPreferences] = useState<HostPreferences>(() =>
    parseHostPreferences(undefined),
  );
  const collabConnectionRef = useRef<ReturnType<typeof connectRoom> | null>(null);
  const persistenceReadyRef = useRef(false);
  const appStateRef = useRef<Partial<AppState>>({});
  const libraryItemsRef = useRef<LibraryItems>([]);
  const recentFilesRef = useRef<string[]>([]);
  const hostPreferencesRef = useRef<HostPreferences>(parseHostPreferences(undefined));
  const paletteSearchRef = useRef<HTMLInputElement | null>(null);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const radialWheel = useRadialWheelController({
    enabled: true,
    preferences: hostPreferences.radialWheel,
    canvasRef,
    apiRef,
    appStateRef,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncThemeFromCanvas = () => {
      const editor = canvas.querySelector(".excalidraw");
      if (!editor) return;
      setTheme(editor.classList.contains("theme--dark") ? "dark" : "light");
    };

    syncThemeFromCanvas();
    const observer = new MutationObserver(syncThemeFromCanvas);
    observer.observe(canvas, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  const scheduleSettingsSave = useCallback(() => {
    if (!persistenceReadyRef.current) return;
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);

    settingsSaveTimerRef.current = setTimeout(() => {
      const snapshot = {
        version: 1 as const,
        appState: appStateRef.current,
        libraryItems: libraryItemsRef.current,
        recentFiles: recentFilesRef.current,
        hostPreferences: hostPreferencesRef.current,
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

  const recordRecentFile = useCallback((path: string) => {
    const nextRecentFiles = addRecentFile(path, recentFilesRef.current);
    recentFilesRef.current = nextRecentFiles;
    setRecentFiles(nextRecentFiles);
    scheduleSettingsSave();
  }, [scheduleSettingsSave]);

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

  const persistSessionNow = useCallback(async () => {
    const api = apiRef.current;
    if (!api) throw new Error("Editor is not ready");
    if (sessionSaveTimerRef.current) {
      clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    if (settingsSaveTimerRef.current) {
      clearTimeout(settingsSaveTimerRef.current);
      settingsSaveTimerRef.current = null;
    }
    const sceneAppState = { ...api.getAppState(), theme };
    const currentAppState = { ...pickPersistedAppState(sceneAppState), theme };
    appStateRef.current = currentAppState;
    const settings = JSON.stringify({
      version: 1 as const,
      appState: currentAppState,
      libraryItems: libraryItemsRef.current,
      recentFiles: recentFilesRef.current,
      hostPreferences: hostPreferencesRef.current,
    });
    const serialized = serializeAsJSON(
      api.getSceneElements(),
      sceneAppState,
      api.getFiles(),
      "local",
    );
    settingsSaveQueueRef.current = settingsSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
        await writeTextFile(editorSettingsFile, settings, {
          baseDir: BaseDirectory.AppLocalData,
        });
      });
    sessionSaveQueueRef.current = sessionSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
        await writeTextFile(lastSessionFile, serialized, {
          baseDir: BaseDirectory.AppLocalData,
        });
      });
    await Promise.all([sessionSaveQueueRef.current, settingsSaveQueueRef.current]);
  }, [theme]);

  const loadEditorSettings = useCallback(async (): Promise<ExcalidrawInitialDataState> => {
    let initialData: ExcalidrawInitialDataState = {};
    try {
      await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
    } catch (error) {
      setMessage(`Could not prepare local data: ${String(error)}`);
    }
    try {
      if (await exists(collaborationSettingsFile, { baseDir: BaseDirectory.AppLocalData })) {
        const source = await readTextFile(collaborationSettingsFile, { baseDir: BaseDirectory.AppLocalData });
        const settings = parseCollaborationSettings(source);
        setCollabSettings(settings);
        setCollabDraft(settings);
      }
    } catch (error) {
      setCollabSettings(publicCollaborationSettings);
      setCollabDraft(publicCollaborationSettings);
      setMessage(`Could not load collaboration settings; using the public service: ${String(error)}`);
    }
    try {
      if (await exists(editorSettingsFile, { baseDir: BaseDirectory.AppLocalData })) {
        const source = await readTextFile(editorSettingsFile, {
          baseDir: BaseDirectory.AppLocalData,
        });
        const settings = parsePersistedEditorSettings(source);
        appStateRef.current = settings.appState;
        libraryItemsRef.current = settings.libraryItems;
        recentFilesRef.current = settings.recentFiles;
        setRecentFiles(settings.recentFiles);
        if (settings.hostPreferences) {
          hostPreferencesRef.current = settings.hostPreferences;
          setHostPreferences(settings.hostPreferences);
        }
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
        if (typeof restored.appState.name === "string" && restored.appState.name) {
          setFileName(restored.appState.name);
        }
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
    const activeFileName = appState.fileHandle?.name;
    if (activeFileName) {
      setFileName(nameFromPath(activeFileName));
    } else if (typeof appState.name === "string" && appState.name) {
      setFileName(appState.name);
    }
    appStateRef.current = pickPersistedAppState(appState);
    collabConnectionRef.current?.sync();
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

  const toggleEditorTheme = useCallback(() => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    appStateRef.current = { ...appStateRef.current, theme: nextTheme };
    apiRef.current?.updateScene({ appState: { theme: nextTheme } });
    scheduleSettingsSave();
  }, [scheduleSettingsSave, theme]);

  const handleLibraryChange = useCallback((libraryItems: LibraryItems) => {
    if (!persistenceReadyRef.current) return;
    libraryItemsRef.current = libraryItems;
    scheduleSettingsSave();
  }, [scheduleSettingsSave]);

  const updateRadialPreferences = useCallback((patch: Partial<RadialWheelPreferences>) => {
    const next: HostPreferences = {
      radialWheel: { ...hostPreferencesRef.current.radialWheel, ...patch },
    };
    hostPreferencesRef.current = next;
    setHostPreferences(next);
    scheduleSettingsSave();
  }, [scheduleSettingsSave]);

  const resetRadialSlots = useCallback(() => {
    updateRadialPreferences({ slots: [...DEFAULT_RADIAL_WHEEL_PREFERENCES.slots] });
  }, [updateRadialPreferences]);

  const openDrawingFromPath = useCallback(async (path: string) => {
    try {
      const api = apiRef.current;
      if (!api) throw new Error("Editor is not ready");
      const source = await readTextFile(path);
      const restored = await loadFromBlob(
        new Blob([source], { type: "application/json" }),
        null,
        null,
      );
      const name = nameFromPath(path);
      const currentTheme = appStateRef.current.theme ?? api.getAppState().theme;
      api.updateScene({
        elements: restored.elements,
        appState: {
          ...restored.appState,
          ...(currentTheme ? { theme: currentTheme } : {}),
          name,
        },
      });
      api.addFiles(Object.values(restored.files));
      filePath.current = path;
      setFileName(name);
      setMessage("");
      recordRecentFile(path);
    } catch (error) {
      setMessage(`Could not open drawing: ${String(error)}`);
    }
  }, [recordRecentFile]);

  const openDrawing = useCallback(async () => {
    try {
      const path = await open({ multiple: false, filters: drawingFilter });
      if (!path || Array.isArray(path)) return;
      await openDrawingFromPath(path);
    } catch (error) {
      setMessage(`Could not open drawing: ${String(error)}`);
    }
  }, [openDrawingFromPath]);

  const openRecentDrawing = useCallback((path: string) => {
    void openDrawingFromPath(path);
  }, [openDrawingFromPath]);

  const openCommandPalette = useCallback(() => {
    setPaletteView("commands");
    setPaletteQuery("");
    setPaletteActiveIndex(0);
    setPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteActiveIndex(0);
  }, []);

  useEffect(() => {
    if (paletteOpen) paletteSearchRef.current?.focus();
  }, [paletteOpen, paletteView]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const hasCommandModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target;
      const isTextEntry = target instanceof Element && Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      );

      if (hasCommandModifier && !event.shiftKey && !event.altKey && event.code === "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (paletteOpen) closeCommandPalette();
        else if (!isTextEntry) openCommandPalette();
        return;
      }

      if (paletteOpen || !hasCommandModifier || event.altKey || event.shiftKey || key !== "o" || isTextEntry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void openDrawing();
    };

    window.addEventListener("keydown", handleShortcuts, true);
    return () => window.removeEventListener("keydown", handleShortcuts, true);
  }, [closeCommandPalette, openCommandPalette, openDrawing, paletteOpen]);

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
      const name = nameFromPath(path);
      const json = serializeAsJSON(
        api.getSceneElements(),
        { ...api.getAppState(), name },
        api.getFiles(),
        "local",
      );
      await writeTextFile(path, json);
      filePath.current = path;
      api.updateScene({ appState: { name } });
      setFileName(name);
      setMessage("Saved");
      recordRecentFile(path);
    } catch (error) {
      setMessage(`Could not save drawing: ${String(error)}`);
    }
  }, [fileName, recordRecentFile]);

  const newDrawing = useCallback(() => {
    apiRef.current?.resetScene();
    filePath.current = null;
    setFileName("Untitled");
    setMessage("");
  }, []);

  const persistCollabSettings = useCallback(async (settings: CollaborationSettings) => {
    await mkdir(".", { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeTextFile(collaborationSettingsFile, JSON.stringify(settings, null, 2), {
      baseDir: BaseDirectory.AppLocalData,
    });
    setCollabSettings(settings);
    setCollabDraft(settings);
  }, []);

  const handleCollabStatus = useCallback((status: string) => {
    setCollabStatus(status);
    if (status === "Connected") setMessage("Joined collaboration room");
  }, []);

  const backupCurrentDrawing = useCallback(async () => {
    const api = apiRef.current;
    if (!api) throw new Error("Editor is not ready");
    const date = new Date().toISOString().replace(/[:.]/g, "-");
    const source = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    await writeTextFile(`collaboration-backup-${date}.excalidraw`, source, { baseDir: BaseDirectory.AppLocalData });
  }, []);

  const startRoom = useCallback(async (credentials: { roomId: string; roomKey: string }, joining: boolean) => {
    const api = apiRef.current;
    if (!api) throw new Error("Editor is not ready");
    let socketUrl = collabSettings.socketUrl;
    try {
      socketUrl = await invoke<string>("configure_collaboration_proxy", {
        targetUrl: collabSettings.socketUrl,
        origin: new URL(collabSettings.websiteUrl).origin,
      });
    } catch (error) {
      // Browser-based development has no Tauri command bridge; use the room
      // endpoint directly there. Packaged desktop builds use the native proxy.
      if (isTauri()) throw new Error(`Could not start the desktop room proxy: ${String(error)}`);
    }
    if (joining) {
      await backupCurrentDrawing();
      api.resetScene();
      filePath.current = null;
      setFileName("Untitled");
    }
    const invite = makeRoomLink(collabSettings, credentials.roomId, credentials.roomKey);
    const connection = connectRoom(collabSettings, credentials.roomId, credentials.roomKey, api, handleCollabStatus, socketUrl);
    collabConnectionRef.current?.close();
    collabConnectionRef.current = connection;
    setRoomLink(invite);
    setCollabStatus("Connecting…");
  }, [backupCurrentDrawing, collabSettings, handleCollabStatus]);

  const createCollaborationRoom = useCallback(async () => {
    try {
      const credentials = await createRoomCredentials();
      const api = apiRef.current;
      if (!api) throw new Error("Editor is not ready");
      if (collabSettings.service === "public") {
        await backupCurrentDrawing();
        await persistSessionNow();
        const invite = makeRoomLink(publicCollaborationSettings, credentials.roomId, credentials.roomKey, theme);
        await openPublicRoom(invite);
        setRoomLink(invite);
        setCollabStatus("Room opened in Excalidraw. Import the timestamped local backup there to share this drawing.");
      } else {
        await saveRoomScene(collabSettings, credentials.roomId, credentials.roomKey, api.getSceneElementsIncludingDeleted());
        await startRoom(credentials, false);
      }
      setMessage("Collaboration room created");
    } catch (error) { setCollabStatus(`Could not create room: ${String(error)}`); }
  }, [backupCurrentDrawing, collabSettings, persistSessionNow, startRoom, theme]);

  const joinCollaborationRoom = useCallback(async () => {
    try {
      const credentials = parseRoomLink(roomLinkInput);
      if (collabSettings.service === "public") {
        await backupCurrentDrawing();
        await persistSessionNow();
        const invite = makeRoomLink(publicCollaborationSettings, credentials.roomId, credentials.roomKey, theme);
        await openPublicRoom(invite);
        setRoomLink(invite);
        setCollabStatus("Room opened in Excalidraw");
        setMessage("Joining collaboration room in Excalidraw…");
      } else {
        await startRoom(credentials, true);
        setMessage("Joining collaboration room…");
      }
    } catch (error) { setCollabStatus(`Could not join room: ${String(error)}`); }
  }, [backupCurrentDrawing, collabSettings, persistSessionNow, roomLinkInput, startRoom, theme]);

  const copyInviteLink = useCallback(async () => {
    try { await navigator.clipboard.writeText(roomLink); setCollabStatus("Invite link copied"); }
    catch (error) { setCollabStatus(`Could not copy invite link: ${String(error)}`); }
  }, [roomLink]);

  const leaveRoom = useCallback(() => {
    collabConnectionRef.current?.close();
    collabConnectionRef.current = null;
    setRoomLink("");
    setCollabStatus("Offline");
  }, []);

  useEffect(() => () => collabConnectionRef.current?.close(), []);

  const paletteCommands: PaletteCommand[] = [
    { id: "new", label: "New drawing", description: "Start a blank drawing", keywords: "file create blank", run: newDrawing },
    { id: "open", label: "Open drawing…", description: "Choose an .excalidraw file", keywords: "file browse load", run: () => { void openDrawing(); } },
    { id: "open-recent", label: "Open Recent", description: "Choose from recently opened or saved drawings", keywords: "file history previous", run: () => {} },
    { id: "save", label: "Save", description: filePath.current ? `Save ${fileName}` : "Choose where to save this drawing", keywords: "file write", run: () => { void saveDrawing(); } },
    { id: "save-as", label: "Save As…", description: "Save a copy to a new file", keywords: "file export copy", run: () => { void saveDrawing(true); } },
    { id: "collaborate", label: "Collaborate", description: "Open collaboration options", keywords: "online room share invite", run: () => setCollabOpen(true) },
    { id: "radial-wheel", label: "Radial wheel settings…", description: "Stylus button, shortcut key, and tool ring options", keywords: "krita pie menu palette pen stylus gaomon", run: () => setRadialSettingsOpen(true) },
    { id: "theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, description: "Change the editor appearance", keywords: "appearance color mode", run: toggleEditorTheme },
  ];
  const normalizedPaletteQuery = paletteQuery.trim().toLowerCase();
  const paletteResults: PaletteCommand[] = paletteView === "commands"
    ? paletteCommands.filter((command) => `${command.label} ${command.description} ${command.keywords}`.toLowerCase().includes(normalizedPaletteQuery))
    : recentFiles
      .map((path) => ({
        id: `recent-${path}`,
        label: nameFromPath(path),
        description: path,
        keywords: path,
        run: () => openRecentDrawing(path),
      }))
      .filter((file) => `${file.label} ${file.description} ${file.keywords}`.toLowerCase().includes(normalizedPaletteQuery));
  const selectedPaletteResult = paletteResults[paletteActiveIndex];
  const activatePaletteResult = (item: PaletteCommand) => {
    if (paletteView === "commands" && item.id === "open-recent") {
      setPaletteView("recent");
      setPaletteQuery("");
      setPaletteActiveIndex(0);
      return;
    }
    closeCommandPalette();
    item.run();
  };

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="toolbar">
        <div className="brand">Excalidraw <span>Desktop</span></div>
        <div className="file-name" title={fileName}>{fileName}</div>
        <nav aria-label="Drawing files">
          <button onClick={newDrawing}>New</button>
          <button onClick={openDrawing}>Open</button>
          <button className="primary" onClick={() => void saveDrawing()}>Save</button>
          <button onClick={() => void saveDrawing(true)}>Save as</button>
          <button onClick={() => setCollabOpen(true)}>Collaborate</button>
        </nav>
        <span className="status" role="status">{message}</span>
      </header>
      {paletteOpen && <div className="command-palette-backdrop" onClick={(event) => {
        if (event.target === event.currentTarget) closeCommandPalette();
      }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
          <header className="command-palette-heading">
            {paletteView === "recent" && <button aria-label="Back to commands" onClick={() => {
              setPaletteView("commands");
              setPaletteQuery("");
              setPaletteActiveIndex(0);
            }}>←</button>}
            <strong id="command-palette-title">{paletteView === "recent" ? "Open Recent" : "Command palette"}</strong>
            <button aria-label="Close command palette" onClick={closeCommandPalette}>Esc</button>
          </header>
          <input
            ref={paletteSearchRef}
            className="command-palette-search"
            type="text"
            role="combobox"
            aria-label={paletteView === "recent" ? "Search recent drawings" : "Search commands"}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={selectedPaletteResult ? `command-palette-result-${paletteActiveIndex}` : undefined}
            placeholder={paletteView === "recent" ? "Search recent drawings…" : "Type a command or search…"}
            value={paletteQuery}
            onChange={(event) => {
              setPaletteQuery(event.target.value);
              setPaletteActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && paletteResults.length) {
                event.preventDefault();
                event.stopPropagation();
                setPaletteActiveIndex((index) => (index + 1) % paletteResults.length);
              } else if (event.key === "ArrowUp" && paletteResults.length) {
                event.preventDefault();
                event.stopPropagation();
                setPaletteActiveIndex((index) => (index - 1 + paletteResults.length) % paletteResults.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (selectedPaletteResult) activatePaletteResult(selectedPaletteResult);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (paletteView === "recent") {
                  setPaletteView("commands");
                  setPaletteQuery("");
                  setPaletteActiveIndex(0);
                } else {
                  closeCommandPalette();
                }
              }
            }}
          />
          <div className="command-palette-results" id="command-palette-results" role="listbox" aria-label={paletteView === "recent" ? "Recent drawings" : "Commands"}>
            {paletteResults.map((item, index) => <button
              id={`command-palette-result-${index}`}
              className={`command-palette-result${index === paletteActiveIndex ? " is-active" : ""}`}
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === paletteActiveIndex}
              onMouseEnter={() => setPaletteActiveIndex(index)}
              onClick={() => activatePaletteResult(item)}
            >
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
              {paletteView === "commands" && item.id === "open-recent" && <kbd>↵</kbd>}
            </button>)}
            {!paletteResults.length && <p className="command-palette-empty">{paletteView === "recent" && !recentFiles.length ? "No recent drawings yet. Open or save a drawing to add it here." : "No matching results."}</p>}
          </div>
          <footer className="command-palette-footer"><span>↑↓ Navigate</span><span>↵ Select</span><span>Ctrl+Space Toggle</span><span>Esc {paletteView === "recent" ? "Back" : "Close"}</span></footer>
        </section>
      </div>}
      {radialSettingsOpen && <section className="collab-panel radial-settings-panel" aria-label="Radial wheel settings">
        <div className="collab-heading"><strong>Radial tool wheel</strong><button onClick={() => setRadialSettingsOpen(false)}>Close</button></div>
        <label className="radial-settings-row">
          <span>Enable radial wheel</span>
          <input
            type="checkbox"
            checked={hostPreferences.radialWheel.enabled}
            onChange={(event) => updateRadialPreferences({ enabled: event.target.checked })}
          />
        </label>
        <label>
          Stylus auxiliary button number
          <input
            type="number"
            min={1}
            max={5}
            value={hostPreferences.radialWheel.pointerButton}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              updateRadialPreferences({ pointerButton: Math.trunc(value) });
            }}
          />
        </label>
        <small>
          Press the barrel button once to open the wheel — it stays until you click a tool, click outside, press Esc, or press the button again.
          Drivers often report the facing auxiliary button as <code>1</code>, <code>2</code>, or <code>5</code> — try each until the wheel opens.
          Last pen button seen: <strong>{radialWheel.lastPenButton ?? "none yet"}</strong>
        </small>
        <label>
          Keyboard toggle key (optional)
          <select
            value={hostPreferences.radialWheel.keyboardHoldKey ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              updateRadialPreferences({ keyboardHoldKey: value.length ? value : null });
            }}
          >
            <option value="">Disabled</option>
            <option value="`">Backtick (`)</option>
            <option value="Tab">Tab</option>
            <option value="q">Q</option>
            <option value="CapsLock">Caps Lock</option>
          </select>
        </label>
        <small>Press the key once to open. Click a tool on the wheel to select (wheel closes). Press the key again or Esc to close without selecting.</small>
        <div className="collab-actions">
          <button type="button" onClick={resetRadialSlots}>Reset slots to default</button>
        </div>
        <small>Default ring: selection, hand, shapes, arrow, line, draw, text, eraser, sticky note, laser. Stroke/fill quick picks live in the hub.</small>
      </section>}
      {collabOpen && <section className="collab-panel" aria-label="Collaboration">
        <div className="collab-heading"><strong>Collaborate</strong><button onClick={() => setCollabOpen(false)}>Close</button></div>
        <div className="collab-heading"><p className="collab-status" role="status">{collabStatus}</p>{roomLink && <button onClick={leaveRoom}>Leave room</button>}</div>
        {roomLink && <div className="collab-invite"><input aria-label="Invite link" readOnly value={roomLink} /><button onClick={() => void copyInviteLink()}>Copy invite</button></div>}
        <div className="collab-actions"><button className="primary" onClick={() => void createCollaborationRoom()}>{collabSettings.service === "public" ? "Create room in Excalidraw" : "Create room from this drawing"}</button></div>
        <div className="collab-invite"><input aria-label="Room invite link" placeholder="Paste a room invite link" value={roomLinkInput} onChange={(event) => setRoomLinkInput(event.target.value)} /><button onClick={() => void joinCollaborationRoom()}>{collabSettings.service === "public" ? "Join with Excalidraw" : "Join room"}</button></div>
        <details><summary>Service settings</summary>
          <label>Room service<select value={collabDraft.service} onChange={(event) => {
            const service = event.target.value as CollaborationSettings["service"];
            setCollabDraft(service === "public" ? publicCollaborationSettings : { ...collabSettings, service });
          }}><option value="public">Excalidraw public service</option><option value="self-hosted">Self-hosted</option></select></label>
          {collabDraft.service === "self-hosted" && <>
            <label>Socket.IO room endpoint<input value={collabDraft.socketUrl} onChange={(event) => setCollabDraft({ ...collabDraft, socketUrl: event.target.value })} placeholder="https://collab.example.com" /></label>
            <label>Excalidraw website URL<input value={collabDraft.websiteUrl} onChange={(event) => setCollabDraft({ ...collabDraft, websiteUrl: event.target.value })} placeholder="https://draw.example.com/" /></label>
            <label>Firebase-compatible configuration (JSON)<textarea rows={5} value={JSON.stringify(collabDraft.firebaseConfig, null, 2)} onChange={(event) => {
              try { setCollabDraft({ ...collabDraft, firebaseConfig: JSON.parse(event.target.value) as Record<string, string> }); } catch { /* allow editing incomplete JSON */ }
            }} /></label>
          </>}
          <button onClick={() => void persistCollabSettings(collabDraft).then(() => setCollabStatus("Collaboration settings saved")).catch((error) => setCollabStatus(`Could not save settings: ${String(error)}`))}>Save service settings</button>
        </details>
        <small>{collabSettings.service === "public" ? "Public rooms are handled by excalidraw.com in this window. The app saves a local backup first; import that file in Excalidraw to share the drawing. Self-hosted rooms use this app's collaboration client." : "Collaboration sends encrypted room data and image contents to your configured self-hosted service. Local editing and autosave continue when disconnected."}</small>
      </section>}
      <section className="canvas" aria-label="Excalidraw canvas" ref={canvasRef}>
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
      <RadialToolWheel
        open={radialWheel.open}
        x={radialWheel.x}
        y={radialWheel.y}
        slots={radialWheel.slots}
        activeTool={radialWheel.activeTool}
        strokeColor={radialWheel.strokeColor}
        fillColor={radialWheel.fillColor}
        colorTarget={radialWheel.colorTarget}
        colorPicks={radialWheel.colorPicks}
        zoom={radialWheel.zoom}
        onSelectTool={radialWheel.selectTool}
        onSelectColor={radialWheel.selectColor}
        onSetColorTarget={radialWheel.setColorTarget}
        onSetZoom={radialWheel.setZoom}
        onResetZoom={radialWheel.resetZoom}
        onFitContent={radialWheel.fitContent}
        onDeleteSelected={radialWheel.deleteSelected}
        onUndo={radialWheel.undo}
        onRedo={radialWheel.redo}
        onDismiss={radialWheel.dismiss}
      />
    </main>
  );
}
