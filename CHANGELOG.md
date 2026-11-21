# Changelog

## 1.0.0 (2026-11-21)

### Features

* add chat search and file tools, document conversion and blob storage ([68337a2](https://github.com/mirkolenz/bearchat/commit/68337a2573cbfa8105b9f395651dd2988e7f740f))
* add data section with export, import and reset to settings, sign-in and startup failure ([adb8a90](https://github.com/mirkolenz/bearchat/commit/adb8a905f7a0454ac19786731c97e0c3153d4caa))
* initial commit ([f343d7e](https://github.com/mirkolenz/bearchat/commit/f343d7e3090cc6ecfb8765c7b2040c97dd591d93))
* support phones, tablets and desktops with touch-sized controls and keyboard-aware layout ([b361cb8](https://github.com/mirkolenz/bearchat/commit/b361cb827c48ffe44fa8975c461ea44bc8a8bbfc))

### Bug Fixes

* **chat:** number converted uploads and apply edits to current chat state ([054c4eb](https://github.com/mirkolenz/bearchat/commit/054c4eba1f09bf334abe217a2109dd36f175a5e4))
* **mcp:** relist expired tools, keep structured content and send date-times with offset ([1bfcb8f](https://github.com/mirkolenz/bearchat/commit/1bfcb8f00e42e1949c1278331ee7a52aca3b00e5))
* reload on sign-out, apply default model and load temporal for startup failure ([dd3626e](https://github.com/mirkolenz/bearchat/commit/dd3626ed08c28e65610cd8b48b942a69f0efc8ed))
* **route:** stop intercepting page reloads ([5618b01](https://github.com/mirkolenz/bearchat/commit/5618b01ddaaaa8d3b86d4ef6042d51d01ae9d687))
* **threads:** check revisions on save, deny imported approvals and validate chat ids ([739266e](https://github.com/mirkolenz/bearchat/commit/739266e8a6bb672313e4889d148b1fcc8dbc0bea))

### Performance Improvements

* lazy-load markdown, memoize chat rendering, save chats incrementally and harden mcp ([31fceb1](https://github.com/mirkolenz/bearchat/commit/31fceb17e8ea2f2a0c118d28ab034ef21c8b811c))
