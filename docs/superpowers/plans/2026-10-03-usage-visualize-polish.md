# Polish pass: Visualize prompts, auto-pick, palette dots, provider order, Usage page

Asked for on 3 Oct 2026 after using the first Visualize/palette build. Each item is ticked when it is built and checked.

## 1. Visualize sends the full prompt
- [x] Pollinations backends POST to `/v1/images/generations` (prompts up to 32,000 characters); keyless stays a capped URL
- [x] Entry Visualize sends the whole "Copy prompt" text (instruction + JSON)
- [x] One live check with a cheap model

## 2. Image model picker
- [x] AutoPick: Strongest, Balanced, Cheapest (Elo, Pollen per image and seconds per image)
- [x] Backends only (Pollinations, Community, Keyless); no family chips; clear selected state
- [x] "Use this for every Visualize" removed; the dialog's choice is remembered

## 3. Palette
- [x] No palette on the small cards
- [x] Entry page: circles under the image instead of a bar beside the tags

## 4. Providers
- [x] Move providers up and down in Settings
- [x] "Use the next one in line if it fails", off by default

## 5. Usage page
- [x] In-use card: three swappable views fill the empty side (Forecast, Timeline, Mix)
- [x] Explorer: provider and model filters (either, both or neither), step, result, range, quick lenses, pages of 10
- [x] Other providers as a compact strip instead of a long list

## 6. Wrap-up
- [x] Tests, type check, build; README, BUILDLOG and memory updated
