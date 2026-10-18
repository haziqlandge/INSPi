# Visualize, Pollinations analysis, palette roll, retry model picker — design

Agreed with the user on 3 Oct 2026. Four independent pieces, built in this order; each ships and is checked before the next starts.

## Ground rules (from the user)
- Free only. Nothing that needs a card. Pollinations spends free (Quest) Pollen; paid-only models are never offered.
- **One backend, fail honestly.** Neither image generation nor analysis falls back to another service or model. The real error is shown.
- **The user verifies models.** Image and Pollinations models are not test-called by the agent (each call spends Pollen). Free catalogue reads are fine.
- OpenRouter ids go out without `:free` (done 3 Oct).
- Visualize is for **image** entries only, never web entries.

## 1. Image router and Visualize

### Backends (`src/lib/imagine/`)
One interface, one file per backend:

```ts
interface ImageBackend {
  id: 'pollinations' | 'pollinations-community' | 'keyless-url';
  label: string;
  available(env): boolean;                      // key present (keyless-url: always)
  models(): Promise<ImageModel[]>;              // cached 10 min
  generate(req: ImagineRequest): Promise<{ bytes: Buffer; contentType: string }>;
}
interface ImagineRequest { prompt: string; negative?: string; width: number; height: number; seed?: number; model: string }
interface ImageModel { id: string; label: string; acceptsImage: boolean; health: 'healthy' | 'degraded' | 'unknown'; successRate: number | null }
```

