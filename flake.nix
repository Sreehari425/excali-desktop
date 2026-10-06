{
  description = "Offline Excalidraw desktop app built with Tauri";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      lib = pkgs.lib;
      cefArchive = pkgs.fetchurl {
        url = "https://cef-builds.spotifycdn.com/cef_binary_152.0.6+g708dc14+chromium-152.0.7977.83_linux64_minimal.tar.bz2";
        sha256 = "daf8c2b6e63787d6a91d666205a8a4521419937eabaf47723738c86aea7135bd";
      };
      cefVersion = "152.0.6";
      cefDir = pkgs.runCommand "tauri-cef-${cefVersion}" {
        nativeBuildInputs = with pkgs; [ gnutar bzip2 ];
      } ''
        mkdir -p "$out/${cefVersion}/cef_linux_x86_64"
        tar -xjf ${cefArchive} --strip-components=1 -C "$out/${cefVersion}/cef_linux_x86_64"
        cefDir="$out/${cefVersion}/cef_linux_x86_64"
        mv "$cefDir"/Release/* "$cefDir"/
        rmdir "$cefDir/Release"
        mv "$cefDir"/Resources/* "$cefDir"/
        rmdir "$cefDir/Resources"
        cat > "$cefDir/archive.json" <<'EOF'
        {"type":"minimal","name":"cef_binary_152.0.6+g708dc14+chromium-152.0.7977.83_linux64_minimal.tar.bz2","sha1":"9711b86c105fb590da576fe5a829802f1a79d520"}
        EOF
      '';
      runtimeLibraries = with pkgs; [
        gtk4
        glib
        cairo
        gdk-pixbuf
        pango
        atk
        at-spi2-atk
        at-spi2-core
        alsa-lib
        cups
        dbus
        expat
        libX11
        libXcomposite
        libXdamage
        libXext
        libXfixes
        libXrandr
        libXcursor
        libXi
        libxkbcommon
        libxshmfence
        libXtst
        libxcb
        libdrm
        mesa
        libgbm
        nspr
        nss
        systemd
        openssl
      ];
      frontend = pkgs.buildNpmPackage {
        pname = "excali-desktop-frontend";
        version = "0.1.0";
        src = self;
        npmDepsHash = "sha256-ZLAWtu3Pymyuyyk85dIAiU0AAIuWn8/2LbaKPmk3Etc=";
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
        nativeBuildInputs = with pkgs; [ pkg-config makeWrapper cmake ninja ];
        buildInputs = runtimeLibraries;
        CEF_PATH = "${cefDir}";
        preBuild = ''
          cp -r ${frontend}/dist ./dist
        '';
        postInstall = ''
          wrapProgram $out/bin/excali-desktop \
            --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath runtimeLibraries}" \
            --prefix PATH : "${lib.makeBinPath [ pkgs.zenity ]}"
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
        packages = with pkgs; [ nodejs_22 rustc cargo rustfmt clippy pkg-config cmake ninja zenity xdg-desktop-portal xdg-desktop-portal-gtk ];
        buildInputs = runtimeLibraries;
        LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibraries;
        CEF_PATH = "${cefDir}";
      };
    };
}
