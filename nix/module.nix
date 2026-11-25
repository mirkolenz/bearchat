# BearChat served by Caddy, optionally next to an OpenAI-compatible API on the same host.
packages:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) mkOption types;
  cfg = config.services.bearchat;
  proxied = cfg.upstream != null;
  cookie = "__Host-bearchat";
  cookieAttributes = "Path=/; Secure; HttpOnly; SameSite=Strict";
  maxAge = lib.optionalString (
    cfg.sessionDuration != null
  ) "Max-Age=${toString cfg.sessionDuration}; ";
  # a leading slash without a trailing one, empty for the root
  normalizePath = path: lib.removeSuffix "/" (lib.strings.normalizePath "/${path}");
in
{
  options.services.bearchat = {
    enable = lib.mkEnableOption "BearChat, served by Caddy";
    package = mkOption {
      type = types.package;
      default = packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "bearchat.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "BearChat package to serve.";
    };
    virtualHost = mkOption {
      type = types.str;
      example = "example.org";
      description = "Caddy virtual host that serves BearChat, created if it does not exist yet.";
    };
    path = mkOption {
      type = types.str;
      default = "/";
      example = "/chat";
      apply = normalizePath;
      description = "URL path of BearChat, such as `/chat`.";
    };
    redirectRoot = lib.mkEnableOption "redirecting `GET` and `HEAD` requests of the root to `path`, while other methods pass through to an API served at the root such as llmhop";
    upstream = mkOption {
      type = with types; nullOr str;
      default = null;
      example = lib.literalExpression ''"unix/''${config.services.llmhop.gateway.listen.default.socket}"'';
      description = ''
        Caddy upstream of an OpenAI-compatible API such as llmhop, served under `apiPath`.
        If set, BearChat uses this API and Caddy stores the user's token in an `HttpOnly` cookie
        once the API accepted it, which is only used for same-origin requests.
        Requests that bring their own `Authorization` header are passed through unchanged.
      '';
    };
    sessionDuration = mkOption {
      type = with types; nullOr ints.positive;
      default = 12 * 60 * 60;
      description = "Seconds until the session cookie expires, `null` keeps it until the browser closes.";
    };
    apiPath = mkOption {
      type = types.str;
      default = "/v1";
      apply = normalizePath;
      description = "URL path of the API proxied to `upstream`, which is forwarded unchanged.";
    };
    settings = mkOption {
      type = (pkgs.formats.json { }).type;
      default = { };
      example = {
        title = "Inference";
        models = [ "qwen3-8b" ];
      };
      description = ''
        Contents of `config.json`, see the README for the available options.
        `baseURL` and `auth` are set automatically if `upstream` is set.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.redirectRoot -> cfg.path != "";
        message = "services.bearchat.redirectRoot requires services.bearchat.path to be other than the root.";
      }
      {
        assertion = cfg.apiPath != "";
        message = "services.bearchat.apiPath must be other than the root.";
      }
    ];

    services.bearchat.settings = lib.mkIf proxied {
      baseURL = cfg.apiPath;
      auth = "cookie";
    };

    services.caddy = {
      enable = lib.mkDefault true;
      virtualHosts.${cfg.virtualHost}.extraConfig = ''
        ${lib.optionalString (cfg.path != "") "redir ${cfg.path} ${cfg.path}/"}
        ${lib.optionalString cfg.redirectRoot ''
          @bearchat_root {
            method GET HEAD
            path /
          }
          redir @bearchat_root ${cfg.path}/
        ''}
        handle_path ${cfg.path}/* {
          ${lib.optionalString proxied ''
            @bearchat_login {
              method POST
              path /auth/login
              header Sec-Fetch-Site same-origin
              header_regexp token X-BearChat-Token ^[\w.~+/=-]+$
            }
            # the token is only stored after the API accepted it
            handle @bearchat_login {
              method GET
              rewrite * ${cfg.apiPath}/models
              request_header Authorization "Bearer {re.token.0}"
              request_header -Cookie
              request_header -X-BearChat-Token
              reverse_proxy ${cfg.upstream} {
                @accepted status 2xx
                handle_response @accepted {
                  header Set-Cookie "${cookie}={re.token.0}; ${maxAge}${cookieAttributes}"
                  respond 204
                }
                @rejected status 401 403
                handle_response @rejected {
                  respond 401
                }
              }
            }
            @bearchat_logout {
              method POST
              path /auth/logout
              header Sec-Fetch-Site same-origin
            }
            handle @bearchat_logout {
              header Set-Cookie "${cookie}=; Max-Age=0; ${cookieAttributes}"
              respond 204
            }
            handle /auth/* {
              respond 400
            }
          ''}
          handle {
            root * ${cfg.package.override { inherit (cfg) settings; }}
            encode
            # store paths share one modification time, so these would not change between versions
            header {
              -ETag
              -Last-Modified
              ?Cache-Control "no-store"
              Content-Security-Policy "frame-ancestors 'none'"
              Cross-Origin-Opener-Policy same-origin
              X-Content-Type-Options nosniff
            }
            header /assets/* Cache-Control "public, max-age=31536000, immutable"
            # the Brotli files of the build, others such as config.json are compressed by encode
            file_server {
              precompressed br
            }
          }
        }
        ${lib.optionalString proxied ''
          handle ${cfg.apiPath}/* {
            @bearchat_session {
              header Sec-Fetch-Site same-origin
              expression {http.request.cookie.${cookie}} != ""
              not header Authorization *
            }
            request_header @bearchat_session Authorization "Bearer {http.request.cookie.${cookie}}"
            request_header -Cookie
            reverse_proxy ${cfg.upstream}
          }
        ''}
      '';
    };
  };

  meta.maintainers = with lib.maintainers; [ mirkolenz ];
}
