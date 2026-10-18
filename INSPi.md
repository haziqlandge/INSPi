# INSPi — design and current state

INSPi is a private gallery of visual references. You paste or upload image(s); an AI reverse-engineers the **design system** in them (not what they depict); the site stores the images with a name, a category, tags, a measured palette and a copy-ready prompt (instruction + JSON) that lets another AI recreate the look, as a website or as an image.

- **How to run it, keys, commands, pages:** [README.md](README.md)
- **What was built, in order, and every ruling made along the way:** [BUILDLOG.md](BUILDLOG.md)
- **This file:** what the product is, how it is put together, and what is done, dropped or still open. It was rewritten on 4 Oct 2026 from the 30 Sep plan; wherever the plan and the code disagreed, the code won and this file says so.

## 1. Status (4 Oct 2026)

| Area | State |
|---|---|
| Foundation, AI core, gallery, entry page, library, settings (plan M0–M4) | Done |
| Showpiece pass (M5) | Done except four items: hold-to-delete, page-flip version counter, DecryptedText/glare card (tried, then removed), and the crosshair cursor (removed). See section 8 |
| QA (M6) | Partly done. 298 unit tests in 27 files pass and `tsc --noEmit` is clean. Not done: a Lighthouse score, a full keyboard-only pass, Safari/Firefox, Gemini and Cloudflare live runs, and **prompt tuning against real references** |
| Built beyond the plan | Visualize (image generation), Pollinations as a provider, measured palettes with lock-and-roll, guided retry with its own provider choice, compare versions, usage page, MCP server, subject modes, collections auto-filing and a tag vocabulary |
| Not started | URL analysis, deployment, and every backlog item not marked built in section 11 |

Providers with a key in `.env` today: **Groq** (two keys, different values), **OpenRouter** and **Pollinations**. No Gemini or Cloudflare key has been tried, so their limits and defaults in `registry.ts` are still unverified assumptions.

## 2. Decisions

### Made by the user
| Topic | Decision |
|---|---|
| Cost | Everything free. |
| Audience | You only. Runs on this PC; later maybe a private repo and a login-gated deployment. Never public. |
| Providers | Groq, Gemini, OpenRouter, Cloudflare Workers AI, plus Pollinations (added 3 Oct). Order is set in Settings; the first with a key is "in use". |
| **One provider per analysis** | A failed analysis fails and shows why; it does not fall through to another provider. Two exceptions, both explicit: a same-provider second key (`<KEY>_FALLBACK`), and the opt-in "Use the next one in line if it fails" setting (off by default). A run that names a provider never moves on. Image generation likewise uses one backend and model and fails honestly. |
| Output goal | Each upload is marked `web` or `img`. |
| Multi-image | One upload = one entry = one prompt. Up to 3 images normally; **Compress** collages larger sets into frames of up to 3, for up to 9 images. |
| Look | Warm, editorial, light by default with a dark mode. Fraunces + Instrument Sans + Geist Mono. Light: Espresso text on Manila paper; dark: Espresso text on Blotter paper; Ochre accent in both. The specimen used to choose is `public/ex.html` (open `/ex.html` while the app runs). |
| Copy | "Copy prompt" = instruction + JSON; the icon on the JSON block = JSON only; every copy shows a toast. |
| Retry | A new version of the note and JSON only; name, category, tags and collections stay. |
| **Web prompts are inspiration** | Web prompts (web/2) describe a design language to carry into an original site, never a page to clone: no verbatim copy, logo, name or illustration, no section-by-section blueprint. Blending several references into one is deferred. |
| Backlog rule | Nothing in section 11 is built without asking first. |

### Made by the assistant (open to change)
- Next.js App Router + TypeScript + Tailwind v4, because the key must stay server-side and a later deployment needs a server.
- Storage is Node's built-in `node:sqlite` (no native module to build on Windows) plus image files in `data/`, behind `Library` / media modules in `src/lib/store` and `src/lib/media` so another backend could replace them. The plan said better-sqlite3 + Drizzle; that was dropped.
- Images are stored as WebP, longest edge ≤ 2000 px; uploads are ≤ 20 MB (PNG, JPEG, WebP, GIF first frame).
- Search is SQL `LIKE` over name, category, note and tags, not FTS5; a personal library is small.
- Discover is a random order over your own library.
- A card's quick-copy copies the **active** version.

## 3. Research that shaped the design (30 Sep 2026, with later corrections)

