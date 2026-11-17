# AGENTS.md · pinboard

pinboard renders folders of media and text as pages: a sidebar of contents, foldable sections, small cards, a full-screen
viewer with a compare wipe, a synced side-by-side player, and 👍/👎 plus notes that land in `feedback.json`.
**Publishing a page means writing files.** No build step, no restart, no thumbnails to make.

- [How it works](#how-it-works)
- [Publish a page](#publish-a-page)
- [Components](#components)
- [Write a custom component](#write-a-custom-component)
- [Rules for agents](#rules-for-agents)
- [Contribute](#contribute)
- [Troubleshooting](#troubleshooting)

## How it works

```
server.ts          Bun server: page discovery, MDX compile, media probes, thumbnails, Range video, feedback, /api/check
app.tsx            client entry: picks the page or the list of pages
shell/             the page around the content: layout + polling (page.tsx), contents (toc.tsx), viewer.tsx,
                   side-by-side.tsx, the shared video clock (player.tsx), feedback store and URLs (state.ts)
components/        everything a page can use, one component per file, registered in components/index.ts
types.ts           the page.json schema and the feedback entry
examples/hello/    a page that uses every component
```

One request, start to finish:

1. **Discovery.** Any folder up to 3 levels under `PINBOARD_ROOTS` (default `~/Documents:~/Downloads`) that holds a
   `page.mdx` is a page; its URL is the folder name (`/my-run`). Dot folders and `node_modules` are skipped. The scan is
   cached for 10 s and redone at once for an unknown name, so a new page needs no restart.
2. **MDX compile.** `page.mdx` is compiled to a JS function body on the server, once per change of the file (mtime +
   size). Frontmatter (`title`, `description`, `order`) is read separately. On a compile error the last good version is
   kept and the error (with line:column) goes to the page's red banner and to `/api/check`.
3. **Data merge.** `GET /api/page/<name>` answers with one JSON: the compiled MDX, `page.json` as parsed, a probe for
   every file the page points at (size, duration, codec, or `null` when missing), the frontmatter and `feedback.json`.
   The server finds files by walking `page.json` (every `src` and `compare`) and by reading literal `src=`/`compare=`
   attributes in the MDX.
4. **Render.** The client evaluates the MDX with `components/index.ts` as its components and `page.json` as
   `props.data`, so `{props.data.sections.map((s) => <Section key={s.id} {...s} />)}` draws the generated sections.
   A `Section`'s `blocks` are rendered by looking each `type` up in the same registry.

**Thumbnails.** Cards never load a video. `/t/<page>?src=` returns a JPEG frame made by ffmpeg (480 px high for cards,
1600 px long side for the viewer), at most 4 encodes at a time, cached in `<page>/.review-cache/` under a key that
includes the file's size and mtime, so a re-rendered file gets a new thumbnail by itself. Videos play only in the viewer
and in side by side, served by `/f/<page>?src=` with Range support.

**Polling.** Each open tab asks for the page every 5 s with the last ETag; the server answers `304` unless `page.mdx`,
`page.json`, a media file or `feedback.json` changed. Hidden tabs skip. Sections open once, the first time they appear
(`open`, plus the two newest dated ones); after that the reader's folding is never touched.

**Feedback.** A vote or a note is saved 300 ms after the last keystroke with `POST /api/feedback`; the server rereads
`feedback.json`, merges the one entry and writes it atomically (tmp + rename). Notes being typed win over a poll. The
file is keyed by card, section or note id:

```json
{ "h-a":    { "vote": "up", "note": "keep this one", "updatedAt": "2026-11-17T10:02:11.481Z", "kind": "media",
              "section": "colours", "sectionTitle": "A gallery of images and videos", "title": "version A", "src": "out/result-a.mp4" },
  "colours": { "vote": null, "note": "try a third version", "updatedAt": "…", "kind": "section", "title": "A gallery of images and videos" } }
```

Entries written by older versions may carry `step`, `stepTitle`, `set`, or `section` holding a title; they still show,
because only the id matters.

## Publish a page

```
my-run/
  page.mdx        the article: frontmatter, prose, components (written by hand, once)
  page.json       generated sections (scripts rewrite it, only when its content changes)
  feedback.json   written by the app: votes and notes (never write it)
  in/ out/ …      your files; every src is relative to the page folder and may use ../ (never outside the roots)
```

**page.mdx** — Markdown plus components:

```mdx
---
title: My run
description: One line under the title.
order: oldest-first        # or newest-first: which end the two auto-opened dated sections come from
---

<Section id="try-1" date="Tue 17 Nov 2026 · 10:00" title="First try" badges={["★", "❓ your call", "seed 1001"]}>
**Why:** one sentence. Write tags like `<Video 1>` inside backticks in prose.

<Gallery title="Sources">
  <Media id="orig" src="in/original.mp4" title="original" badges={["3 s"]} />
</Gallery>

<Code src="p/settings.txt" title="Settings" />

<Gallery title="Versions">
  <Media id="v1" src="out/v1.mp4" title="version 1" caption="looks right" badges={["★", "⏱ 1.2 min"]} compare="orig" />
</Gallery>
</Section>

{props.data.sections.map((s) => <Section key={s.id} {...s} />)}
```

**page.json** — the safe place for script-written text (no MDX escaping). The schema is `PageJson` in `types.ts`: a list
of sections, each with `blocks`; a block is `{ "type": <component name>, ...its props }`.

```json
{ "sections": [ {
  "id": "try-2", "date": "Tue 17 Nov 2026 · 11:00", "title": "Second try", "badges": ["✅ kept", "seed 2002"],
  "blocks": [
    { "type": "Markdown", "text": "Generated text: `<Video 1>`, { } and < are fine here." },
    { "type": "Gallery", "title": "Versions", "items": [
      { "id": "v2", "src": "out/v2.mp4", "title": "version 2", "caption": "kept", "badges": ["✅", "⏱ 1.1 min"], "compare": "orig" } ] },
    { "type": "Code", "title": "Settings", "src": "p/settings.txt" }
  ] } ] }
```

Write `page.json` to a `.tmp` file and rename it, and only when the content changed: no clocks or counters, since every
change re-renders the reader's page.

**Check, then hand over the link:**

```sh
curl -s 127.0.0.1:8800/api/check/my-run
# {"ok":true,"sections":2,"media":3,"missing":["out/v3.mp4"],"errors":[],"warnings":[],"url":"…","links":{"try-1":"http://127.0.0.1:8800/my-run#try-1"}}
```

- `ok:false`: fix it first (MDX compile error with line:column, broken JSON, duplicate id). Meanwhile the page shows the
  last good version under a red banner.
- `missing`: files not there yet. They show as ⏳ cards and fill in by themselves, so write the cards before the file exists.
- `warnings`: videos in a codec Chrome cannot play.
- Hand over the section link (`…/my-run#try-1`), not just the page name.

**Read the feedback** after every round:

```sh
jq -r 'to_entries[] | "[\(.value.section // .key)] \(.value.title) | \(.value.vote // "-") | \(.value.note)"' my-run/feedback.json
jq -r --arg t "2026-11-17T09:00" 'to_entries[] | select(.value.updatedAt > $t) | "\(.key): \(.value.note)"' my-run/feedback.json
```

**Links:** `/<page>#<section-or-card-id>` opens and scrolls to it (a card gets a ring) · `/<page>?pick=a,b` rings
several cards · `?section=<id>` works like `#<id>` · `/` lists every page with its ❓ count and notes.

**Keys:** viewer: ←/→ every card on the page, Ctrl/⌘+Enter saves the note and moves on, Esc closes. Side by side (the
▶ button on a section with 2+ videos): one clock for all columns, untick columns, pick the sound, ←/→ one frame, space plays.

## Components

All in `components/`, registered in `components/index.ts`. The same names work as MDX tags and as `page.json` block types.

| Component | Props (* required) | What it renders |
|---|---|---|
| `Section` | `id`*, `title`*, `date`, `badges`, `open`, `blocks`, children | A foldable chapter: listed in the contents, a note box at the end, a side-by-side button when it holds 2+ videos. `blocks` render before children. |
| `Gallery` | `title`, `items` (list of `Media` props), children | A row of fixed-height cards. |
| `Media` | `src`*, `id` (defaults to `src`), `title`, `caption`, `badges`, `compare` | An image or video card (by extension). Click opens the viewer; with `compare` (another card's id, or a path) the viewer opens with a wipe against it. |
| `Code` | `src` or `text` or children, `title` | Verbatim text, folded to a few lines with a Copy button. `src` is re-read when the file changes. |
| `Badge` | children (text) | A chip. Text starting with ✅ ❌ ★ ❓ is a coloured status; status badges also show next to titles and in the contents, and ❓ counts as "waiting" on the page list. |
| `Note` | `id`*, `placeholder` | A note box saved to `feedback.json` under `id` (kind `note`). Use it to ask the reader something specific. |
| `Markdown` | `text`* | Markdown from a string; for `page.json`, where MDX is not parsed. |

`badges` everywhere is a list of strings, each drawn as a `Badge`. Ids (sections, cards, notes) are feedback keys and
must be unique on the page; keep them stable, or old notes detach.

## Write a custom component

1. Create `components/<name>.tsx` exporting a function named like the file in PascalCase (`metric.tsx` → `Metric`).
2. Register it: import it in `components/index.ts` and add it to the `components` object.
3. Restart the server (client code is bundled at start).

It receives its props from the MDX attributes or from the `page.json` block (every key except `type`). For page state,
import from `shell/state.ts`: `PageCtx` (media probes, open the viewer), `SectionCtx` (the section it is in),
`fileUrl(src)` to fetch a page file, `useReview(id)` / `edit(id, …)` to read and write feedback. Style with Tailwind and
the classes in `styles.css` (`chip`, `badge`, `btn`, `label`); add `not-prose` so the article typography leaves it alone.

```tsx
// components/metric.tsx
export function Metric({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
	return <div className="not-prose mt-3 mr-2 inline-flex flex-col rounded-md border bg-muted px-3 py-2">
		<span className="text-xs text-muted-foreground">{label}</span>
		<b className="text-xl">{value}{unit && <span className="ml-1 text-sm text-muted-foreground">{unit}</span>}</b>
	</div>;
}
```

```ts
// components/index.ts
import { Metric } from "./metric";
export const components = { Badge, Code, Gallery, Markdown, Media, Metric, Note, Section };
```

Use it as `<Metric label="Sharpness" value={31.2} unit="dB" />` in MDX, or as
`{ "type": "Metric", "label": "Sharpness", "value": 31.2, "unit": "dB" }` in a section's `blocks`.

Add a component to the repo only when it is general (nothing about one project) and earns its place; otherwise compose
the existing ones.

## Rules for agents

1. Point `src` at the raw files. The server makes thumbnails and previews; never make your own.
2. Generated text goes in `page.json`. In MDX prose a bare `<` or `{` breaks the compile: use backticks.
3. Rewrite `page.json` only when its content changed, via `.tmp` + rename.
4. Never hide a result: a failed one stays, with a ❌ badge and a caption saying why.
5. Ids unique across the page and stable over time; `/api/check` enforces uniqueness.
6. Videos in H.264, VP9 or AV1.
7. One page per project, one server for every page. Add sections, not pages or ports.
8. Never write `feedback.json`; read it after every round and quote back what you acted on.
9. Run `/api/check` after every change and hand over the `#section` link.

## Contribute

**Run it:** `bun install`, then `bun server.ts` (or the `nohup` line from the README). Restart after any change to
`server.ts`, `app.tsx`, `shell/`, `components/` or `styles.css`; page files never need a restart. Stop it with
`pkill -f "bun server.ts"` run as its own command.

**Code rules:**

- Page components live in `components/`, one per file, export named like the file, registered only in
  `components/index.ts`. The page shell (layout, contents, viewer, side by side) lives in `shell/` and is not a page component.
- General only: nothing in this repo may be about one project. Project-specific shapes belong in a converter in that project.
- No abstraction without a second use, no dead code, no defensive checks for things that cannot happen.
- Comments only where the why is not obvious: one or two plain-English lines above the code, prefixed `[Agent]` when an
  agent wrote them. No narration, no doc blocks.
- Keep behaviour backward compatible for `feedback.json`: entries are keyed by id and merged, never rewritten wholesale.

**Verify a change:**

```sh
bunx -p typescript tsc --noEmit -p .                    # types
pkill -f "bun server.ts"                                # then start it again
curl -s 127.0.0.1:8800/api/check/hello                  # ok:true, 0 errors (out/result-c.mp4 is missing on purpose)
```

Then open `http://127.0.0.1:8800/hello` in a browser (or headless Chrome) and click through: a card opens the viewer, a
card with `compare` shows the wipe, a note saves to `examples/hello/feedback.json` (git-ignored), side by side plays in
sync, the console has no errors. If you change how the example looks, retake `docs/screenshot.png` (1400 px wide,
contents visible, one section open).

**Commits:** small [conventional commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `refactor:`, `docs:`,
`chore:`; `!` for a breaking change to the page format), one concern each.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Page stuck on "Loading …" | The first request probes every file of the page with ffprobe (8 at a time), so a page with hundreds of new files takes a while once. `curl -s 127.0.0.1:8800/api/check/<page>` shows whether the server answers; look in `/tmp/pinboard.log`. |
| "Page not found" | The folder is deeper than 3 levels, under a dot folder, outside `PINBOARD_ROOTS`, or shares its name with another page (the first one found wins). "Failed to fetch" means the server is down. |
| Red banner `page.mdx L:C …` | MDX compile error: a bare `<` or `{` in prose, an unclosed tag, or a broken `{…}` expression. Fix the line; the last good version shows meanwhile. |
| Red banner "failed to render: Expected component `X` to be defined" | The tag `X` is not in `components/index.ts`. Any other "failed to render" message is a component that threw. |
| "Unknown block type" inside a section | A `page.json` block's `type` is not a registered component name. |
| ⚠ codec chip on a card, warning in `/api/check` | The video is not H.264/VP9/AV1. Re-encode: `ffmpeg -i in.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart out.mp4`. |
| ⏳ card never fills | The `src` path is wrong (relative to the page folder) or points outside the roots. `/api/check` lists it under `missing`. |
| Old notes gone from a card | Its id changed. Feedback is keyed by id; restore the old id. |
| Client change not showing | The client is bundled at server start: restart the server. |
