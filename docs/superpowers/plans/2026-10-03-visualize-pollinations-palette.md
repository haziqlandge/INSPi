# Visualize, Pollinations analysis, palette roll, retry model picker: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate images from image entries (Visualize button and a `/visualize` tab) through a one-backend Pollinations router; add Pollinations as a fifth analysis provider; add a measured 7-colour palette with lock-and-roll; and let a retry choose its own provider and models.

**Architecture:**
- Image generation lives in `src/lib/imagine/`, one adapter per backend behind `POST /api/imagine`, with renders stored in a new `renders` table and files in the entry's media folder.
- Pollinations analysis is one more OpenAI-compatible registry entry.
- The palette is computed locally with sharp and k-means in OKLab. Roll runs locally (culori harmony) or through Colormind via a server route.
- New motion pieces go into one FX library file whose top comment is a generated index: component, what it does, line.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Motion, anime.js 4, node:sqlite, sharp, Vitest, `culori` (new dependency).

**Spec:** `docs/superpowers/specs/2026-10-03-visualize-pollinations-palette-design.md`

## Global Constraints
- Free only; models with `paid_only: true` are never listed.
- One backend and one model per image request, and one provider per analysis. No fallback to another service or model. A same-provider `_FALLBACK` key is fine.
- Never test-call image or Pollinations chat models from the agent (it spends the user's Pollen). Reading the catalogue (`/image/models`, `/text/models`) and the UI preview is fine.
- OpenRouter ids go out without `:free` (`requestModelId`, done).
- Visualize appears only on entries with `mode === 'image'`.
- `POLLINATIONS_API_KEY` stays server-side; nothing under `src/components` or `src/lib/client` may read it.
- Write routes call `crossOrigin(request)` first, like the existing ones.
- Pages work at 375, 768 and 1280 px in light and dark, with no horizontal scroll. Motion respects `prefers-reduced-motion`.
- No git commits unless the user asks (BUILDLOG ruling). The plan's "Commit" steps become "stage nothing, note in BUILDLOG".

## Review Focus
1. **A prompt with `/`, `?`, `#` or more than 2,000 characters** sent to `/image/{prompt}`. Expected: it is encoded with `encodeURIComponent` and cut to 1,800 characters, so it neither breaks the URL nor gets a 414. Test in Task 2.
2. **Pollinations answers 200 but with a JSON error or an HTML page instead of an image.** Expected: "Pollinations did not return an image", and nothing is saved. Test in Task 2.
3. **An entry deleted while its render is in flight.** Expected: the render is discarded, with no orphan row and no file under a purged folder. Test in Task 3.
4. **Pressing Roll with all 7 colours locked**, or with a 1×1 or fully transparent image. Expected: Roll is disabled when all are locked, and extraction returns fewer swatches without throwing. Tests in Tasks 8 and 9.
5. **A retry `run` naming a provider without keys, or a model id with spaces or newlines.** Expected: a 400 with a plain message, and nothing queued. Test in Task 7.

---

### Task 0: FX library and its index

**Files:**
- Create: `src/components/fx/library.tsx`, `scripts/fx-index.mjs`
- Modify: `package.json` (script `"fx:index": "node scripts/fx-index.mjs"`)
- Test: `tests/fx-index.test.ts`

**Interfaces:**
- Produces: `library.tsx` starts with a block comment between `/* FX-INDEX:START` and `FX-INDEX:END */`. Each line reads `Name — what it does — line N — source (React Bits / UI Layouts / recreated from <url>)`. Each component is preceded by a `/** @fx Name | one-line purpose | source */` tag. `fx-index.mjs` rewrites the block from those tags with the right line numbers. Running it twice changes nothing.
- Later tasks add components to this file and rerun `npm run fx:index`.

- [x] **Step 1: Write the failing test.** `tests/fx-index.test.ts` imports `buildIndex(source: string): string` from `scripts/fx-index.mjs`. Given a source with two `@fx` tags, the block lists both with their real line numbers (after the block is inserted), and `buildIndex(buildIndex(s)) === buildIndex(s)`.
- [x] **Step 2: Run `npx vitest run tests/fx-index.test.ts`.** It fails: the module is not found.
- [x] **Step 3: Implement `buildIndex`** plus a CLI that rewrites `src/components/fx/library.tsx` in place. Seed `library.tsx` with `'use client'`, the empty index block, and one component, `HealthDot` (a pulsing dot coloured by `'healthy' | 'degraded' | 'unknown'`, with a static dot under reduced motion).
- [x] **Step 4: Run the test.** It passes. Running `npm run fx:index` twice leaves the file unchanged.
- [x] **Step 5: Before each later UI task, research** with the UI Layouts MCP (`search_components` / `get_source_code`), React Bits and Firecrawl. Paid components may be studied from screenshots, frame by frame, and recreated. Record the source in the `@fx` tag.

### Task 1: Pollinations catalogue and image backends

**Files:**
- Create: `src/lib/imagine/types.ts`, `src/lib/imagine/catalog.ts`, `src/lib/imagine/backends.ts`, `src/lib/imagine/size.ts`
- Test: `tests/imagine.test.ts`, fixture `tests/fixtures/pollinations-image-models.json` (trim the real `/image/models` to about 12 entries: official free, official paid-only, community free, community paid-only, one video model)

**Interfaces:**
- Produces:
  - `type BackendId = 'pollinations' | 'pollinations-community' | 'keyless-url'`
  - `interface ImageModel { id: string; label: string; acceptsImage: boolean; health: 'healthy' | 'degraded' | 'unknown'; successRate: number | null }`
  - `interface ImagineRequest { prompt: string; negative?: string; width: number; height: number; seed?: number; model: string }`
  - `class ImagineError extends Error { kind: 'auth' | 'no_pollen' | 'rate_limit' | 'not_image' | 'network' | 'server'; status: number | null }`
  - `splitImageModels(raw: unknown[]): { official: ImageModel[]; community: ImageModel[] }`
  - `imageModels(backend: BackendId, fetchImpl?: typeof fetch): Promise<ImageModel[]>`: a 10-minute in-memory cache. `keyless-url` returns `[{ id: 'default', label: 'Default', … health 'unknown' }]`.
  - `generateImage(backend: BackendId, req: ImagineRequest, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): Promise<{ bytes: Buffer; contentType: string }>`
  - `imageUrl(backend: BackendId, req: ImagineRequest): string`
  - `backendAvailable(backend: BackendId, env?): boolean`
  - `sizeFor(aspect: string | undefined, long = 1024): { width: number; height: number }`

- [x] **Step 1: Write the failing tests**, named:
  - `splitImageModels drops paid_only and non-image models and splits community`: from the fixture, no id with `paid_only: true`, no video model, and community ids start with `community/`.
  - `sizeFor`: `'3:2'` gives `{width:1024,height:688}` (682.7 rounded up to a multiple of 16); `'9:16'` gives `{width:576,height:1024}`; `undefined` or junk gives `1024×1024`.
  - `imageUrl`:
    - The pollinations URL is `https://gen.pollinations.ai/image/<encoded>?model=…&width=…&height=…` and includes `seed` only when set.
    - The negative is appended to the prompt as `\n\nAvoid: a, b`.
    - A prompt containing `/?#` survives encoding, and a 3,000-character prompt is cut to 1,800 characters before encoding.
    - The keyless URL starts with `https://image.pollinations.ai/prompt/` and has `nologo=true`.
  - `generateImage maps errors`: a fake fetch returning 401, 402, 429 or 500 gives `ImagineError` with kinds `auth`, `no_pollen`, `rate_limit` and `server`, and the message includes the body's `error.message`. A 200 with `content-type: application/json` or `text/html` gives `not_image`. The pollinations backends send `authorization: Bearer <key>`; keyless sends none.
- [x] **Step 2: Run `npx vitest run tests/imagine.test.ts`.** It fails.
- [x] **Step 3: Implement.** Error messages are plain:
  - `auth`: "Pollinations rejected the key."
  - `no_pollen`: "Out of Pollen for now."
  - `rate_limit`: "Too many requests; wait a minute."
  - `not_image`: "Pollinations did not return an image."

  Use a 120 s `AbortSignal.timeout`. `fetch` for community models adds `?reliability=all`.
- [x] **Step 4: Run the tests.** They pass. `npm run typecheck` is clean.

### Task 2: Schema v3 (renders, palettes) and the store

**Files:**
- Modify: `src/lib/store/library.ts` (add `MIGRATE_TO_3`, run it when `version < 3`), `src/lib/types.ts`
- Test: `tests/store-renders.test.ts`

**Interfaces:**
- Produces (types):
  - `interface PaletteSwatch { hex: string; share: number }`
  - `interface SavedPalette { id: string; colors: string[]; createdAt: string }`
  - `interface Render { id: string; entryId: string | null; entrySlug: string | null; entryName: string | null; versionId: string | null; backend: BackendId; model: string; prompt: string; seed: number | null; width: number; height: number; url: string; createdAt: string }`
  - `EntryCard` gains `palette: PaletteSwatch[] | null`; `EntryDetail` gains `palettes: SavedPalette[]`.
- Produces (Library methods):
  - `addRender(input: Omit<Render, 'id' | 'url' | 'createdAt' | 'entrySlug' | 'entryName'> & { file: string }): Render | null`: returns null if `entryId` is set but that entry no longer exists or is soft-deleted.
  - `listRenders(o: { entryId?: string; backend?: BackendId; limit: number; offset: number }): Render[]`
  - `deleteRender(id: string): { file: string } | null`
  - `setPalette(entryId: string, palette: PaletteSwatch[]): void`
  - `entriesWithoutPalette(limit: number): { id: string; images: EntryImage[] }[]`
  - `savePalette(entryId: string, colors: string[]): SavedPalette[]`: newest first, capped at 12.
  - `deletePalette(entryId: string, paletteId: string): SavedPalette[]`
- The migration: `CREATE TABLE renders (...)` exactly as in the spec, plus `file TEXT NOT NULL`; `ALTER TABLE entries ADD COLUMN palette TEXT; ALTER TABLE entries ADD COLUMN palettes TEXT;`. Render URL: `/api/media/<entryId or _playground>/<file>`, with `file = render-<id>.webp`. The media route already serves two-segment `.webp` paths, and `_playground` passes `entryMediaDir`'s pattern.

- [x] **Step 1: Write the failing tests:**
  - A render added for an entry is listed newest first with the right URL.
  - `addRender` for a soft-deleted entry returns null (Review Focus 3).
  - A playground render has `entryId: null`.
  - `deleteRender` returns the file name.
  - `savePalette` keeps 12 at most, newest first.
  - Cards carry `palette` after `setPalette`.
  - `entriesWithoutPalette` skips entries that already have one.
  - An existing v2 database file migrates to v3 without losing entries.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement.** Update the row-to-card mapping for `palette`, and the detail mapping for `palettes` (copy into plain objects; node:sqlite rows have a null prototype).
- [x] **Step 4: Run them.** They pass, and the full `npm test` is green.

### Task 3: Image routes, settings and call log

**Files:**
- Create: `src/app/api/imagine/route.ts` (GET list, POST generate), `src/app/api/imagine/[id]/route.ts` (DELETE), `src/app/api/imagine/models/route.ts` (GET), `src/lib/imagine/run.ts`
- Modify: `src/lib/settings.ts` (`imagine: { backend: BackendId; model: string }`, default `{ backend: 'pollinations', model: 'flux' }`), `src/lib/store/library.ts` (`CallRecord.step` gains `'imagine'`), `src/lib/client/imagine.ts` (new browser helpers)
- Test: `tests/imagine-run.test.ts`

**Interfaces:**
- Consumes: Task 1 `generateImage`, `sizeFor`, `ImagineError`; Task 2 `addRender`, `listRenders`, `deleteRender`.
- Produces:
  - `runImagine(input: { backend: BackendId; model: string; prompt: string; negative?: string; aspect?: string; seed?: number; entryId?: string; versionId?: string }, deps?: { generate?, now? }): Promise<Render>`. It generates, converts to WebP with sharp (quality 90), writes `render-<id>.webp`, and calls `addRender`. If `addRender` returns null, it deletes the file and throws "That entry was deleted." It always records a call (`provider: 'pollinations'`, `step: 'imagine'`, tokens 0, ok/error kind).
  - `POST /api/imagine`: body as above, prompt 1–4,000 characters. 400 on bad input; 502 with the `ImagineError` message.
  - `GET /api/imagine?entryId=&backend=&offset=` returns `{ items: Render[] }`, 40 per page.
  - `GET /api/imagine/models` returns `{ backends: { id, label, available, experimental, models: ImageModel[], message }[] }`.
  - `DELETE /api/imagine/[id]` removes the row and the file.
  - Client: `visualize(body)`, `listRenders(params)`, `deleteRender(id)`, `imageBackends()`, all through `api<T>()`.

- [x] **Step 1: Write the failing tests** for `runImagine` with a fake `generate` returning a 4×4 PNG made with sharp, and a temporary `INSPI_DATA_DIR`:
  - The file exists and the render is listed.
  - The entry is deleted mid-flight (soft-delete it inside the fake generate): it throws, and no file or row remains.
  - A generate error records a call with `ok: false` and the error kind.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement the routes and the settings field.** `writeSettings` accepts `imagine` only with a known backend and a model id of 1–120 characters with no whitespace.
- [x] **Step 4: Run them.** They pass. Then `npm test` and `npm run typecheck`.

### Task 4: Visualize on the entry page

**Files:**
- Create: `src/components/entry/visualize-panel.tsx`
- Modify: `src/components/entry/entry-view.tsx` (button beside Retry at ~line 280; panel under `ImageStack` at ~line 147), `src/components/fx/library.tsx`
- Test: browser preview (no unit test: UI only, logic is in Tasks 1–3)

**Interfaces:**
- Consumes: `visualize`, `listRenders`, `deleteRender` from `src/lib/client/imagine.ts`.
- FX added:
  - **`DevelopReveal`**: a darkroom developing effect. A warm monochrome blur becomes the sharp image with a scan line and grain (anime.js timeline, about 1.4 s). While waiting it loops a "developing" shimmer.
  - **`RenderStrip`**: a horizontal snap strip of renders with lift on hover and a seed/model caption. Clicking opens the existing lightbox.

- [x] **Step 1: Research.** Look in UI Layouts and React Bits for reveal and image-strip components (e.g. image reveal, gallery strip, "Pixel Transition", "Fade Content") and pick or recreate them into `library.tsx`. Then run `npm run fx:index`.
- [x] **Step 2: Build the panel.**
  - The button appears only when `entry.mode === 'image'` and there is an active version. It sends the spec's `prompt`, `negative.join(', ')` and `params.aspect_ratio`, using the backend and model saved in Settings.
  - The panel shows the backend and model as a chip linking to `/visualize`.
  - A failure shows the error inline with "Try again". A delete on each render asks for confirmation first, using the existing Modal.
- [x] **Step 3: Check in the preview** (`preview_start`). Confirm:
  - A web entry shows no button.
  - An image entry shows the button and the renders strip.
  - No console errors at 375, 768 and 1280 in light and dark.

  Don't click Generate; the user tests generation.

### Task 5: `/visualize` tab

**Files:**
- Create: `src/app/visualize/page.tsx`, `src/components/visualize/playground.tsx`, `src/components/visualize/render-wall.tsx`, `src/components/visualize/model-select.tsx`
- Modify: `src/components/shell/header.tsx` (`LINKS` gains `{ href: '/visualize', label: 'Visualize' }`), `src/components/settings/settings-view.tsx` (an Image generation section reusing `model-select`), `src/components/fx/library.tsx`
- Test: browser preview

**Interfaces:**
- Consumes: Task 3 client helpers. `listEntries` with `mode=image` for the "Paste prompt from an entry" picker (existing `/api/entries?mode=image&q=`); the composed text is the version's `prompt` plus negative.
- FX added:
  - **`CyclingPlaceholder`**: the prompt box placeholder types and deletes example prompts.
  - **`AspectPicker`**: aspect chips, each drawn as a rectangle of that ratio that morphs as you pick (Motion `layout`).
  - **`ShutterButton`**: Generate with an aperture iris that closes and opens on click (SVG blades, anime.js).
  - **`MasonryWall`** for renders, reusing the wall's card look.

- [x] **Step 1: Research and add the FX** (as Task 4 Step 1).
- [x] **Step 2: Build the page.**
  - Desktop: playground on the left (sticky) and the wall on the right. Mobile: playground on top.
  - `model-select`: a backend segmented control (Experimental badge on keyless), then a model list with a `HealthDot` and success % for each. Unavailable backends are disabled and show their `message`.
  - The choice is saved to settings `imagine`.
  - Wall filters: All / this backend. Infinite scroll in pages of 40.
- [x] **Step 3: Check in the preview** at all widths and in both themes. Confirm the header link is current on `/visualize`, the model list loads from the real catalogue (a free read), and nothing is generated.

### Task 6: Pollinations as an analysis provider

**Files:**
- Modify: `src/lib/ai/client.ts` (`ProviderId` gains `'pollinations'`), `src/lib/ai/registry.ts` (`PROVIDER_IDS`, a `PROVIDERS.pollinations` entry), `src/lib/ai/status.ts` (drop `paid_only: true`, carry `health`), `src/lib/ai/usage.ts` (no daily limit entry), `src/components/settings/model-picker.tsx` and `src/components/shell/model-menu.tsx` (show `HealthDot`), `.env.example` (`POLLINATIONS_API_KEY_FALLBACK`), `scripts/check-providers.ts` if it switches on provider ids
- Test: `tests/pollinations-provider.test.ts`, fixture `tests/fixtures/pollinations-text-models.json` (about 10 trimmed real entries)

**Interfaces:**
- Produces:
  - `ListedModel` gains `health?: 'healthy' | 'degraded' | 'unknown'; successRate?: number | null`.
  - `PROVIDERS.pollinations`:
    - `keyEnv: ['POLLINATIONS_API_KEY']`, `baseUrl` `env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai/v1'`.
    - `vision.id: ''` and `text.id: ''`, so the user picks; with no vision id `providerChain` skips it.
    - `strict: false`, `maxTokensParam: 'max_tokens'`, `maxImages: 3`, `tokensPerImage: 1500`, `tpm: 200000`, `maxOutput: 8000`.
    - `verified: false`, and note "Free (Quest) Pollen. Community models come and go; pick one marked healthy."
  - `listModels('pollinations')` reads `${baseUrl.replace(/\/v1$/, '')}/text/models?reliability=all`.

- [x] **Step 1: Write the failing tests:**
  - `usableModels` on the fixture drops `paid_only: true` and keeps community vision models with `vision: true` and their health.
  - `providerChain(['pollinations'], {}, env)` is empty without a chosen model, and with `{ pollinations: { vision: 'community/x', text: 'community/y' } }` gives the base URL above and `strict: false`.
  - `hasKeys('pollinations', {})` is false.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement.** Fix every `Record<ProviderId, …>` the type checker flags.
- [x] **Step 4: Run them.** They pass. Then `npm test` and `npm run typecheck`. In the preview, Settings lists Pollinations with its models (a free catalogue read). Don't run an analysis.

### Task 7: Model picker in the retry dialog

**Files:**
- Modify: `src/lib/types.ts` (`interface RunChoice { provider: ProviderId; vision?: string; text?: string }`), `src/lib/ai/prompts/steer.ts` (`readSteer` unchanged; add `readRun(body, env): RunChoice | null | { error: string }`), `src/lib/store/library.ts` (`enqueueJob(entryId, kind, steer, run?: RunChoice | null)`, with `jobs.params` JSON `{ ...steer, run }`, and `Job` gains `run`), `src/app/api/entries/[id]/retry/route.ts`, `src/lib/jobs/worker.ts` (chain from `run` when present: `providerChain([run.provider], { [run.provider]: { vision: run.vision, text: run.text } })`, else settings), `src/lib/client/actions.ts` (`retryEntry(id, steer?, run?)`), `src/components/entry/retry-dialog.tsx` (a "Run with" row; `onRetry(steer, run)`)
- Test: `tests/retry-run.test.ts`

**Interfaces:**
- Consumes: `modelChoices` from `src/components/settings/model-picker.tsx`; `/api/providers/models?provider=`; `/api/settings` for the default.

- [x] **Step 1: Write the failing tests:**
  - `readRun`:
    - Valid input passes, and an OpenRouter `:free` id is stripped.
    - A provider without keys gives `{ error: 'Add … to .env' }` (Review Focus 5).
    - A model id with whitespace gives an error.
    - A missing `run` gives null.
  - `enqueueJob` and `takeJob` round-trip `run` and `steer` together.
  - Worker selection: an exported `chainFor(job, settings, env)` returns the run's provider when `run` is set and the settings' first provider otherwise.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement.** The route returns 400 with the message from `readRun` and doesn't queue. "Try again" on a failed entry passes `run` as well. The dialog defaults to the provider in use and its saved models. Changing the provider loads that provider's lists.
- [x] **Step 4: Run them.** They pass. Check in the preview that the dialog shows the row and the selects fill. Don't submit.

### Task 8: Measured palette of 7

**Files:**
- Create: `src/lib/media/palette.ts`, `scripts/palettes.ts` (`npm run palettes`)
- Modify: `src/app/api/entries/route.ts` (after ingest, compute and `setPalette`), `src/lib/jobs/worker.ts` (an idle-time backfill: `entriesWithoutPalette(1)` per idle tick before sleeping), `package.json`
- Test: `tests/palette.test.ts`

**Interfaces:**
- Produces:
  - `extractPalette(files: string[], k = 7): Promise<PaletteSwatch[]>`
  - Pure helpers, exported for tests: `kmeansOklab(pixels: Float32Array /* L,a,b triples */, k: number, seed: number): { centers: [number, number, number][]; counts: number[] }`, `rgbToOklab`, `oklabToHex`.
- Algorithm (not determined by the signature):
  - Resize each file to 96 px on the long side with sharp, `.removeAlpha()`. Skip pixels with alpha < 128 (read with `ensureAlpha` first).
  - Convert to OKLab. k-means++ seeding with a mulberry32 PRNG (`seed = 7`), then 12 iterations.
  - Merge centres closer than ΔE 0.03 and refill from the largest cluster's farthest point.
  - Shares are counts over the total; sort by share, descending.

- [x] **Step 1: Write the failing tests:**
  - Synthetic 7-colour stripes (sharp `create` composites) give 7 swatches, each within ΔE 0.02 of its source, with shares summing to 1 ± 0.001.
  - A two-colour image gives 2 swatches (Review Focus 4).
  - A fully transparent or 1×1 image gives `[]` or 1 swatch without throwing.
  - The same input gives the same output twice.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement and wire into upload and the idle backfill.** `npm run palettes` loops over `entriesWithoutPalette(50)` until it's empty and prints a count.
- [x] **Step 4: Run them.** They pass. Run `npm run palettes` once against the real library (local, free) and report the count.

### Task 9: Roll engines

**Files:**
- Create: `src/lib/palette/harmony.ts`, `src/lib/palette/colormind.ts`, `src/app/api/palette/roll/route.ts`
- Modify: `package.json` (add `culori` plus `@types/culori`)
- Test: `tests/roll.test.ts`

**Interfaces:**
- Produces:
  - `rollHarmony(colors: string[], locked: boolean[], rand?: () => number): string[]`
  - `colormindBody(colors: string[], locked: boolean[]): { first: object; second: (firstResult: string[]) => object }`
  - `rollColormind(colors: string[], locked: boolean[], fetchImpl?): Promise<string[]>`
  - `POST /api/palette/roll` with `{ engine: 'harmony' | 'colormind', colors: string[7], locked: boolean[7] }` returns `{ colors: string[] }`; harmony also runs in the browser, so the route is for Colormind.
- Harmony rules, as in the spec:
  - With nothing locked, lock the 2 with the highest share (`colors[0]`, `colors[1]`).
  - Scheme picked by `rand`: analogous, complementary, split, triad or tetrad, anchored on the most chromatic locked colour's hue.
  - Chroma within the locked colours' range ±20%.
  - Lightness spread with at least one colour at L > 0.85 and one at L < 0.3, and every pair with ΔL ≥ 0.06.
  - Clamp to the sRGB gamut with `culori.clampChroma`.
- Colormind:
  - `POST http://colormind.io/api/` with `{ model: 'default', input: [...] }`, locked colours as `[r,g,b]` and free ones as `"N"`.
  - Call 1 fills slots 0–4. Call 2 sends the three strongest of call 1's result locked plus "N" for slots 5–6.
  - A 10 s timeout. On failure, throw "Colormind did not answer."

- [x] **Step 1: Write the failing tests:**
  - `rollHarmony` keeps locked colours byte-identical.
  - It returns 7 valid `#rrggbb` colours.
  - It satisfies the lightness rules across 200 seeded runs.
  - With all 7 locked it returns the input unchanged (Review Focus 4).
  - `colormindBody` puts `"N"` exactly in the unlocked slots.
  - `rollColormind` with a fake fetch maps two responses to 7 hex values.
  - A fetch rejection becomes the plain message.
- [x] **Step 2: Run them.** They fail.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run them.** They pass. One live Colormind call through the route is allowed (keyless, free).

### Task 10: Palette UI

**Files:**
- Create: `src/components/palette/palette-strip.tsx`, `src/components/palette/palette-sheet.tsx`, `src/app/api/entries/[id]/palettes/route.ts` (POST save, DELETE `?id=`), `src/lib/client/palette.ts`
- Modify: the gallery card component (strip under the name), `src/components/entry/entry-view.tsx` (strip under the tags), `src/components/fx/library.tsx`
- Test: browser preview

**Interfaces:**
- Consumes: Task 2 `savePalette` / `deletePalette`, Task 9 `rollHarmony` (client side) and `/api/palette/roll` (Colormind).
- FX added:
  - **`SlotReel`**: an unlocked swatch rolls like a slot-machine reel, a vertical blur scroll that settles with overshoot (anime.js, staggered by 60 ms).
  - **`LockToggle`**: a padlock whose shackle snaps shut.
  - **`SwatchColumn`**: a full-height Coolors-style column. Hover reveals the hex, lock and copy controls, and the hex text switches between black and white by OKLCH lightness.
  - Space rolls, as on Coolors; it is ignored while typing in inputs.

- [x] **Step 1: Research.** Study Coolors' generator (Firecrawl screenshot, frame by frame) and UI Layouts/React Bits for slot or counter components (e.g. "Counter", "Rolling text"). Recreate into `library.tsx` and run `npm run fx:index`.
- [x] **Step 2: Build.**
  - The strip is 7 flex segments sized by share. Clicking opens `PaletteSheet` (Modal `size="full"`).
  - The sheet: the original row (locked look, labelled "Measured"), the working row of 7 `SwatchColumn`s, and controls. These are an engine segmented control (Harmony / Colormind), Roll (disabled when all are locked), Save, and "Copy as": hex list or CSS variables `--c1…--c7`.
  - Saved palettes are listed below, each with copy and delete.
  - Errors from Colormind go to the existing toast.
- [x] **Step 3: Check in the preview.** Roll with Harmony several times and confirm locks hold and Space works. Save, then delete. Check 375, 768 and 1280 in both themes. One Colormind roll.

### Task 11: Docs

**Files:**
- Modify: `README.md` (Visualize, `/visualize`, palette, Pollinations provider, `npm run palettes`, `npm run fx:index`), `BUILDLOG.md` (a dated section with rulings: render file naming, the 1,800-character prompt cap, Colormind's two-call fill, k-means parameters), `INSPi.md` (status line; mark backlog item 1 "Measured palette" built and item 24 "Search by colour" still open)

- [x] **Step 1: Write the doc updates.**
- [x] **Step 2: Run `npm test`, `npm run typecheck` and `npm run build`.** All pass. Report the counts.
