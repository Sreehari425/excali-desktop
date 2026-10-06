{
  description = "Offline Excalidraw desktop app built with Tauri";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      lib = pkgs.lib;
      runtimeLibraries = with pkgs; [
        gtk3
        glib
        webkitgtk_4_1
        libsoup_3
        cairo
        gdk-pixbuf
        pango
        atk
        at-spi2-atk
        at-spi2-core
        openssl
        librsvg
        libayatana-appindicator
      ];
      frontend = pkgs.buildNpmPackage {
        pname = "excali-desktop-frontend";
        version = "0.1.0";
        src = self;
        npmDepsHash = "sha256-hCG+4X9HiORbEIFJyn0HcBDHkfcmlHVNnVza2vAVcYs=";
        npmFlags = [ "--legacy-peer-deps" ];
        npmBuildScript = "build";
        dontNpmInstall = true;
        installPhase = ''
          mkdir -p $out
          cp -r dist $out/dist
        '';
      };
      desktopItem = pkgs.makeDesktopItem {
        name = "excali-desktop";
        desktopName = "Excalidraw Desktop";
        comment = "Offline Excalidraw desktop editor";
        exec = "excali-desktop";
        categories = [ "Graphics" ];
        terminal = false;
      };
      app = pkgs.rustPlatform.buildRustPackage {
        pname = "excali-desktop";
        version = "0.1.0";
        src = self;
        cargoLock.lockFile = ./Cargo.lock;
        nativeBuildInputs = with pkgs; [ pkg-config makeWrapper ];
        buildInputs = runtimeLibraries;
        preBuild = ''
          cp -r ${frontend}/dist ./dist
        '';
        postInstall = ''
          wrapProgram $out/bin/excali-desktop \
            --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath runtimeLibraries}"
          mkdir -p $out/share/applications
          cp ${desktopItem}/share/applications/*.desktop $out/share/applications/
        '';
      };
    in {
      packages.${system} = {
        default = app;
        inherit frontend;
      };
      apps.${system}.default = {
        type = "app";
        program = "${app}/bin/excali-desktop";
      };
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ nodejs_22 rustc cargo rustfmt clippy pkg-config cargo-tauri ];
        buildInputs = runtimeLibraries;
        LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibraries;
      };
    };
}
