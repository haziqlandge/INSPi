# INSPi build log

Plan: `INSPi.md`. This file is the running record: what is done, and every ruling made where the plan was silent or wrong.

## Locked design choices (2026-09-30)
- Type: Fraunces (names) + Instrument Sans (reading) + Geist Mono (JSON).
- Light: Manila paper, Espresso text, Ochre accent.
- Dark: Blotter paper, Espresso text, Ochre accent.

## Rulings
- No git commits are made unless the user asks (harness rule overrides the executing-plans skill's per-task commits).
- SQLite via Node's built-in `node:sqlite` instead of better-sqlite3 + Drizzle — no native dependency to compile on Windows; FTS5 verified available. Cost if wrong: swap the one store module.
- Search uses SQL LIKE over name/category/note/tags instead of an FTS5 index — a personal library is small. Cost if wrong: add the FTS table later.
- Multi-frame observations are merged deterministically in code, not by a second AI call — three observations do not fit Groq's free 8K tokens/min. Cost if wrong: less nuanced reconciliation between frames.
- Every provider runs the same two passes (observe, then translate); "single-shot" from the plan is dropped. Large-budget providers just take all frames in one observe call with the full rubric. Cost if wrong: one extra call on generous providers.

## Progress
- M0 done: plan saved, git initialised, `ex.html` specimen built and the type/colour pick made.
- M1 done: Next.js 16 + Tailwind 4 scaffold, tokens for both themes, fonts, theme toggle, SQLite store, media ingest.
- M2 done except live tuning: provider registry, OpenAI-compatible client, budgeter, frame packing and collage, schemas, prompts, two-pass strategy, queue/worker, `analyze` script. 98 unit tests.
  - Blocked: the Groq key in `.env` is rejected (401 Invalid API Key), so no real analysis has run yet. Verified end to end against a local stand-in provider instead.
- M3 done: gallery wall, dock, upload tray (paste, drop, pick), developing state, entry page, JSON block, copy + toast, retry + versions, related, discover.
- M4 done: search and filters, edit, delete with undo, favourites, collections, settings with provider order and models.

## More rulings
- A failed analysis stays failed with a clear message and a "Try again" button, rather than resuming by itself when a daily quota resets. Cost if wrong: one manual click the next day.
- The entry page shows one large image with a thumbnail strip for the rest, not every image at full size. Cost if wrong: a layout change in `image-stack.tsx`.
- React Bits components are copied in with `scripts/add-bit.mjs` (same result as the shadcn CLI). Used: DecryptedText, BlurText, GlareHover, ScrollVelocity, Folder, DriftWall. UI Layouts was not used: its pieces duplicated what Motion already covered here.
- M5 done in part. Built: developing overlay (marks drawn with anime.js, scan line, scrambling status, quota countdown), light-table drop overlay and tilted prints in the tray, card-to-page shared image (React ViewTransition), glossy sheen and pointer tilt on cards, measuring reticle over the entry image, JSON cascade on expand, copy tick + spark + swipeable toast, shredded note on retry, theme reveal from the toggle, cursor-reactive wordmark, glass dock with sprung segments, scrolling tag band, Drift view for Discover, folders for collections, favourite pulse, static paper grain.
  Not built: hold-to-delete, the sloshing quota gauge (a plain bar is used), page-flip on the version counter, animated grain, scroll-reveal headings.
- M6 done in part. Checked: 113 unit tests, type check, production build with no warnings; home, entry, collections and settings in light and dark at phone (375), tablet (~760) and desktop (1280–1440, by measurement) widths with no horizontal overflow; upload from the tray, quota waiting, retry and versions, edit, favourite, delete and restore, search, collections, lightbox, copy with toast; the real rejected-key failure; cross-site upload refused.
  Not checked: real analysis quality (blocked by the key), Gemini / OpenRouter / Cloudflare (no keys), Lighthouse score, a full keyboard-only pass, Safari and Firefox, how the card-to-page transition looks (the preview cannot capture it).

## Changes after first live use (2026-09-30)
- Groq and OpenRouter keys both work. Groq analyses real images; OpenRouter's free Gemma 4 is often refused with a 429 from Google AI Studio's shared pool (its real message is now shown on the card).
- **One provider only.** The app no longer falls back to another provider: the provider marked "In use" (Settings, or the chip button in the dock) is the only one tried, and a failure is reported as it is. Supersedes the plan's fall-through.
- OpenRouter's `google/gemma-4-26b-a4b-it:free` is pinned to `google-ai-studio` with `allow_fallbacks: false` (`MODEL_ROUTES` in `registry.ts`); any other model goes out unpinned.
- Model dropdowns (Settings, and the dock's provider/model panel) list what the key can see; a text box is the fallback.
- Analysing entries show shimmering skeletons (image and text) instead of the developing overlay; failed entries are greyed out, "Could not be analyzed", with Retry and Delete. Crosshair and card gloss removed. The entry page reserves the tallest image's height so switching images no longer moves Related/Discover.
- **Web prompts now carry a blueprint** (page canvas, every section with verbatim copy, sizes and layout, and each illustrated asset with counts, offsets and rotations) next to the 27 dimensions, and "Copy prompt" asks for one self-contained HTML file that follows it. Reason: the first prompts described the style but not the page, so a model rebuilding from them invented its own text and sections. This reverses the plan's "transfer the system, not the subject" for web mode. On Groq's small budget the observe step is two calls per frame (layout, then design), about a minute for one image; larger budgets do both in one call. Image mode is unchanged.
- Limits seen: Groq's vision model reads the copy and structure well but its px estimates stay near typical defaults (72px headline for a 94px one). Old entries have no blueprint; retry them to get one.

- **Second key, same provider.** `GROQ_API_KEY_FALLBACK` (or `<KEY>_FALLBACK` for any provider) is used at once while the first key waits for its per-minute window, and after a quota of hours or a rejected key. Other providers are still never tried. Needs a server restart to be read.
- The Groq model dropdown used to offer text-only models for images (gpt-oss), which caused "`reasoning_effort` must be one of low, medium, high" (the image model's `none` switch sent to a model that rejects it). Overridden models now go out without the provider's model-specific switches, and Groq's gpt-oss/allam models are no longer offered for images.

## Open items
- After code changes the dev server must be restarted (`npm run dev`): the background worker keeps running the code it started with.
- A working `GROQ_API_KEY` is needed. Then run `npm run analyze -- test-images/web-linear.png` and compare the "estimated" and "counted" token lines: if Groq counts the JSON schema as input, set `schemaOverhead` in `src/lib/jobs/worker.ts` so requests stay under the per-minute limit.
- Prompt tuning against real references has not happened yet (plan milestone 2). Six real images are in `test-images/`.
- Dialogs move focus in and restore it on close but do not trap Tab inside.
