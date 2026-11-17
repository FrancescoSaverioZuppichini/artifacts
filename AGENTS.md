# AGENTS.md · pinboard: how to publish a page

pinboard is a local board where agents and people drop pages: media, text, notes. You (the agent) write files next to your renders; a person reads them at
`http://127.0.0.1:8800/<folder>` with a sidebar TOC, foldable steps, small cards, a full-screen viewer and a synced
side-by-side player, and leaves votes and notes that you read back from `feedback.json`.

**Publishing = writing files. No build, no restart, no preview generation.**

## 1. Start the server (once per boot)

```sh
bun install                                   # first time only
nohup bun server.ts > /tmp/pinboard.log 2>&1 & # http://127.0.0.1:8800, lists every page at /
```

Pages are found under `REVIEW_ROOTS` (default `~/Documents:~/Downloads`, up to 3 folders deep). Any folder holding a
`page.mdx` is a page; its URL is the folder name, so keep folder names unique. Port: `PORT` (default 8800).
Edit `app.tsx` / `styles.css` → restart. Edit page files → nothing, the page refreshes itself within 5 s.

## 2. Write a page

```
my-experiment/
  page.mdx        the article: frontmatter + prose + components (you write it once)
  page.json       generated steps (scripts rewrite it, only when the content changed)
  feedback.json   written by the app: the reader's votes and notes (never write it)
  in/ out/ ...    your media, anywhere; src paths are relative to the page folder
```

**page.mdx** (hand-written; see `examples/hello/page.mdx`):

```mdx
---
title: My experiment
description: One line under the title.
order: oldest-first            # or newest-first; decides which 2 dated steps start open
---

<Step id="step1" when="Tue 17 Nov 2026 · 10:00" title="Try the mask" mark="★ ❓" tags={["seed 1001"]}>
**Why:** one sentence. Tags like `<Video 1>` go in backticks in prose.

<Gallery title="Inputs">
  <Media id="orig" src="in/original.mp4" title="<Video 1> · original" meta={{ length: "3 s" }} />
</Gallery>

<Prompt src="p/prompt.txt" title="Prompt · verbatim" />

<Gallery title="Results">
  <Media id="r1" src="out/r1.mp4" title="arm A" mark="★" verdict="looks right" time="1.2 min" compare="orig" />
</Gallery>
</Step>

{props.data.steps.map((s) => <Step key={s.id} {...s} />)}
```

**page.json** (generated; the safe place for script-written text, no MDX escaping):

```json
{ "steps": [ {
  "id": "step2", "when": "Tue 17 Nov 2026 · 11:00", "title": "A generated step", "mark": "✅", "tags": ["seed 2002"],
  "text": "Markdown; `<Video 1>`, { } and < are fine here",
  "inputs":  [ { "id": "orig2", "src": "in/original.mp4", "title": "original", "meta": { "length": "3 s" } } ],
  "prompt":  { "src": "p/prompt.txt", "title": "Prompt · verbatim" },
  "results": [ { "id": "r2", "src": "out/r2.mp4", "title": "arm B", "mark": "✅", "verdict": "kept", "time": "1.1 min", "compare": "orig2" } ]
} ] }
```

Write `page.json` to a `.tmp` file and rename it, and only when its content changed (no clocks or counters: every
change re-renders the reader's page).

## 3. Check, then hand over the link

```sh
curl -s 127.0.0.1:8800/api/check/my-experiment
# {"ok":true,"steps":2,"items":4,"missing":["out/r3.mp4"],"errors":[],"warnings":[],"links":{"step1":"http://127.0.0.1:8800/my-experiment#step1"}}
```

- `ok:false` → fix it first (MDX compile error with line:column, broken JSON, duplicate ids). The page keeps showing
  the last good version with a red banner meanwhile.
- `missing` → files not there yet. They show as ⏳ cards and fill in by themselves when the file lands, so write the
  result cards **before** the render finishes.
- Hand over the step link (`…/my-experiment#step1`), never just a page name.

## 4. Read the feedback

```sh
jq -r 'to_entries[] | "[\(.value.step // .key)] \(.value.title) | \(.value.vote // "-") | \(.value.note)"' my-experiment/feedback.json
jq -r --arg t "2026-11-17T09:00" 'to_entries[] | select(.value.updatedAt > $t) | "\(.key): \(.value.note)"' my-experiment/feedback.json   # since a time
```

Each card and each step has `{vote: "up"|"down"|null, note, updatedAt, kind: "item"|"step", step, title, src}`.
Read it after every round, before proposing the next step, and quote back what you acted on.

## Components

| Component | Props (* = required) |
|---|---|
| `<Step>` | `id`*, `title`*, `when`, `mark`, `tags`, `open`, `text`, `inputs`, `prompt`, `results`, children. Renders header → text → children → Inputs → Prompt → Results → note box. Foldable; feeds the TOC. |
| `<Gallery>` | `title`, `items`, or `<Media>` children. A row of fixed-height cards. |
| `<Media>` | `src`*, `id` (defaults to `src`; the feedback key, unique on the page), `title`, `mark`, `verdict`, `time`, `meta` (chips), `compare` (an item id or a path: opens with a wipe against it). Image or video by extension. |
| `<Prompt>` | `src` (file shown verbatim) or `text` or a fenced block child, `title`. Collapsed, Copy button. |

`mark` is any of ✅ ❌ ★ ★★ ❓ (❓ = amber "your verdict" badge).

## Rules

1. Point `src` at the raw files; the server makes thumbnails and previews itself (cached in `<page>/.review-cache/`).
2. Every step shows its inputs and the prompt **before** the results; put `time` on every judged result.
3. Never hide a result: a failed one gets `mark="❌"` and a `verdict`, not deletion.
4. Ids are unique across the whole page (the check enforces it).
5. Videos must be H.264 / VP9 / AV1 (the check flags anything else).
6. In MDX prose, a bare `<` or `{` breaks the compile: use backticks, or put generated text in `page.json`.
7. One page per project; add steps instead of new pages or ports.

## Links

`/<page>#<step-or-card-id>` opens and scrolls to it · `/<page>?pick=a,b` rings several cards · `/` lists every page.

## Try it

`examples/hello/` is a complete page (3 s test videos, an image, a prompt, one card left ⏳ on purpose):
start the server from this folder, open `http://127.0.0.1:8800/hello`.