- **Groq's one vision model** is `qwen/qwen3.8-27b` (preview). 3 images per request, 2,048 tokens per image, strict JSON-schema supported. Free tier: 8K tokens/min and 200K tokens/day, which was about 25 single-image analyses a day. **Correction (30 Sep, first live use):** Groq now also holds this model to 1,000 output tokens a minute, counted against the requested `max_tokens`, so an analysis is asked for in slices (section 5); one web image takes minutes and the day covers roughly 8–10 images. Groq's Llama models are Enterprise-only; its text models are `openai/gpt-oss-120b` and two smaller ones.
- Groq retired vision models three times in 2026, so model ids are configuration, never logic.
- `groq/compound` (browsing) was shut down on 21 Sep 2026, so URL analysis must capture the site itself.
- **Other free options:** Gemini (free Flash tier; exact limits only visible in AI Studio, never verified), OpenRouter (about 50 free requests a day; free models are sent by plain id, **not** with `:free`, which is refused), Cloudflare Workers AI (10K neurons/day), and Pollinations (free "Pollen" for keyed use; community vision models come and go).
- **Prior art:** LabGen and PromptTile (image → JSON prompt), the DESIGN.md convention for websites. Midjourney and Leonardo separate style, content and character references, which is why subject modes exist (section 7).

## 4. Architecture

```
Browser (Next.js client)
  gallery wall · dock · upload tray · entry page · visualize · usage · settings
        │  fetch / polling (entry state every 2 s)
Next.js route handlers  (src/app/api)
  entries (+ [id], retry, restore, related, subject, palettes) · collections · tags · discover
  providers (+ models) · settings · usage (+ calls) · imagine (+ [id], models, examples)
  palette/roll · media/[...path] · mcp
        │
  media pipeline     job queue + worker      library store          AI layer
  sharp: WebP,       persisted in SQLite,    node:sqlite,           registry → budget → strategy
  frames, collage,   one worker, idle        data/inspi.db          → OpenAI-compatible client
  palette (OKLab)    palette backfill                                      │
        │                                                      Groq · Gemini · OpenRouter · Cloudflare · Pollinations
   data/media/<entryId>/                                       Visualize: Pollinations · Pollinations community · keyless URL
```

**Stack** (from `package.json`): Next.js 16.3, React 19.2, TypeScript, Tailwind v4, Motion 13, anime.js 4, culori (colour), sharp, zod 4, nanoid, Vitest 5, tsx. Node ≥ 22.13. React Bits components are copied in by `scripts/add-bit.mjs` (BlurText, CountUp, DriftWall, Folder, ScrollVelocity, SloshGauge, Stack); UI Layouts was not used as a source except one lightbox idea.

**Layout**
```
src/app/          page.tsx (wall) · e/[slug] · collections · visualize · usage · settings · api/
src/components/   gallery · entry · collections · upload · visualize · palette · usage · settings
                  shell (header, dock, model menu, theme) · ui · feedback · bits · fx · motion
src/lib/          ai/ (registry, client, budget, ratelimit, strategy, run-choice, usage, status, describe,
                       prompts/, schema/) · imagine/ · media/ · palette/ · jobs/worker · store/ · library/
                  mcp/ · copy/compose · settings · client/
scripts/          check-providers · analyze · palettes · mcp · fx-index · add-bit
tests/            27 files, 294 tests, run with real images from test-images/ (git-ignored)
docs/superpowers/ specs and plans for the 3–4 Oct work
```
There is no `/styleguide` page and no `dock/` or `jobs/queue.ts`; the plan named them, the build folded them into other files.

