# Subject modes for Visualize, palette copy, tracker and cost mods

Asked for on 4 Oct 2026. "Rising Sun Minimal" rendered a robot because the prompt says "with a subject of your own": the analysis keeps the style and drops the subject on purpose. Reference tools split this the same way (Midjourney: style reference, omni reference, image prompt; Leonardo: style, content, character), so Visualize gets a subject choice, and models that accept an image can be shown the original.

## 1. Subject modes
- [x] Image specs keep the subject (the observation's gist) as `subject`; older entries describe it on demand with one small vision call
- [x] Prompt variants: Recreate it (same subject and composition), My own subject, Model's choice
- [x] Visualize dialog: subject choice with an editable subject, remembered; "Show the model the original image" for models that take one (POST /v1/images/edits)
- [x] Tests for the prompt variants, the request and the edits call

## 2. Palette
- [x] Clicking a colour in the palette copies it (circles and bar)

## 3. Progress tracker mod
- [x] Full-width bar for the whole plan with a checkpoint per task
- [x] Partial progress inside a task (ticked steps, files touched), so squares fill gradually
- [x] Animations: a pulse when a step lands, a bigger one when a task finishes, a celebration when the plan does
- [x] Updates live during a response, not only at the end

## 4. Cost ticker mod
- [x] Session cost survives closing and reopening Claude (kept on disk per session)

## 5. Wrap-up
- [x] Tests, type check, build; README, BUILDLOG and memory updated
