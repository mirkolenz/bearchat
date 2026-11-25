# Runs the NixOS module in a VM,
# in front of a stand-in API that accepts the token `secret` and echoes the credentials it receives.
{ testers, module }:
testers.runNixOSTest {
  name = "bearchat";
  nodes.machine = {
    imports = [ module ];
    services.bearchat = {
      enable = true;
      virtualHost = "http://localhost";
      path = "/chat";
      redirectRoot = true;
      upstream = "localhost:8081";
    };
    services.caddy.virtualHosts."http://localhost:8081".extraConfig = ''
      @authorized header Authorization "Bearer secret"
      handle @authorized {
        respond "{http.request.header.Authorization}|{http.request.header.Cookie}"
      }
      respond 401
    '';
  };
  testScript =
    { nodes, ... }:
    ''
      from json import loads
      from shlex import join

      def curl(path: str, *args: str, out: str | None = None) -> str:
          """The body of a request to the path, or the write-out `out` instead."""
          write = ["--output", "/dev/null", "--write-out", out] if out else []
          return machine.succeed(join(["curl", "--silent", "--max-time", "5", *write, *args, f"http://localhost{path}"]))

      def login(token: str, site: str = "same-origin", out: str = "%{http_code}") -> str:
          return curl("/chat/auth/login", "--request", "POST", "--header", f"Sec-Fetch-Site: {site}", "--header", f"X-BearChat-Token: {token}", out=out)

      def models(site: str) -> str:
          return curl("/v1/models", "--header", f"Sec-Fetch-Site: {site}", "--header", "Cookie: __Host-bearchat=secret; other=1")

      def caching(path: str) -> str:
          return curl(f"/chat/{path}", "--header", "Accept-Encoding: br, gzip", out="%header{content-encoding} %header{cache-control}")

      machine.wait_for_open_port(80)
      wasm = machine.succeed("basename ${nodes.machine.services.bearchat.package}/assets/monty.component.core-*.wasm").strip()

      t.assertEqual(curl("/", out="%{http_code} %{redirect_url}"), "302 http://localhost/chat/")
      t.assertEqual(curl("/", "--request", "POST", out="%{http_code}"), "200")
      t.assertEqual(loads(curl("/chat/config.json"))["auth"], "cookie")
      t.assertEqual(login("secret", out="%header{set-cookie}"), "__Host-bearchat=secret; Max-Age=43200; Path=/; Secure; HttpOnly; SameSite=Strict")
      t.assertEqual(login("wrong"), "401")
      t.assertEqual(login("secret", site="cross-site"), "400")
      t.assertEqual(models("same-origin"), "Bearer secret|")
      t.assertEqual(models("cross-site"), "")
      t.assertEqual(caching(""), "br no-store")
      t.assertEqual(caching(f"assets/{wasm}"), "br public, max-age=31536000, immutable")
      t.assertEqual(caching("assets/missing.js"), " no-store")
    '';
}
