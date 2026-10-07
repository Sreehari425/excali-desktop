# Excalidraw Desktop

An experimental desktop wrapper for [Excalidraw](https://excalidraw.com), built with Tauri, React, and Rust.

This project packages the original [Excalidraw project](https://github.com/excalidraw/excalidraw) as a desktop app.

> **Warning:** This is a hobby/experimental project. It has not been thoroughly tested, and data loss or other bugs are possible. Do not rely on it for critical work. Keep separate backups of important drawings.

## What it does

- Draw and edit Excalidraw diagrams locally. Basic editing and locally saved drawings work without an internet connection.
- Use a mouse, touch input, or a stylus/pen supported by your operating system, hardware, and drivers. The app renders through its bundled CEF runtime rather than the system webview; pressure and other device-specific behavior may vary.
- Open and save `.excalidraw` files, use Save As, and reopen recent files.
- Autosave the current session, editor preferences, theme, and recent-file list to the app's local data directory.
- Use Excalidraw's drawing tools, library, and light/dark themes.
- Open the command palette with `Ctrl/Cmd + K` and open a drawing with `Ctrl/Cmd + O`.

> **Note:** Collaboration is supported through [Excalidraw](https://excalidraw.com) and requires an internet connection.

## Development

The provided Nix flake supplies the Linux development dependencies, Rust toolchain, Tauri CLI, and CEF runtime used by this project. The flake currently targets **x86_64 Linux**.

1. Install Nix with flakes enabled.
2. From the repository root, enter the development environment:

   ```sh
   nix develop
   ```

3. Install the JavaScript dependencies (first time, or after dependency changes):

   ```sh
   npm ci
   ```

4. Start the desktop app in development mode:

   ```sh
   cargo tauri dev
   ```

The Tauri development command starts the Vite frontend as configured in `tauri.conf.json`.

## Build

Inside `nix develop`, install dependencies if needed, then build the frontend and desktop app:

```sh
npm ci
cargo tauri build
```

The Tauri bundle is configured to target a Linux `.deb` package. This is separate from the Nix package, which includes the CEF runtime files and is built from the repository root with:

```sh
nix build
```

The Nix build produces the app in `result/bin/excali-desktop`.

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
