# pinboard

A local pinboard for pages: you and your agents drop media, text and notes; it renders them as a mini blog. An agent writes `page.mdx` (+ optional `page.json`) in a project folder; the reviewer reads it at `http://127.0.0.1:8800/<folder>` with a sidebar TOC, foldable steps, a full-screen viewer and a synced side-by-side player. Their votes and notes land in `feedback.json` next to the page.

## Start / stop

One server for every page. It is not a launchd service; start it by hand (once per boot):

```sh
cd pinboard && nohup bun server.ts > /tmp/pinboard.log 2>&1 &   # start
pgrep -fl "bun server.ts"                                               # is it up?
pkill -f "bun server.ts"                                                # stop (run it as its own command, not inside an ssh one-liner)
```

Client code (`app.tsx`, `styles.css`) is bundled at start, so restart after editing it. Page files never need a restart.
Port: `PORT=8800` (default). Roots searched for pages: `REVIEW_ROOTS` (default `~/Documents:~/Downloads`).

## How an agent publishes a page

1. Put the media in the project folder (or anywhere under the roots; `src` is relative to the page folder and may use `../`).
2. Write `page.mdx` once: frontmatter + prose + components. Write `page.json` whenever the data changes, **only when the content changed**, to `.tmp` then rename. No clocks or counters.
3. Check it, then hand over the link:

```sh
curl -s 127.0.0.1:8800/api/check/<folder>
# {"ok":true,"steps":18,"items":70,"missing":[...],"errors":[],"warnings":[...],"url":"…","links":{"step11":"http://127.0.0.1:8800/<folder>#step11"}}
```

`ok:false` means an error: MDX compile error with line:column, broken `page.json`, duplicate ids. The page keeps showing the last good version with a red banner. Fix it before handing the page over. `missing` = files not there yet (they show as ⏳ cards and fill in by themselves within 5 s of landing). Then hand over **the step link**, never just a name.

A page is any folder up to 3 levels under a root that holds `page.mdx`; the URL is the folder name (keep it unique). `/` lists all pages.

### page.mdx

```mdx
---
title: Experiment log · the last two days
description: One line under the title.
order: oldest-first
---

<Step id="how" title="How to read this page" open>
Prose in **Markdown**. Write `<Video 1>` only inside backticks.
</Step>

<Step id="step11" when="Mon 16 Nov 2026 · 16:00" title='You: "retry with the mask"' mark="★★ ❓" tags={["seed 1001"]}>
**Why this method:** …

<Gallery title="Inputs">
  <Media id="pm-o" src="in/orig-clip.mp4" title="<Video 1> · original clip" meta={{ length: "8.4 s" }} />
</Gallery>

<Prompt src="p/prompt-clip.txt" title="Prompt · verbatim" />

<Gallery title="Results">
  <Media id="pm-r1" src="out/r1.mp4" title="result" mark="★★" verdict="background untouched · ❌ one artefact" time="10.3 min" compare="pm-o" />
</Gallery>
</Step>

{props.data.steps.map((s) => <Step key={s.id} {...s} />)}
```

### page.json (generated steps; the safe format for script-written text)

```json
{ "steps": [ {
  "id": "step11", "when": "Mon 16 Nov 2026 · 16:00", "title": "You: \"…\"", "mark": "★★ ❓", "tags": ["seed 1001"], "open": false,
  "text": "Markdown, `<Video 1>` is safe here",
  "inputs":  [ { "id": "pm-o", "src": "in/orig-clip.mp4", "title": "original", "meta": { "length": "8.4 s" } } ],
  "prompt":  { "src": "p/prompt.txt", "title": "Prompt · verbatim" },
  "results": [ { "id": "pm-r1", "src": "out/r1.mp4", "title": "result", "mark": "★★", "verdict": "…", "time": "10.3 min", "compare": "pm-o" } ]
} ] }
```

`order: newest-first` in the frontmatter makes the first two dated steps open by default (default: the last two). `prompt` may be one object or a list; each takes `src` (file shown verbatim) or `text`.

### Components

