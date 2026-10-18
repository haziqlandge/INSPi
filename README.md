# INSPi

A private library of visual references. Add an image; INSPi reverse-engineers the design system inside it and keeps the image with a name, a category, tags, and a prompt (instruction + JSON) that another AI can follow to recreate the look, as a website or as an image.

The full plan, decisions and feature backlog are in [INSPi.md](INSPi.md). What has been built, and every judgement call made along the way, is in [BUILDLOG.md](BUILDLOG.md).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

To use it from a phone on the same Wi-Fi, run `npm run dev:lan` and open the "Network" address the terminal prints.

## Keys

Copy `.env.example` to `.env` and fill in at least one provider. Groq is first in line by default and Settings changes the order. Gemini and Cloudflare are supported but untested here (no keys tried).

| Provider | Variables | Free key |
|---|---|---|
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys |
| Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com |
| Pollinations (Visualize, and a fifth analysis provider; no default model, pick a healthy one) | `POLLINATIONS_API_KEY` (`sk_…`) | https://enter.pollinations.ai/keys |

Each analysis provider also takes a second key from another account as `<KEY>_FALLBACK` (e.g. `GROQ_API_KEY_FALLBACK`), used while the first waits for quota.

OpenRouter free models are sent by their plain id (`google/gemma-4-31b-it`, the default), never with the `:free` suffix its model list shows: requests with `:free` are refused. INSPi strips it for you.

Restart the server after changing `.env`. Keys stay on the server and are never shown in the app. Provider order and model ids are changed in Settings.

```bash
npm run check-providers
```

lists what each key can see and warns if a configured model has been retired.

## Pages

- `/` the wall, with search, tags and the upload tray (paste, drop or pick). For image entries the New entry window asks for the **Subject**: *Recreate it* (an exact prompt: same subject and arrangement), *My subject* or *Model's choice* (style only); the entry page's "Copy prompt gives" switch changes it later without analysing again, and Visualize starts from it. It also has an optional **Changes** box ("make it night time, teal instead of red"): the prompt is written with them, and every prompt from that entry states them.
- `/e/<slug>` an entry: images, measured palette (click it to lock and roll colours), prompt, versions, guided retry (with its own provider and models if you like), compare versions, Visualize and its renders (image entries), related and discover.
- `/collections` collections (29 seeded look/mood ones plus your own) and the tags index.
- `/visualize` make images: a prompt playground (or borrow an entry's prompt, choosing Recreate it / My subject / Model's choice, and optionally showing the model the entry's picture), aspect, seed, model with its health, and a wall of every render.
- `/usage` the provider in use (gauges, plus a Week (tokens per day) / Timeline / Mix view you switch with a button), the other providers as a compact strip, and an explorer: quick lenses, provider and model filters (either, both or neither), kind of work, result and range, a day chart and pages of 10 requests.
- `/settings` provider order (arrows; the first is in use), "Use the next one in line if it fails" (off by default), models, keys present, image generation model, and Coding agents (the MCP command). On phones the Usage link is here too.

## Where things are kept

Everything lives in `data/` (git-ignored): `inspi.db` is the library, `media/` holds the images. Back that folder up to keep your library. Set `INSPI_DATA_DIR` to keep it somewhere else.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Check types |
| `npm run analyze -- image.png --mode web` | Analyse images from the terminal, without the app. Add `--compress`, `--version 2`, `--out file.txt` |
| `npm run check-providers` | Check keys and model ids |
| `npm run palettes` | Measure the colour palette of every entry that lacks one (the app also does this while idle). Local, no AI |
| `npm run fx:index` | Rebuild the index at the top of `src/components/fx/library.tsx` (every motion component, what it does, and its line) |
| `npm run mcp` | Run the MCP server that lets coding agents search the library, fetch prompts, list and switch image and text models, write prompts, generate images and turn a picture into a prompt. Settings > Coding agents has the command to register it |
| `node scripts/add-bit.mjs Name` | Copy a React Bits component into `src/components/bits` |

## Visualize and palettes

- **Visualize** opens a small window on an image entry: choose the **subject** and a model, then Generate. Subject: *Recreate it* (the same subject and arrangement; the analysis records what the picture shows, and older entries describe it once on demand with the provider in use; edit the text to change details), *My subject* (yours, drawn in the entry's style) or *Model's choice* (style only, what Copy prompt gives). With Recreate, models that take an image (GPT Image, MAI Image, FLUX Kontext, FLUX.2 Klein) can also be shown the original picture, the closest to a one-to-one copy (`/v1/images/edits`). Model: an AutoPick mode or a model (Pollinations, Community or Keyless; strongest first, the chosen one ringed). The choice is remembered. **AutoPick** skips models Pollinations reports unhealthy and any that failed for you in the last day, then picks: *Strongest* (highest Artificial Analysis blind-vote Elo), *Balanced* (Elo over Pollen and seconds per image) or *Cheapest* (least Pollen among ranked models). Every ranked model was test-generated on 3 Oct 2026 (`src/lib/imagine/recommend.ts`). It sends the whole prompt (the subject instruction and the JSON spec) by POST, up to 32,000 characters, to that one backend and model: Pollinations, Pollinations community models, or a keyless URL route (experimental). Only that one is tried; a failure shows Pollinations' own message (for example "Out of Pollen for now"). Renders are stored as WebP next to the entry's images (`render-<id>.webp`) and listed in the `renders` table. Model lists come from Pollinations' public catalogue; paid-only models are never shown, and each model's health is Pollinations' own measurement (a success rate of 80% or less counts as degraded).
- **Palette**: seven colours measured from the images on your PC (k-means in OKLab, no AI), shown as circles under the entry's image (not on the small cards). Click a circle to copy its hex; click "Palette" to open the sheet, where clicking any colour (or the measured bar) copies it too. Lock colours and Roll (or press Space): only locked colours stay. Harmony is local: one main hue (from your locked colours, or the image's main colour as inspiration), at most one accent hue, colour carried by the mid-tones, a soft light and a soft dark. Colormind is colormind.io's free model. Rolls you like can be kept.
- **Model lists** are fetched once when the site opens and kept in the browser for six hours, so dropdowns draw complete straight away.

## How an analysis works

1. Images are stored as WebP, then packed into frames: one per image, or contact sheets of up to three when Compress is on.
2. **Observe**: a vision model measures 27 aspects of the design (composition, type, colour, depth…), each with evidence, location, magnitude and confidence. For websites it also transcribes the page as a blueprint: sections, exact text, sizes, and the illustrated pieces.
3. **Translate**: a text model turns those findings into the build spec, and names, categorises and tags the entry.
4. The result is saved as a version. Retry adds another version from a different angle; the entry keeps its name, category and tags.

Only one provider is used per analysis: the one marked "In use", or the one picked in the retry dialog's "Run with" for that run. If it fails, the analysis fails and shows why.

Model ids and limits live in `src/lib/ai/registry.ts`. The prompts are in `src/lib/ai/prompts/`.
