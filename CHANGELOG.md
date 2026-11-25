# Changelog

## [1.0.6](https://github.com/mirkolenz/bearchat/compare/v1.0.5...v1.0.6) (2026-11-25)

### Bug Fixes

* disable zod jit to avoid csp eval violation ([2a908d8](https://github.com/mirkolenz/bearchat/commit/2a908d8af9839214458e13151f282f22a0e99aaa))

## [1.0.5](https://github.com/mirkolenz/bearchat/compare/v1.0.4...v1.0.5) (2026-11-25)

### Bug Fixes

* **nix:** add option to redirect the root to bearchat ([4a3e8df](https://github.com/mirkolenz/bearchat/commit/4a3e8dfc996d464673c23018806edd1cf03020ce))
* **nix:** normalize slashes of path options ([628bb43](https://github.com/mirkolenz/bearchat/commit/628bb43144e2e70c5019329e2c54dba9cf36d460))

## [1.0.4](https://github.com/mirkolenz/bearchat/compare/v1.0.3...v1.0.4) (2026-11-24)

### Performance Improvements

* **convert:** preload document converter once files are about to be added ([23f791d](https://github.com/mirkolenz/bearchat/commit/23f791db17099f7ee17fd9e86aecdabd6a1eac2c))
* **nix:** serve build precompressed with brotli ([ce15ecf](https://github.com/mirkolenz/bearchat/commit/ce15ecfca8dd4abfd56776c4da90b66f4ff9fed0))
* **python:** preload sandbox at app start ([70e9d37](https://github.com/mirkolenz/bearchat/commit/70e9d3793ce695a3439f1cabe7432fcc33dd924a))

## [1.0.3](https://github.com/mirkolenz/bearchat/compare/v1.0.2...v1.0.3) (2026-11-23)

### Bug Fixes

* **app:** name browser tab after shown chat ([882e7cb](https://github.com/mirkolenz/bearchat/commit/882e7cb1e391f0ee2ca89e501644748790073e48))
* **route:** leave chat once it is deleted, also from other tabs ([e7ff37c](https://github.com/mirkolenz/bearchat/commit/e7ff37c720161706866d9d2b271eafb722d6dd02))
* **sidebar:** add bulk delete, export and download for chats and files ([354dc20](https://github.com/mirkolenz/bearchat/commit/354dc209dde9f1af6116dfa1df79c15f7e4b7b6b))
* **sidebar:** close mobile sidebar on every navigation ([151f7b2](https://github.com/mirkolenz/bearchat/commit/151f7b25b1e7f24e1b43a12d5f83fd3a551e412c))

## [1.0.2](https://github.com/mirkolenz/bearchat/compare/v1.0.1...v1.0.2) (2026-11-23)

### Bug Fixes

* **blobs:** keep only unsaved blobs in memory ([03e3eab](https://github.com/mirkolenz/bearchat/commit/03e3eab9c7a64b865aa0a28f78c15052c8eabdc2))
* **chat:** settle unfinished tool calls of stopped replies ([8041fc9](https://github.com/mirkolenz/bearchat/commit/8041fc9f5aa2bb3e56f9ac61d8604ddc0b77801d))
* **connection:** reject server URLs with query or fragment ([4398dcc](https://github.com/mirkolenz/bearchat/commit/4398dccf697388120e5c0474608f8f49b0c8a6cd))
* **connection:** time out model listing so startup cannot stall ([8e0ff11](https://github.com/mirkolenz/bearchat/commit/8e0ff118692b2b984d0a82d10651752d93bfaacc))
* **convert:** keep downscaled images at least one pixel wide ([5273072](https://github.com/mirkolenz/bearchat/commit/527307291a0240bcdaacc41c92db1494fa0d9c4e))
* **logo:** redesign as bear-shaped chat bubble ([1b552a3](https://github.com/mirkolenz/bearchat/commit/1b552a3703ee9d018a8fad8877fb210619ba561f))
* **mcp:** bind tool approvals to requesting server ([4f7a278](https://github.com/mirkolenz/bearchat/commit/4f7a2783ba501a9ebec215f47a456bec58ee5526))
* **mcp:** dismiss input requests once their tool calls end ([14bf072](https://github.com/mirkolenz/bearchat/commit/14bf0724e95c3336112deb9f37e6048341ef63fc))
* **mcp:** enforce selection limits in input forms ([f44c092](https://github.com/mirkolenz/bearchat/commit/f44c0920c624907f6041934561c714ab750a18a4))
* **mcp:** report tool results with error flag as failures ([13b6396](https://github.com/mirkolenz/bearchat/commit/13b639680311efcf0fc7f677445025c8319330cd))
* **mcp:** skip tool listing for servers without tools ([fca80ef](https://github.com/mirkolenz/bearchat/commit/fca80efd85fac95ab98bbdae5d8ce3006ef5d5f4))
* **pwa:** make app installable with rendered icons ([4265409](https://github.com/mirkolenz/bearchat/commit/4265409c4611943f2f995a44c73a849f50157064))
* **python:** keep chat state and run stored scripts ([ee0da2c](https://github.com/mirkolenz/bearchat/commit/ee0da2ce12610044f328f892ce52c3992619bd4c))
* **sidebar:** hide sign-out for fixed server without token ([d8d32d2](https://github.com/mirkolenz/bearchat/commit/d8d32d202403baa30f38c1908c626182130ac55d))
* **threads:** continue in fork when another tab saved chat ([b095a8c](https://github.com/mirkolenz/bearchat/commit/b095a8c4e43e2198cc5f0c267f9a2ac13c80c0a5))
* **tools:** describe all tool parameters ([7cf0388](https://github.com/mirkolenz/bearchat/commit/7cf0388b328f7f723a57c6a55cd68f8ce4b26a71))

## [1.0.1](https://github.com/mirkolenz/bearchat/compare/v1.0.0...v1.0.1) (2026-11-21)

### Bug Fixes

* **chat:** follow streaming replies ([69c5818](https://github.com/mirkolenz/bearchat/commit/69c581819982ec7be3e8c63dabebee93c1699c8e))

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
