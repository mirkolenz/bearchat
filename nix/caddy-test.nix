# Runs the Caddy routes of the NixOS module in the build sandbox,
# in front of a stand-in API that accepts the token `secret` and echoes the credentials it receives.
{
  nixos,
  runCommand,
  writeText,
  caddy,
  curl,
  jq,
  module,
}:
let
  virtualHost = "http://localhost:8080";
  system = nixos {
    imports = [ module ];
    services.bearchat = {
      enable = true;
      inherit virtualHost;
      path = "/chat";
      redirectRoot = true;
      upstream = "localhost:8081";
    };
  };
  caddyfile = writeText "Caddyfile" ''
    {
      admin off
    }
    ${virtualHost} {
      ${system.config.services.caddy.virtualHosts.${virtualHost}.extraConfig}
    }
    http://localhost:8081 {
      @authorized header Authorization "Bearer secret"
      handle @authorized {
        respond "{http.request.header.Authorization}|{http.request.header.Cookie}"
      }
      respond 401
    }
  '';
in
runCommand "bearchat-caddy-test"
  {
    # the Darwin sandbox blocks localhost connections without it
    __darwinAllowLocalNetworking = true;
    nativeBuildInputs = [
      caddy
      curl
      jq
    ];
  }
  ''
    export HOME=$TMPDIR
    caddy run --adapter caddyfile --config ${caddyfile} &
    caddy=$!
    tries=0
    # fails if Caddy exits or is not ready within ten seconds
    until curl --silent --output /dev/null http://localhost:8080; do
      kill -0 $caddy
      (( ++tries < 100 ))
      sleep 0.1
    done
    get() { curl --silent --header 'Sec-Fetch-Site: same-origin' "$@"; }
    login() {
      local token=$1
      shift
      get --request POST --header "X-BearChat-Token: $token" --output /dev/null "$@" http://localhost:8080/chat/auth/login
    }
    models() { curl --silent --header "Sec-Fetch-Site: $1" --header 'Cookie: __Host-bearchat=secret; other=1' http://localhost:8080/v1/models; }
    encoding() { curl --silent --header 'Accept-Encoding: br, gzip' --output /dev/null --write-out '%header{content-encoding} %header{cache-control}' "http://localhost:8080/chat/$1"; }
    wasm=$(cd ${system.config.services.bearchat.package}/assets && echo monty.component.core-*.wasm)

    test "$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' http://localhost:8080/)" = '302 http://localhost:8080/chat/'
    test "$(curl --silent --request POST --output /dev/null --write-out '%{http_code} %{redirect_url}' http://localhost:8080/)" = '200 '
    get http://localhost:8080/chat/config.json | jq --exit-status '.auth == "cookie"'
    test "$(login secret --write-out '%header{set-cookie}')" = '__Host-bearchat=secret; Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Strict'
    test "$(login wrong --write-out '%{http_code}')" = 401
    test "$(curl --silent --request POST --header 'Sec-Fetch-Site: cross-site' --header 'X-BearChat-Token: secret' --output /dev/null --write-out '%{http_code}' http://localhost:8080/chat/auth/login)" = 400
    test "$(models same-origin)" = 'Bearer secret|'
    test "$(models cross-site)" = ""
    test "$(encoding)" = 'br no-store'
    test "$(encoding "assets/$wasm")" = 'br public, max-age=31536000, immutable'
    test "$(encoding assets/missing.js)" = ' no-store'

    kill $caddy
    touch $out
  ''
