{
  inputs,
  self,
  lib,
  ...
}:
{
  imports = [
    inputs.treefmt-nix.flakeModule
  ];
  systems = import inputs.systems;

  flake.nixosModules.default = lib.modules.importApply ./module.nix self.packages;

  perSystem =
    {
      pkgs,
      config,
      ...
    }:
    {
      devShells.default = pkgs.callPackage ./shell.nix {
        treefmt = config.treefmt.build.wrapper;
      };
      checks = config.packages // {
        nixos = pkgs.callPackage ./test.nix { module = self.nixosModules.default; };
      };
      packages.default = pkgs.callPackage ./package.nix { };
      treefmt = {
        projectRootFile = "flake.nix";
        programs = {
          nixfmt.enable = true;
          oxfmt.enable = true;
        };
        # .oxfmtrc.json ignores the generated files, which treefmt may pass on their own
        settings.formatter.oxfmt.options = [ "--no-error-on-unmatched-pattern" ];
      };
    };
}