| | Props |
|---|---|
| `<Step>` | `id`*, `title`*, `when`, `mark`, `tags`, `open`, `text`, `inputs`, `prompt`, `results`, children. Renders: header → text → children → Inputs → Prompt → Results → step note box. |
| `<Gallery>` | `title`, `items`, children (`<Media>`) |
| `<Media>` | `src`*, `id` (defaults to `src`; feedback key, unique on the page), `title`, `mark`, `verdict`, `time`, `meta`, `compare` (item id or path) |
| `<Prompt>` | `src` or `text` or a fenced block as child, `title`. Collapsed with a fade, click opens, Copy button. |

`mark` is a string of ✅ ❌ ★ ★★ ❓; ❓ shows as an amber "your verdict" badge.

### MDX rules

- In prose, `<Video 1>`, `<Subject 1>` etc. only inside backticks. Inside a quoted attribute `<` is fine. A bare `{` or `<` in prose breaks the compile.
- Prompts go through `<Prompt src>` (the exact file that was fed) or a fenced block, never bare prose.
- Script-generated text goes in `page.json`, not in the MDX.
- `/api/check` reads MDX ids and srcs as literal attributes only; keep them literal.

## Rules carried over (they cost hours when broken)

1. **No preview making.** Point `src` at raw renders. The server makes grid thumbnails (480 px high) and viewer previews (1600 px) with ffmpeg, cached in `<page folder>/.review-cache/`. The grid never loads a video; videos play only in the viewer or side-by-side.
2. **Rewrite `page.json` only when its content changed.** No ticking clocks, timestamps or counters.
3. **Never hide a render.** Write the expected result cards up front; a missing file is a ⏳ card that fills in when the file lands. Verdicts go in `mark` + `verdict`, not hidden.
4. **Every step shows what goes in before the results:** model, sampler, size, seed, every picture fed, the prompt verbatim, what differs per column. `inputs` + `prompt` always render before `results`; `check` warns on results without inputs. Inputs are plain cards (no `compare`).
5. **⏱ on every judged result** (`time`); `check` warns when a result with a mark or verdict has none.
6. **Read `feedback.json` after every round and before proposing the next step**, act on it and quote it back.
7. **One page per project, one server for all.** No extra ports; add a step. Give the direct `#<step>` link.
8. **Unique ids across the page, verified on the server** (`/api/check`), never from the local file.
9. **Compare (wipe) rules:** post-process vs the render before it; A/B arm vs the other arm; plain swap vs the photo. Only on results.
10. **Video must be H.264** (or VP9/AV1). `check` flags anything else and the card shows ⚠; re-encode it.

## Links

- `/<folder>#<id>`: opens and scrolls to a step, or rings a card (`#pm-r1`).
- `/<folder>?pick=pm-r1,pm-b`: rings several cards and opens on the first.
- `?section=<id>` still works as an alias for `#<id>`.

## Feedback

`<page folder>/feedback.json`, the same shape as the old app (old entries keep their `set`/`section` fields):

```json
{ "pm-r1": { "vote": "up", "note": "…", "updatedAt": "2026-11-17T10:02:11.481Z", "kind": "item", "step": "step11", "stepTitle": "…", "title": "result", "src": "out/r1.mp4" },
  "step11": { "vote": null, "note": "…", "updatedAt": "…", "kind": "step", "title": "…" } }
```

Read what changed since the last round:

```sh
jq -r --arg t "2026-11-17T09:00" 'to_entries[] | select(.value.updatedAt > $t)
  | "[\(.value.step // .key)] \(.value.title // .value.section) | \(.value.vote // "-") | \(.value.note)"' <page folder>/feedback.json
```

## Keys (viewer / side by side)

Viewer: ←/→ move through every card on the page, Ctrl/⌘+Enter saves the note and moves on, Esc closes, 👍/👎, Hide overlays, ⬇ original. A card with `compare` opens with the wipe, both videos on one clock; sound is the result's only.
Side by side (▶ button on a step with ≥2 videos): one clock, untick columns, pick the sound, ←/→ one frame, space plays.

## Files

`server.ts` (discovery, MDX compile, probes, thumbnails, Range media, feedback, check) · `app.tsx` (page, steps, cards, viewer, side by side, TOC) · `styles.css` · `types.ts` · `examples/hello/` (a self-contained example page that uses every component).