### Data (SQLite `data/inspi.db`, schema version 3)
- `entries`: id, slug, name, category, mode (`web`|`image`), status, progress, wait_until, error, compress, favorite, active_version_id, created/updated/**deleted_at** (soft delete, restorable for 10 minutes), owner_id (unused), plus `palette` and `palettes` (measured and saved colours).
- `images` (no stored paths; files are derived from entry id and position), `versions` (lens, note, `spec_json`, provider, model, tokens, duration, `steer`), `tags` / `entry_tags`, `collections` / `collection_entries`, `jobs` (state, error, `params`: steer, run choice, changes), `settings` (one JSON row), `calls` (every provider request, for Usage), `renders` (Visualize output).
- Not built: `entries_fts`, `source`, `images.full_path` / `thumb_path`.

## 5. AI layer

### Providers (`src/lib/ai/registry.ts`)
One OpenAI-compatible client serves all five. The registry holds base URL, key variables and per-model limits; Settings can override the model per provider and per job (reading vs writing).

| Provider | Env vars | Default models | Status |
|---|---|---|---|
| Groq | `GROQ_API_KEY` (+ `_FALLBACK`) | read `qwen/qwen3.8-27b`, write `openai/gpt-oss-120b` | Verified, in daily use |
| OpenRouter | `OPENROUTER_API_KEY` | `google/gemma-4-31b-it` for both | Key works; limits assumed; busy free models are sometimes refused with a 429 |
| Pollinations | `POLLINATIONS_API_KEY` (`sk_`) | none: pick a healthy community model | Key works for analysis and Visualize; analysis limits assumed |
| Gemini | `GEMINI_API_KEY` | `gemini-flash-latest` | **Unverified**, no key |
| Cloudflare | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | none: choose in Settings | **Unverified**, no key |

Every provider takes a second key as `<KEY>_FALLBACK`. Settings warns when the two are identical. The two Groq keys now differ, but whether they are separate accounts (which would double the quota; a same-organisation key shares it) has not been checked. `npm run check-providers` lists what each key can see.

### Frames (`media/pack.ts`, `collage.ts`)
Up to 3 images, one frame each; with Compress, up to 9 images in frames of up to 3 spread evenly (4 → 2+2, 5 → 3+2, 7 → 3+2+2, 9 → 3+3+3). Collages are built with sharp: neutral ground, thin gutters, corner labels A/B/C. A collage gives each image a third of the model's attention. Originals are kept and shown individually.

### Strategy (`ai/strategy.ts`, `budget.ts`)
Every provider runs the same two passes; the plan's "single-shot" path was dropped.
1. **Observe** (vision model): measures 27 dimensions, each with value, evidence, location, magnitude and confidence (24 common, plus `interaction_cues` / `motion_cues` / `responsive_cues` for web, or `medium_technique` / `camera_lens` / `subject_treatment` for image), plus the gist, keywords, signature and palette. Web analyses also run a **patterns** call (page grammar, components, signature motif, copy voice, and the source's identity, which is only ever used to write an `avoid` line).
2. **Translate** (text model): turns findings into the spec, name, category, tags, 1–3 collections and note. Image mode adds `prompt`, `negative` and `params`; web/2 adds `keep`, `adapt` and a priority per dimension. A person's **Changes** note reaches only this pass.
3. Several frames are merged in code (`mergeObservations`), not by a third AI call: three observations do not fit Groq's 8K tokens/min.

The budgeter measures each prompt and clamps `max_completion_tokens` to the minute's allowance. When a provider refuses with an output-per-minute cap (Groq's 1,000), the cap is learned from the refusal and the observation is asked for in **slices** (`planSlices`: patterns, meta + 10 dimensions, 16 dimensions) that each fit, paced to the allowance and stitched back (`assembleSlices`). With a second Groq key the parts run on both keys at once.

`basis` ("observed" or "inferred") is set in code from the dimension and its confidence, never asked of the model.

### Wire format and spec
The observe call uses short keys (`v e l m c`); `schema/expand.ts` expands them to the readable JSON that is shown and copied. Strict JSON-schema mode where the model supports it; otherwise JSON mode, zod validation and one repair attempt.

- `web/2` (current): `signature`, `palette`, `patterns`, `keep`, `adapt`, `system` (27 findings with `web` translation, `priority`, `basis`), `tokens`, `build`, `avoid`, optional `changes`.
- `web/1` (entries before 1 Oct): same, with a verbatim `blueprint` instead of `patterns`. Retrying such an entry produces web/2.
- `image/1`: `system` (with `gen` fragments), `prompt` (one generator-neutral paragraph), `negative`, `params`, and `subject`, `subjectMode`, `mySubject` (see section 7).

The prompt text lives in `src/lib/ai/prompts/` (`observe.ts`, `translate.ts`, `lenses.ts`, `steer.ts`) and `src/lib/copy/compose.ts`; read those rather than a copy here, which would go stale again.

### Retry
A retry rotates through lenses (balanced → structure → surface → detail → behaviour) and runs at temperature 0.8 (first pass 0.4), receiving the previous signature with "find what that pass under-reported". **Guided retry** replaces the rotation with chosen focus areas plus a note of up to 400 characters. The dialog's **Run with** row picks the provider and models for that run only; a failed entry's Retry opens the same dialog as "Try again".

### Queue (`jobs/worker.ts`)
Uploading returns at once; a single persisted worker analyses. It reads rate-limit headers, waits out per-minute windows and shows the wait on the card. A failed analysis stays failed with the provider's own message and a Try again button; it does not resume by itself. The UI polls every 2 s. When idle the worker measures palettes for older entries (5 per tick) and removes entries deleted more than 10 minutes ago. Edits to server code no longer need a restart: the store keeps one connection per code version and the worker hands over after a reload.

## 6. Categories, collections, tags
- **30 categories** in `library/categories.ts` (what kind of thing it is): Landing Page · Dashboard & Data · Mobile App · E-commerce & Product Page · Portfolio & Personal · Editorial & Magazine · Component & UI Kit · Game & HUD Interface · Branding & Identity · Logo & Mark · Typography & Lettering · Poster & Print · Packaging · Album & Cover Art · Illustration · Icon & Pictogram · 3D & Render · Motion & Film Still · Photography · Portrait & Character · Fashion & Beauty · Product & Still Life · Food & Drink · Architecture & Interior · Cityscape & Urban · Landscape & Nature · Sci-Fi & Cyber · Fantasy & Surreal · Anime & Comic · Abstract, Pattern & Texture.
- **29 seeded collections** (look and mood: Dark & Moody, Neon & Cyber, …) plus your own. The AI files each new entry into 1–3. Existing entries were left as they were, by choice.
- **Tags** come from a grouped vocabulary of 268 (Style, Subject, Colour, Mood, Era & culture, Technique); at most 2 tags outside it survive per entry. The wall's rail has All, the top tags and a "More" panel (several tags narrow with AND); search suggests tags as you type or after `#`; `/collections` has a searchable tags index.

## 7. Screens

- **Wall `/`**: masonry cards (first image, name, category, a few tags, `web`/`img` badge, favourite, quick copy), tag rail, dock with search, mode filter and **Add**. Paste or drop anywhere opens the upload tray. Cards no longer show the palette; the entry page does.
- **Upload tray**: thumbnails, `web | img`, Compress (auto-on above 3 images), a plain line on what will happen, and for image entries the **Subject** choice and the optional **Changes** box.
- **Entry `/e/<slug>`**: one large image with a thumbnail strip, measured palette (click a colour to copy it; "Palette" opens the sheet with lock-and-roll), name/category/tags/collections, note, **Copy prompt**, **Retry**, version arrows with "use this one", **Compare** versions, the JSON block (first ~14 lines, expandable), **Visualize** and its renders (image entries), then Related and Discover. Clipboard has a fallback for phones on plain-http LAN.
- **Subject modes (image entries)**: *Recreate it* (same subject and arrangement; the analysis records `subject`, and older entries describe it once on demand), *My subject*, *Model's choice* (style only). Chosen at upload, kept on the spec, switchable on the entry page without re-analysing; Visualize starts from it.
- **`/visualize`**: prompt playground or borrow an entry's prompt, aspect, seed, model with its health, AutoPick (Strongest / Balanced / Cheapest), optionally show the model the original picture (`/v1/images/edits`), and a wall of every render. The whole prompt goes by POST (up to 32,000 characters) to one backend and model. Details and Elo ranking: README and `src/lib/imagine/recommend.ts`.
- **`/usage`**: every provider request is logged; gauges for Groq's daily tokens, OpenRouter's own free-request count, a forecast/timeline/mix view, and an explorer with filters and paging.
- **`/collections`**: collections as folders plus the tags index. **`/settings`**: provider order, next-in-line switch, models, keys present (never values), connection test, image model, Coding agents (MCP command), compress default, theme.
- **MCP** (`npm run mcp`, also `/api/mcp`): read-only tools `search_references`, `get_prompt`, `get_reference`, `get_reference_image`, `library_overview`, over stdio, reading the database directly. Not registered with any client; that is the user's call.
- **Phones**: run `npm run dev:lan` and open the Network address. On narrow screens Visualize becomes an icon and Usage moves to Settings.

## 8. Look and motion

**Concept: the darkroom.** Warm paper, editorial type, images supply the colour. Guardrails: only transform/opacity animate; heavy pieces load on demand; `prefers-reduced-motion` reduces effects to fades (the film-grain shift is the one thing that continues); AA contrast in both themes.

**Built:** shimmering skeletons for analysing cards (replacing the planned developing overlay); light-table drop overlay and tilted prints in the tray; card → page shared-image transition (React ViewTransition); pointer tilt on cards (the sheen was removed); JSON cascade on expand; copy tick, spark and swipeable toast; shredded note on retry; circular theme reveal; cursor-reactive wordmark; glass dock with sprung segments; scrolling tag band; Drift view for Discover; folders for collections; favourite pulse; film grain shifting eight times a second; word-by-word heading reveals on scroll; a sloshing gauge on Usage; and, from 3 Oct, develop-in reveal for renders, shutter button, palette reels, aspect picker, masonry wall and print lightbox (indexed at the top of `src/components/fx/library.tsx`, rebuilt with `npm run fx:index`).

**Not built, or built and removed:** hold-to-delete; page-flip on the version counter; Decrypted Text and the glossy-card hover (removed after first use); the forensic crosshair cursor (removed); the plan's Developing overlay as the default state (skeletons instead).

## 9. Milestones (plan, with outcome)

M0 housekeeping and type pick: done. M1 foundation: done. M2 AI core: done except live prompt tuning. M3 core experience: done. M4 library: done. M5 showpiece: done minus section 8's list. M6 QA: partial (section 1). Later phases and the backlog stay gated on the user.

## 10. Later phases (agreed in principle, not scheduled)

- **URL analysis:** a local headless browser (Playwright) captures desktop and mobile screenshots and, ideally, the page's real fonts, colours, radii and spacing. One-time ~150 MB browser download.
- **Multi-device deployment:** private GitHub repo, login gate, cloud database and image storage replacing `data/` through the store modules (Supabase free tier, or Cloudflare D1 + R2). The in-process queue would need to change for serverless hosting. The repository exists locally with two commits; the 28-commit history plan is in `commitTask.md` (git-ignored).

## 11. Feature backlog (nothing here is built without asking)

Effort: S small, M medium, L large. "+call" = an extra AI request per use.

**Built**
- 1 (partly). Measured palette (done, local k-means in OKLab, shown on the entry page with lock-and-roll). Still open: feeding it to the AI as ground truth.
- 2. Steerable retry (guided retry, 1 Oct).
- 9. Version diff view (Compare, 1 Oct).
- 22 (parts). Subject modes and per-entry **Changes** cover some of what "blend" was for; blending several entries is still deferred.
- 29 (partly). Delete has a 10-minute undo and restore; there is no trash page.
- 33. Usage dashboard (`/usage`).
- 34. MCP server (`npm run mcp`).

**Open** (checked against the code on 4 Oct; none exist yet)
- Analysis: 3 proof render, 4 evidence overlay, 5 depth setting, 6 target-tuned copy, 7 DESIGN.md export, 8 Tailwind/CSS-variables export, 10 self-critique pass, 11 font matcher, 12 confidence bars, 13 prompts in other languages.
- Input: 14 bulk import, 15 crop before analysing, 17 browser extension or bookmarklet, 18 installable app and share target, 19 video/GIF frames, 20 Figma import. (16 duplicate detection: `images.sha256` is stored but nothing compares it.)
- Library: 21 zip export/import, 23 compare two entries (only versions of one entry), 24 search by colour (palettes now make it possible), 25 semantic search, 26 smart collections, 27 notes and source credit, 28 copy counter and sorts, 30 tag manager, 31 keyboard shortcuts and command palette, 32 share link.
- Platform: 35 CLI, 36 nightly backup (`data/` is plain files; copy it), 37 offline cache.

## 12. Still needed, and risks

**Needed from you**
1. Real references for prompt tuning. Eight images are in `test-images/` (art, photo, poster, two websites); the plan wanted 6–10 spanning UI, poster, photo, illustration, 3D render, busy and sparse. Prompt quality is the biggest lever and has not been tuned.
2. Optional: `GEMINI_API_KEY` (deepest output, several images per call), Cloudflare id and token.
3. Whether the second Groq key is a different account (doubles the quota) or the same organisation.
4. Your decision on what to build next from section 11.

**Risks**
- Groq's vision model is a preview, has been swapped three times this year, and its limits have tightened since the plan. Mitigated by config-driven ids, the provider switch and `check-providers`.
- Groq free is roughly 8–10 web analyses a day; a Gemini key or the second account is the practical fix.
- Vision models estimate: hex and size values are approximations, and measured palettes are not yet fed back to the AI.
- Pollinations community models and free limits change; health is Pollinations' own measurement.
- Reference images are other people's work. Private use is the plan; keep it private.

## 13. Verification

- **Automated:** `npm test` (294 tests: packing, budgeter, wire expansion, schema and repair, strategy and slices, usage, imagine, palettes, store and reload, MCP, compare) and `npm run typecheck`. Provider calls run against fixtures or a local stand-in, not live. The suite needs `test-images/`.
- **Live checks that were done:** real Groq analyses of web and image references; OpenRouter refusals and the `:free` finding; all 13 AutoPick-ranked image models test-generated once on 3 Oct; one Colormind roll; a 9,326-character prompt by POST; light and dark at 375, ~760 and 1280–1440 wide with no horizontal overflow; upload, quota waiting, retry and versions, edit, favourite, delete and restore, search, collections, lightbox, copy and toast.
- **Not done:** Lighthouse, a full keyboard-only pass, Safari and Firefox, Gemini and Cloudflare live runs, and the fidelity check (paste generated prompts into an AI, build the result, compare it with the reference).
