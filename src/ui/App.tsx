import { useCallback, useRef, useState } from "react";
import { Excalidraw, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

const drawingFilter = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

export default function App() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const filePath = useRef<string | null>(null);
  const [fileName, setFileName] = useState("Untitled");
  const [message, setMessage] = useState("");

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
      const finalPath = path.toLowerCase().endsWith(".excalidraw") ? path : `${path}.excalidraw`;
      await writeTextFile(finalPath, json);
      filePath.current = finalPath;
      setFileName(finalPath.split(/[\\/]/).pop()?.replace(/\.excalidraw$/i, "") || "Untitled");
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
          onExcalidrawAPI={(api) => { apiRef.current = api; }}
          autoFocus
        />
      </section>
    </main>
  );
}
