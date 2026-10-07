import { initializeApp, getApps } from "firebase/app";
import { Bytes, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getBytes } from "firebase/storage";
import { io, type Socket } from "socket.io-client";
import { getSceneVersion, reconcileElements } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { deflate, inflate } from "pako";
const encryptData = async (key: string, data: Uint8Array<ArrayBuffer>) => {
  const cryptoKey = await crypto.subtle.importKey("jwk", { alg: "A128GCM", ext: true, k: key, key_ops: ["encrypt", "decrypt"], kty: "oct" }, { name: "AES-GCM", length: 128 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { encryptedBuffer: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data), iv };
};
const decryptData = async (iv: Uint8Array<ArrayBuffer>, encrypted: ArrayBuffer | Uint8Array<ArrayBuffer>, key: string) => {
  const cryptoKey = await crypto.subtle.importKey("jwk", { alg: "A128GCM", ext: true, k: key, key_ops: ["encrypt", "decrypt"], kty: "oct" }, { name: "AES-GCM", length: 128 }, false, ["decrypt"]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, encrypted);
};

export const collaborationSettingsFile = "collaboration-settings.json";
export const publicCollaborationSettings: CollaborationSettings = {
  version: 1,
  service: "public",
  socketUrl: "https://oss-collab.excalidraw.com",
  firebaseConfig: {
    apiKey: "AIzaSyAd15pYlMci_xIp9ko6wkEsDzAAA0Dn0RU",
    authDomain: "excalidraw-room-persistence.firebaseapp.com",
    databaseURL: "https://excalidraw-room-persistence.firebaseio.com",
    projectId: "excalidraw-room-persistence",
    storageBucket: "excalidraw-room-persistence.appspot.com",
    messagingSenderId: "654800341332",
    appId: "1:654800341332:web:4a692de832b55bd57ce0c1",
  },
  websiteUrl: "https://excalidraw.com/",
};

export interface CollaborationSettings {
  version: 1;
  service: "public" | "self-hosted";
  socketUrl: string;
  firebaseConfig: Record<string, string>;
  websiteUrl: string;
}

export function parseCollaborationSettings(source: string): CollaborationSettings {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object") throw new Error("Malformed collaboration settings");
  const item = value as Partial<CollaborationSettings>;
  if (item.version !== 1 || !["public", "self-hosted"].includes(item.service ?? "") ||
      typeof item.socketUrl !== "string" || typeof item.websiteUrl !== "string" ||
      !item.firebaseConfig || typeof item.firebaseConfig !== "object") {
    throw new Error("Unsupported or malformed collaboration settings");
  }
  return item as CollaborationSettings;
}

export function parseRoomLink(raw: string): { roomId: string; roomKey: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("Paste a valid Excalidraw room link"); }
  const match = url.hash.match(/^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/);
  if (!match || match[2].length !== 22) throw new Error("This link does not contain a valid Excalidraw room and access key");
  return { roomId: match[1], roomKey: match[2] };
}

export function makeRoomLink(settings: CollaborationSettings, roomId: string, roomKey: string): string {
  const base = new URL(settings.websiteUrl);
  base.hash = `room=${roomId},${roomKey}`;
  return base.toString();
}

const defaultFirebaseConfig = publicCollaborationSettings.firebaseConfig;
const uploadedRoomFiles = new Map<string, number>();
let initializedFirebase: { fingerprint: string; app: ReturnType<typeof initializeApp> } | null = null;
function firebaseAppFor(config: Record<string, string>) {
  const effective = Object.keys(config).length ? config : defaultFirebaseConfig;
  const fingerprint = JSON.stringify(effective);
  if (initializedFirebase?.fingerprint === fingerprint) return initializedFirebase.app;
  const app = getApps().find((candidate) => candidate.name === `collab-${btoa(fingerprint).slice(0, 20)}`) ??
    initializeApp(effective, `collab-${btoa(fingerprint).slice(0, 20)}`);
  initializedFirebase = { fingerprint, app };
  return app;
}
const firebaseFor = (config: Record<string, string>) => getFirestore(firebaseAppFor(config));

