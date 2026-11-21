# BearChat

A minimal chat interface for OpenAI-compatible inference servers such as vLLM, [llmhop](https://github.com/mirkolenz/llmhop), or OpenRouter.
It runs entirely in the browser, so any static file server can host it.

## Features

- Streaming responses with reasoning, Markdown, code highlighting, math, and Mermaid diagrams.
- Attachments of images, documents and text files, dictation and read aloud.
  Images are downscaled to JPEG, and documents such as PDF, Word, PowerPoint, Excel, OpenDocument, RTF and EPUB are converted to Markdown in the browser with [anydoc](https://github.com/firecrawl/anydoc), while other binary files are rejected.
- Editing, retrying, continuing, forking and deleting messages.
- Per-chat model, reasoning effort and tool execution mode, plus custom instructions and request options.
- Tools that run in the browser: a Python sandbox, private files with line ranges, exact edits and image viewing, and search in the saved chats, plus MCP servers chosen by the user or operator.
  The files are managed in the sidebar, where uploads are converted like attachments, and text files are available to Python through `pathlib` and `os`.
  Attachments belong to a single chat, while files persist across chats.
- User messages start with the time they were sent, which keeps the system prompt free of changing values, so servers can reuse the cached prompt prefix.
- MCP servers over the stateless protocol revision 2026-07-28: tools, server instructions, resources and resource templates attached from the paperclip and converted like attachments, prompts inserted with `/`, completions for their arguments, and forms when a server asks for input.
- Token usage, generation speed and context usage per reply.
- Chats are stored in IndexedDB, and can be searched, exported and imported.
  Messages reference binary content such as attachments and images in tool results, which is stored once per content and only sent to the model as part of a request.
  Exports embed their attachments and follow `backup.schema.json`, and temporary chats are never stored.
- Exporting, importing and resetting the data in the browser need no server, so they are available in the settings, on the sign-in screen, and when the app fails to start.
  Resetting deletes all chats, files and settings and signs out.

## Development

```sh
nix develop  # installs the npm dependencies
npm run dev
```

With `BEARCHAT_PROXY=http://localhost:8080 npm run dev`, the dev server proxies `/v1` to that server and serves a matching `config.json`, so the app talks to it on the same origin without cross-origin requests.

## Configuration

The operator configures a deployment through an optional `config.json` next to `index.html`.
All options are optional, and unknown keys are rejected.
Each build ships `config.schema.json`, so editors validate the file when it starts with `"$schema": "./config.schema.json"`.

| Option     | Default      | Description                                                                          |
| ---------- | ------------ | ------------------------------------------------------------------------------------ |
| `title`    | `"BearChat"` | Name shown in the interface.                                                         |
| `baseURL`  | unset        | Inference endpoint such as `"/v1"`. Users enter one themselves if unset.             |
| `auth`     | `"token"`    | `"token"` keeps the token in `sessionStorage`, `"cookie"` delegates it to the proxy. |
| `models`   | unset        | Allowlist of model ids to show, in this order. All listed models are shown if unset. |
| `defaults` | `{}`         | Settings that users start from and can change, see below.                            |
| `locked`   | `{}`         | Settings fixed to these values, whose controls are hidden.                           |

The build uses relative paths, so it can be served under any path such as `/chat/` without rebuilding.

### Settings

Settings are resolved from these layers, later ones take precedence:

1. **Defaults**, the built-in values below overridden by `defaults` in `config.json`.
2. **User** values changed in this browser, stored in `localStorage`.
3. **Chat** values stored with each chat, for the model, reasoning effort and tool execution mode.
4. **Locked** values from `locked` in `config.json`, which prevent accidental changes.
   A locked model that the server does not serve stops the sign-in instead of being ignored.

| Setting        | Built-in             | Description                                                                                  |
| -------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `model`        | first listed model   | Model of new chats.                                                                          |
| `reasoning`    | `"provider-default"` | Reasoning effort: `provider-default`, `none`, `minimal`, `low` to `high`, `xhigh`, `max`.    |
| `mode`         | `"ask"`              | MCP tools with side effects: `allow`, `ask` for approval, `deny`. Built-in tools always run. |
| `instructions` | `""`                 | Custom instructions added to the system prompt.                                              |
| `requestBody`  | `{}`                 | JSON merged into every request, e.g. `{"top_k": 20}`.                                        |
| `pythonTool`   | `true`               | Python sandbox, running [Monty](https://github.com/pydantic/monty) in the browser.           |
| `fileTools`    | `true`               | Text and image files in the browser's private storage, managed in the sidebar.               |
| `chatTools`    | `true`               | Searching and reading the other saved chats.                                                 |
| `mcpServers`   | `{}`                 | MCP servers by name, e.g. `{"docs": {"url": "https://example.org/mcp"}}`, see below.         |

MCP servers must allow cross-origin requests and need no authentication.
Their names have up to 16 letters, digits or hyphens, and prefix the server's tools, such as `docs__search`.
Each server can be switched off with `"enabled": false`.

Tools need a server with tool calling, for example vLLM with `--enable-auto-tool-choice` and a `--tool-call-parser`.

## Nix

```nix
bearchat.packages.${system}.default.override {
  settings = {
    baseURL = "/v1";
    locked.instructions = "Answer in English.";
  };
}
```

The `settings` argument is written to `config.json`, so changing it does not rebuild the app.

## Deployment

The browser talks to the inference server directly, so the server either has to be on the same origin or allow cross-origin requests.
Without a `config.json`, BearChat runs on any static file server, for example `npm run build && npm run preview`, and users enter the server themselves, such as `https://openrouter.ai/api/v1`, which allows cross-origin requests.
Every release deploys such a demo to [GitHub Pages](https://mirkolenz.github.io/bearchat/).
The recommended setup serves BearChat and the inference server from the same origin behind Caddy.
There, Caddy stores the token in an `HttpOnly` cookie, so scripts never see it and it cannot be stolen through cross-site scripting.

The NixOS module sets this up, for example next to llmhop:

```nix
{
  imports = [ bearchat.nixosModules.default ];
  services.bearchat = {
    enable = true;
    virtualHost = "example.org";
    path = "/chat";
    upstream = "unix/${config.services.llmhop.gateway.llmhop.listen.caddy.socket}";
  };
}
```

Clients that send their own `Authorization` header, such as API scripts, are unaffected.
For other web servers, [`nix/module.nix`](nix/module.nix) shows the required routes.

## Security

- The build embeds a strict Content Security Policy that only allows scripts from the app itself.
  It permits WebAssembly for the Python sandbox, which has no access to the network or the page.
  It also blocks remote images, so model output cannot leak chat contents through image URLs.
  A stricter policy set by the web server applies in addition, such as `connect-src 'self'` if no remote MCP servers are used.
- In token mode, the token is bound to the server it was entered for and is never written to IndexedDB or exports.
- Since the login request carries a custom header, browsers refuse to send it from other sites.
- In cookie mode, every page of the same origin can use the session, so serve BearChat from a host without other apps.
- `config.json` is for convenience, not access control, so access to models has to be enforced by the inference server.
- Imported chats never carry a tool execution mode, and their approved but unexecuted tool calls are denied, so a shared backup cannot approve tools on its own.
- MCP tools are prefixed with their server name, such as `docs__search`, so no tool can replace another or inherit its approval.
- Dictation only runs on-device, so audio never leaves the browser.
