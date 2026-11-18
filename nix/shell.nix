{
  treefmt,
  mkShell,
  nodejs_latest,
  lib,
}:
mkShell {
  shellHook = ''
    ${lib.getExe' nodejs_latest "npm"} install
  '';
  packages = [
    nodejs_latest
    treefmt
  ];
}