function concatBytes(...chunks: Uint8Array[]) {
  const result = new Uint8Array(4 + chunks.length * 4 + chunks.reduce((sum, part) => sum + part.length, 0));
  const view = new DataView(result.buffer);
  let offset = 0;
  view.setUint32(offset, 1); offset += 4;
  for (const part of chunks) {
    view.setUint32(offset, part.length); offset += 4;
    result.set(part, offset); offset += part.length;
  }
  return result;
}
function splitBytes(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const result: Uint8Array[] = [];
  let offset = 4;
  while (offset < buffer.length) {
    const size = view.getUint32(offset); offset += 4;
    result.push(buffer.slice(offset, offset + size)); offset += size;
  }
  return result;
}
async function encodeRoomFile(dataURL: string, roomKey: string, metadata: Record<string, unknown>) {
  const contents = concatBytes(new TextEncoder().encode(JSON.stringify(metadata)), new TextEncoder().encode(dataURL));
  const encrypted = await encryptData(roomKey, deflate(contents) as Uint8Array<ArrayBuffer>);
  return concatBytes(new TextEncoder().encode(JSON.stringify({ version: 2, compression: "pako@1", encryption: "AES-GCM" })), encrypted.iv, new Uint8Array(encrypted.encryptedBuffer));
}
async function decodeRoomFile(encoded: Uint8Array, roomKey: string) {
  const [info, iv, data] = splitBytes(encoded);
  if (!info || !iv || !data) throw new Error("Malformed room image data");
  const decrypted = await decryptData(iv as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>, roomKey);
  const [metadata, fileData] = splitBytes(inflate(new Uint8Array(decrypted)));
  if (!metadata || !fileData) throw new Error("Malformed room image payload");
  return { metadata: JSON.parse(new TextDecoder().decode(metadata)) as Record<string, unknown>, dataURL: new TextDecoder().decode(fileData) };
}
async function saveRoomFiles(settings: CollaborationSettings, roomId: string, roomKey: string, api: ExcalidrawImperativeAPI, elements: readonly any[]) {
  const storage = getStorage(firebaseAppFor(settings.firebaseConfig));
  const files = api.getFiles();
  const savedIds = new Set<string>();
  await Promise.all(elements.filter((element) => element.type === "image" && element.fileId && !element.isDeleted)
    .map(async (element) => {
      const file = files[element.fileId];
      if (!file?.dataURL) return;
      const versionKey = `${roomId}:${element.fileId}`;
      const version = file.version ?? 1;
      if (uploadedRoomFiles.get(versionKey) !== version) {
        const bytes = await encodeRoomFile(file.dataURL, roomKey, { id: element.fileId, mimeType: file.mimeType, created: Date.now(), lastRetrieved: Date.now() });
        await uploadBytes(ref(storage, `files/rooms/${roomId}/${element.fileId}`), bytes, { cacheControl: "public, max-age=31536000" });
        uploadedRoomFiles.set(versionKey, version);
      }
      savedIds.add(element.fileId);
    }));
  return savedIds;
}

export async function saveRoomSnapshot(settings: CollaborationSettings, roomId: string, roomKey: string, api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElementsIncludingDeleted();
  const savedIds = await saveRoomFiles(settings, roomId, roomKey, api, elements);
  const shareableElements = elements.map((element) => element.type === "image" && element.fileId && savedIds.has(element.fileId)
    ? { ...element, status: "saved" as const }
    : element);
  await saveRoomScene(settings, roomId, roomKey, shareableElements);
}
async function loadRoomFiles(settings: CollaborationSettings, roomId: string, roomKey: string, api: ExcalidrawImperativeAPI, elements: readonly any[]) {
  const storage = getStorage(firebaseAppFor(settings.firebaseConfig));
  const files = await Promise.all(elements.filter((element) => element.type === "image" && element.fileId && !element.isDeleted)
    .map(async (element) => {
      const decoded = await decodeRoomFile(new Uint8Array(await getBytes(ref(storage, `files/rooms/${roomId}/${element.fileId}`))), roomKey);
      return { id: element.fileId, dataURL: decoded.dataURL, mimeType: decoded.metadata.mimeType as string, created: decoded.metadata.created as number, lastRetrieved: Date.now() };
    }));
  if (files.length) api.addFiles(files as never[]);
}

async function encryptedElements(elements: readonly unknown[], roomKey: string) {
  const encrypted = await encryptData(roomKey, new TextEncoder().encode(JSON.stringify(elements)) as Uint8Array<ArrayBuffer>);
  return { ciphertext: Bytes.fromUint8Array(new Uint8Array(encrypted.encryptedBuffer)), iv: Bytes.fromUint8Array(encrypted.iv), sceneVersion: getSceneVersion(elements as never) };
}