- **pollinations**: `GET https://gen.pollinations.ai/image/{encodeURIComponent(prompt)}?model=&width=&height=&seed=` with `Authorization: Bearer POLLINATIONS_API_KEY`. Models from `GET /image/models` (keyless): output includes `image`, not `community`, `paid_only !== true`, video models dropped.
- **pollinations-community**: same endpoint and key; models are the `community: true` entries with `paid_only !== true`, fetched with `?reliability=all` so degraded ones still show (with their health).
- **keyless-url**: `GET https://image.pollinations.ai/prompt/{prompt}?width=&height=&seed=&nologo=true` with no key. Labelled "Experimental, unverified" in the UI. Its model list is a single `default` entry.
- The negative prompt is appended as `Avoid: …` (Pollinations' GET has no negative parameter).
- Width and height come from the entry's `params.aspect` (e.g. `3:2`), with the long side at 1024 rounded to a multiple of 16.
- Errors map to plain messages: 401 means "Pollinations rejected the key", 402 means "Out of Pollen", 429 means "Too many requests, wait a minute", and anything else gives the status plus the body's `error.message`. No retry and no fallback.
- A timeout of 120 s (some models take time).
- The key never reaches the browser: generation runs only in route handlers.

### Router
- `POST /api/imagine` takes `{ backend, model, prompt, negative?, aspect?, seed?, entryId?, versionId? }` and returns the new `Render`. It is guarded by `crossOrigin` like the other write routes.
- `GET /api/imagine/models` returns `{ backends: [{ id, label, available, models, message }] }`.
- The choice of backend and model is saved in settings as `imagine.backend` and `imagine.model`; it is picked in the Visualize tab and in Settings.
- Each request is logged in the `calls` table (provider `pollinations`, job `imagine`), so `/usage` counts it.

### Storage
`MIGRATE_TO_3` adds:
```sql
CREATE TABLE renders (
  id TEXT PRIMARY KEY, entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  version_id TEXT, backend TEXT NOT NULL, model TEXT NOT NULL,
  prompt TEXT NOT NULL, seed INTEGER, width INTEGER, height INTEGER,
  path TEXT NOT NULL, created_at INTEGER NOT NULL
);
```
Files are saved as WebP through sharp in `data/media/<entryId>/renders/<id>.webp`, or `data/media/_playground/renders/` when there is no entry. They are served by the existing `/api/media` route. Deleting a render removes the row and the file.

### UI
- **Entry page (image entries):** a "Visualize" button next to Copy prompt and Retry. It sends the active version's `prompt`, `negative` and `params.aspect` to the saved backend and model. The button shows a developing state (the existing shimmer) until the image arrives. Below the image stack is a **Renders** strip (newest first, with model and seed under each); clicking one opens the existing lightbox. A failure shows the message inline with "Try again".
- **`/visualize` tab** (header nav link "Visualize"):
  - Left: a playground with a prompt box, negative, aspect (1:1, 3:2, 2:3, 16:9, 9:16), seed (blank means random), and the backend and model picker with health badges. "Generate" goes next to "Paste prompt from an entry" (a search picker over image entries).
  - Right: a wall of every render, linked to its entry and filterable by backend and model, with a delete action.
- Web entries never show the button.

## 2. Pollinations as an analysis provider
- Registry entry `pollinations`: `baseUrl` `https://gen.pollinations.ai/v1`, key `POLLINATIONS_API_KEY` (plus `POLLINATIONS_API_KEY_FALLBACK`), `verified: false`, no default model (the user picks one).
- Model listing reads `GET /text/models` (keyless, `?reliability=all`). `usableModels` already handles `input_modalities`/`output_modalities`; we also drop entries with `paid_only: true` and carry `health` on `ListedModel` for display.
- Limits: unknown, so the limits are generous (one call per observation, no output cap) and Pollinations' real errors are surfaced. Its `x-usage-*` headers are logged if present.
- The same rules apply: it is used only when marked "In use", with no fallback.

## 3. Measured palette of 7, with Roll
### Extraction (`src/lib/media/palette.ts`)
- From the entry's first image (all images for multi-image entries, weighted equally): sharp resizes it to 96px on the long side and reads the raw RGB.
- k-means in OKLab with k = 7, k-means++ seeding with a fixed seed so results are repeatable, 12 iterations. Near-duplicate centres (ΔE OK < 0.03) are merged and refilled from the next-biggest cluster.
- The output is `[{ hex, share }]` sorted by share, stored in a `palette TEXT` column on `entries` (JSON).
- It runs at ingest for new entries. For older entries, a backfill runs once in the background when the worker starts (entries whose `palette` is null, one at a time); `npm run palettes` runs the same thing by hand. This is local, with no AI and no network.

### Viewer and Roll
- Cards and the entry page show a 7-swatch strip. Clicking it opens a **Palette** sheet (Modal) with large swatches, hex values (click to copy, with a toast), a lock toggle on each swatch, and **Roll**.
- **Roll engine toggle:** "Harmony" (default) or "Colormind".
  - **Harmony** (local, `culori`): take the locked colours. If none are locked, lock the two with the largest share. Pick a scheme at random: analogous, complementary, split-complementary, triadic, or tetradic, anchored on the most chromatic locked colour's hue. Fill the unlocked slots in OKLCH, with chroma taken from the locked colours' range (±20%), and lightness spread so the palette keeps at least one light (L > 0.85) and one dark (L < 0.3) and each pair differs by ΔL ≥ 0.06. Colours are clamped to sRGB.
  - **Colormind** (`POST http://colormind.io/api/`, keyless, 5 slots, called server-side through `/api/palette/roll` because the browser page may be https): locked colours are sent as RGB and the rest as `"N"`. For 7 slots it makes two calls: slots 1–5, then the 2 left with the first result's three strongest colours locked. A failure shows "Colormind did not answer" and leaves the palette as it was (no fallback to Harmony).
- **Save** keeps a rolled palette on the entry (`palettes TEXT` JSON list, newest first, up to 12). Saved palettes are listed under the original, each with copy-all (as hex list or CSS variables) and delete. The measured original never changes.

## 4. Model picker in the retry dialog
- The retry dialog gains a "Run with" row: a provider select (configured providers only) plus reading-model and writing-model selects from the same `modelChoices` lists Settings uses. It defaults to the provider in use and its saved models.
- The retry body becomes `{ focus, note, run?: { provider, vision?, text? } }`. It is validated server-side (the provider must have keys; ids are trimmed, with OpenRouter's `:free` stripped) and stored on the job (`jobs.params`) next to `steer`.
- The worker builds that job's chain from `run` instead of settings: still one provider, no fallback. The version already records `provider` and `model`.
- It also works for the "Try again" of a failed entry.

## Testing
- Unit tests (Vitest, no live calls):
  - Backend URL building and error mapping from recorded responses.
  - Model filtering from a saved `/image/models` and `/text/models` fixture (paid-only dropped, community split, health carried).
  - Aspect to width and height.
  - The renders store (create, list, delete with file).
  - k-means palette on synthetic pixel buffers (deterministic, 7 distinct colours, shares sum to 1).
  - Harmony roll invariants (locked colours unchanged, 7 colours, lightness spread, in gamut).
  - Colormind request shaping for 7 slots.
  - Retry `run` validation and the worker using it.
- Live: the user runs Visualize, Pollinations analysis and Colormind themselves. Agent checks are limited to free catalogue reads and the UI in the browser preview (light and dark, 375 / 768 / 1280).

## Out of scope (not agreed)
Cloudflare image backend, router failover, fidelity loop, "wear this look", look-alike search, proof render, museum drop, weird lab, and Blend (still deferred).
