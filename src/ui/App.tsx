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
  editorSettingsFile,
  lastSessionFile,
  parsePersistedEditorSettings,
  pickPersistedAppState,
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
  saveRoomSnapshot,
  type CollaborationSettings,
} from "./collaboration";

const drawingFilter = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

const nameFromPath = (path: string) =>
  path.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, "") || "Untitled";

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
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabSettings, setCollabSettings] = useState<CollaborationSettings>(publicCollaborationSettings);
  const [collabDraft, setCollabDraft] = useState<CollaborationSettings>(publicCollaborationSettings);
  const [roomLinkInput, setRoomLinkInput] = useState("");
  const [roomLink, setRoomLink] = useState("");
  const [collabStatus, setCollabStatus] = useState("Offline");
  const collabConnectionRef = useRef<ReturnType<typeof connectRoom> | null>(null);
  const persistenceReadyRef = useRef(false);
  const appStateRef = useRef<Partial<AppState>>({});
  const libraryItemsRef = useRef<LibraryItems>([]);
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      const name = nameFromPath(path);
      const currentTheme = appStateRef.current.theme ?? apiRef.current?.getAppState().theme;
      apiRef.current?.updateScene({
        elements: restored.elements,
        appState: {
          ...restored.appState,
          ...(currentTheme ? { theme: currentTheme } : {}),
          name,
        },
      });
      apiRef.current?.addFiles(Object.values(restored.files));
      filePath.current = path;
      setFileName(name);
      setMessage("");
    } catch (error) {
      setMessage(`Could not open drawing: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    const handleOpenShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "o") {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void openDrawing();
    };

    window.addEventListener("keydown", handleOpenShortcut, true);
    return () => window.removeEventListener("keydown", handleOpenShortcut, true);
  }, [openDrawing]);

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
        await saveRoomSnapshot(collabSettings, credentials.roomId, credentials.roomKey, api);
        const invite = makeRoomLink(collabSettings, credentials.roomId, credentials.roomKey);
        await openPublicRoom(invite);
        setRoomLink(invite);
        setCollabStatus("Open in Excalidraw · room sync runs there");
      } else {
        await saveRoomScene(collabSettings, credentials.roomId, credentials.roomKey, api.getSceneElementsIncludingDeleted());
        await startRoom(credentials, false);
      }
      setMessage("Collaboration room created");
    } catch (error) { setCollabStatus(`Could not create room: ${String(error)}`); }
  }, [backupCurrentDrawing, collabSettings, startRoom]);

  const joinCollaborationRoom = useCallback(async () => {
    try {
      const credentials = parseRoomLink(roomLinkInput);
      if (collabSettings.service === "public") {
        await backupCurrentDrawing();
        const invite = makeRoomLink(collabSettings, credentials.roomId, credentials.roomKey);
        await openPublicRoom(invite);
        setRoomLink(invite);
        setCollabStatus("Open in Excalidraw · room sync runs there");
        setMessage("Joining collaboration room in Excalidraw…");
      } else {
        await startRoom(credentials, true);
        setMessage("Joining collaboration room…");
      }
    } catch (error) { setCollabStatus(`Could not join room: ${String(error)}`); }
  }, [backupCurrentDrawing, collabSettings, roomLinkInput, startRoom]);

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
        <small>{collabSettings.service === "public" ? "Public rooms open in Excalidraw in this window. A timestamped local backup is saved before you leave the editor." : "Collaboration sends encrypted room data and image contents to the selected service. Local editing and autosave continue when disconnected."}</small>
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
    </main>
  );
}