export async function loadRoomScene(settings: CollaborationSettings, roomId: string, roomKey: string) {
  const snapshot = await getDoc(doc(firebaseFor(settings.firebaseConfig), "scenes", roomId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const decrypted = await decryptData(data.iv.toUint8Array(), data.ciphertext.toUint8Array(), roomKey);
  return JSON.parse(new TextDecoder().decode(decrypted)) as never[];
}

export async function saveRoomScene(settings: CollaborationSettings, roomId: string, roomKey: string, elements: readonly unknown[]) {
  await setDoc(doc(firebaseFor(settings.firebaseConfig), "scenes", roomId), await encryptedElements(elements, roomKey));
}

export interface RoomConnection {
  socket: Socket;
  close: () => void;
  sync: () => void;
}

export function connectRoom(settings: CollaborationSettings, roomId: string, roomKey: string,
  api: ExcalidrawImperativeAPI, onStatus: (status: string) => void, socketUrl = settings.socketUrl) : RoomConnection {
  // The desktop uses its native local proxy to apply an allowed website Origin,
  // so it stays on polling. Browser development can use normal transport fallback.
  const usingNativeProxy = socketUrl !== settings.socketUrl;
  const socket = io(socketUrl, {
    transports: usingNativeProxy ? ["polling"] : ["polling", "websocket"],
    tryAllTransports: !usingNativeProxy,
    reconnection: true,
  });
  let initialized = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastVersion = -1;
  const send = async (type: "SCENE_INIT" | "SCENE_UPDATE") => {
    if (!socket.connected || !initialized) return;
    let elements = api.getSceneElementsIncludingDeleted();
    try {
      const savedIds = await saveRoomFiles(settings, roomId, roomKey, api, elements);
      elements = elements.map((element) => element.type === "image" && element.fileId && savedIds.has(element.fileId)
        ? { ...element, status: "saved" } as typeof element
        : element);
    }
    catch (error) { onStatus(`Connected · image upload failed: ${String(error)}`); }
    const version = getSceneVersion(elements);
    if (version === lastVersion) return;
    lastVersion = version;
    const payload = { type, payload: { elements } };
    const { encryptedBuffer, iv } = await encryptData(roomKey, new TextEncoder().encode(JSON.stringify(payload)) as Uint8Array<ArrayBuffer>);
    socket.emit("server-broadcast", roomId, encryptedBuffer, iv);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveRoomScene(settings, roomId, roomKey, elements)
      .catch((error) => onStatus(`Connected · room save failed: ${String(error)}`)), 500);
  };
  const onScene = async (ciphertext: ArrayBuffer, iv: Uint8Array) => {
    try {
      const buffer = await decryptData(iv as Uint8Array<ArrayBuffer>, ciphertext, roomKey);
      const message = JSON.parse(new TextDecoder().decode(buffer));
      if (message.type !== "SCENE_INIT" && message.type !== "SCENE_UPDATE") return;
      onStatus("Connected");
      if (message.type === "SCENE_INIT") initialized = true;
      const current = api.getSceneElementsIncludingDeleted();
      const merged = reconcileElements(current as never[], message.payload.elements as never[], api.getAppState() as AppState);
      api.updateScene({ elements: merged });
      void loadRoomFiles(settings, roomId, roomKey, api, merged).catch((error) => onStatus(`Connected · image download failed: ${String(error)}`));
      lastVersion = getSceneVersion(merged);
    } catch (error) { onStatus(`Connected · could not apply room update: ${String(error)}`); }
  };
  const init = async () => {
    try {
      const scene = await loadRoomScene(settings, roomId, roomKey);
      if (scene?.length) {
        const merged = reconcileElements(api.getSceneElementsIncludingDeleted() as never[], scene as never[], api.getAppState() as AppState);
        api.updateScene({ elements: merged });
        try { await loadRoomFiles(settings, roomId, roomKey, api, merged); }
        catch (error) { onStatus(`Connected · image download failed: ${String(error)}`); }
      }
    } catch (error) { onStatus(`Connected · could not load room: ${String(error)}`); }
    initialized = true;
    onStatus("Connected");
    void send("SCENE_INIT");
  };
  socket.on("connect", () => { onStatus("Connecting to room…"); });
  socket.on("init-room", () => socket.emit("join-room", roomId));
  socket.on("first-in-room", () => { void init(); });
  socket.on("new-user", () => { void send("SCENE_INIT"); });
  socket.on("client-broadcast", (ciphertext: ArrayBuffer, iv: Uint8Array) => { void onScene(ciphertext, iv); });
  socket.on("connect_error", (error) => {
    const context = (error as Error & { context?: { status?: number; responseText?: string } }).context;
    const detail = [error.message, context?.status ? `HTTP ${context.status}` : "", context?.responseText ?? ""]
      .filter(Boolean).join(" · ");
    onStatus(`Reconnecting · ${detail}`);
  });
  socket.on("disconnect", () => { initialized = false; onStatus("Offline · editing locally, reconnecting…"); });
  const close = () => {
    if (saveTimer) clearTimeout(saveTimer);
    socket.disconnect();
  };
  return { socket, close, sync: () => { void send("SCENE_UPDATE"); } };
}

export async function createRoomCredentials() {
  const idBytes = crypto.getRandomValues(new Uint8Array(10));
  const roomId = Array.from(idBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
  const roomKey = (await crypto.subtle.exportKey("jwk", key)).k;
  if (!roomKey) throw new Error("Could not generate a room access key");
  return { roomId, roomKey };
}
