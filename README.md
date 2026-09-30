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

Copy `.env.example` to `.env` and fill in at least one provider. Groq is the default.

| Provider | Variables | Free key |
|---|---|---|
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys |
| Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com |

Restart the server after changing `.env`. Keys stay on the server and are never shown in the app. Provider order and model ids are changed in Settings.

```bash
npm run check-providers
```

lists what each key can see and warns if a configured model has been retired.

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
| `node scripts/add-bit.mjs Name` | Copy a React Bits component into `src/components/bits` |

## How an analysis works

1. Images are stored as WebP, then packed into frames: one per image, or contact sheets of up to three when Compress is on.
2. **Observe**: a vision model measures 27 aspects of the design (composition, type, colour, depth…), each with evidence, location, magnitude and confidence. For websites it also transcribes the page as a blueprint: sections, exact text, sizes, and the illustrated pieces.
3. **Translate**: a text model turns those findings into the build spec, and names, categorises and tags the entry.
4. The result is saved as a version. Retry adds another version from a different angle; the entry keeps its name, category and tags.

Only one provider is used per analysis (the one marked "In use"); if it fails, the analysis fails and shows why.

Model ids and limits live in `src/lib/ai/registry.ts`. The prompts are in `src/lib/ai/prompts/`.
