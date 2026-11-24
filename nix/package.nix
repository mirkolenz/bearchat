{
  lib,
  buildNpmPackage,
  nodejs_latest,
  importNpmLock,
  formats,
  runCommand,
  compressDrvWeb,
  brotli,
  # written to config.json, see the README for the available options
  settings ? { },
}:
let
  # Overriding the settings only rewrites config.json without rebuilding the app.
  dist = buildNpmPackage (finalAttrs: {
    inherit (finalAttrs.npmDeps) pname version;
    inherit (importNpmLock) npmConfigHook;
    nodejs = nodejs_latest;
    # read from the repo since `nix flake check --no-build` does not realise the filtered source
    npmDeps = importNpmLock {
      package = lib.importJSON ../package.json;
      packageLock = lib.importJSON ../package-lock.json;
    };

    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../index.html
        ../package-lock.json
        ../package.json
        ../src
        ../tsconfig.json
        ../vite.config.ts
        ../vite.icons.ts
        ../vite.licenses.ts
      ];
    };

    installPhase = ''
      runHook preInstall
      cp -r dist "$out"
      runHook postInstall
    '';

    meta = {
      description = "Private browser-only chat interface for OpenAI-compatible inference servers";
      homepage = "https://github.com/mirkolenz/bearchat";
      license = lib.licenses.mit;
      maintainers = with lib.maintainers; [ mirkolenz ];
    };
  });
  # Brotli copies for servers such as Caddy with `precompressed br`,
  # leaving out the default gzip, which takes minutes for the WebAssembly of the Python tool.
  compressed = compressDrvWeb dist {
    extraFormats = [ "wasm" ];
    compressors.br = "${lib.getExe brotli} --keep --no-copy-stat {}";
  };
  configFile = (formats.json { }).generate "config.json" settings;
in
runCommand dist.name { inherit (dist) meta; } ''
  cp -rs --no-preserve=mode ${compressed} "$out"
  cp ${configFile} "$out/config.json"
''
