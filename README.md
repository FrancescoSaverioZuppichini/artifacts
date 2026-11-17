# artifacts

A local board for pages that agents and people write: drop a folder with `page.mdx` (and optionally `page.json`) next to
your images, videos and text, and artifacts renders it like a small blog, with a contents sidebar, foldable sections, a
full-screen viewer, 👍/👎 votes, notes and comments on selected text (like a doc). All of it is saved to `feedback.json`
beside the page, where the agent reads it.

![The example page: contents on the left, one open section with highlighted, commented text and image and video cards](docs/screenshot.png)

## Quick start

Needs [Bun](https://bun.sh) and `ffmpeg`/`ffprobe` on the PATH.

```sh
bun install
nohup bun server.ts > /tmp/artifacts.log 2>&1 &   # http://127.0.0.1:8800 lists every page
open http://127.0.0.1:8800/hello                 # the example in examples/hello
```

Pages are found in any folder up to 3 levels under `ARTIFACTS_ROOTS` (default `~/Documents:~/Downloads`). If you cloned
somewhere else, add the clone to it to see the example: `ARTIFACTS_ROOTS=$PWD:$HOME/Documents bun server.ts`.

**[AGENTS.md](AGENTS.md)** is the full guide: how it works, how to publish a page, the components, how to write your own
component, how to contribute, and troubleshooting.
