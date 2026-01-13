{
  description = "Gambit development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgs-unstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        unstablePkgs = import nixpkgs-unstable {
          inherit system;
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            unstablePkgs.deno
            pkgs.nodejs_24
          ];
        };
      });
}
