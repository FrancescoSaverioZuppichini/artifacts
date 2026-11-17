#!/usr/bin/env bun
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve, sep } from "node:path"
import { compile } from "@mdx-js/mdx"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"
import index from "./index.html"
import { type Feedback, type PageJson, type Probe, playable } from "./types"

const PORT = Number(process.env.PORT ?? 8800)
const ROOTS = (process.env.ARTIFACTS_ROOTS ?? `${homedir()}/Documents:${homedir()}/Downloads`).split(":")
const MEDIA = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?|mp4|webm|mov|m4v|mkv)$/i
const VIDEO = /\.(mp4|webm|mov|m4v|mkv)$/i

const stat = (file: string) => statSync(file, { throwIfNoEntry: false })
// [Agent] mtime alone misses two writes inside the same millisecond; size catches most of those.
const getStamp = (file: string) => {
	const s = stat(file)
	return s ? `${s.mtimeMs}-${s.size}` : ""
}
const inRoots = (file: string) => ROOTS.some((root) => file.startsWith(root + sep))
const missing = (what: string) => Response.json({ error: `Not found: ${what}` }, { status: 404 })

// [Agent] A page is any folder up to 3 levels under a root that holds page.mdx; the URL is the folder name.
// Rescanned at most every 10 s, and at once on an unknown name, so a new page shows up without a restart.
let pages = new Map<string, string>()
let scannedAt = 0
function scanPages(force = false) {
	if (!force && Date.now() - scannedAt < 10_000) return pages
	const found = new Map<string, string>()
	const walk = (dir: string, depth: number) => {
		let entries
		try {
			entries = readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		const name = basename(dir)
		if (depth && !found.has(name) && entries.some((e) => e.name === "page.mdx")) found.set(name, dir)
		for (const e of entries) {
			if (depth < 3 && e.isDirectory() && e.name[0] !== "." && e.name !== "node_modules") {
				walk(join(dir, e.name), depth + 1)
			}
		}
	}
	for (const root of ROOTS) walk(root, 0)
	scannedAt = Date.now()
	pages = found
	return pages
}
const getDir = (name: string) => scanPages().get(name) ?? scanPages(true).get(name)

// [Agent] At most n ffmpeg/ffprobe processes at once; 300 cards opened together would otherwise fork 300
// encoders.
function limit(n: number) {
	let active = 0
	const queue: (() => void)[] = []
	return async <T>(job: () => Promise<T>): Promise<T> => {
		while (active >= n) await new Promise<void>((done) => queue.push(done))
		active++
		try {
			return await job()
		} finally {
			active--
			queue.shift()?.()
		}
	}
}
const probeSlot = limit(8)
const thumbSlot = limit(4)

async function run(cmd: string[]) {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
	const [out, err, code] = await Promise.all([
		new Response(p.stdout).text(),
		new Response(p.stderr).text(),
		p.exited,
	])
	if (code) throw Error(err.trim().split("\n").pop() || `${cmd[0]} exit ${code}`)
	return out
}

// [Agent] Size, duration and codec per file, kept until the file changes. Cards get their aspect ratio from
// this before any pixel loads (no layout shift); a file that is not there yet (or still being written) is
// null: ⏳.
const probes = new Map<string, { stamp: string; probe: Probe }>()
async function probe(file: string): Promise<Probe | null> {
	const s = stat(file)
	if (!s?.isFile()) return null
	const stamp = `${s.size}-${Math.floor(s.mtimeMs)}`
	const hit = probes.get(file)
	if (hit?.stamp === stamp) return hit.probe
	const video = VIDEO.test(file)
	let result: Probe = { v: Bun.hash(stamp).toString(36), video, w: 0, h: 0 }
	if (MEDIA.test(file)) {
		const args =
			"-v error -select_streams v:0 -show_entries stream=width,height,codec_name:format=duration -of json"
		try {
			const out = JSON.parse(await probeSlot(() => run(["ffprobe", ...args.split(" "), file])))
			const { width = 0, height = 0, codec_name } = out.streams?.[0] ?? {}
			const dur = Number(out.format?.duration) || 0
			result = {
				...result,
				w: width,
				h: height,
				codec: video ? codec_name : undefined,
				dur: video ? dur : undefined,
			}
		} catch {
			return null
		}
	}
	probes.set(file, { stamp, probe: result })
	return result
}

// [Agent] page.mdx and page.json are parsed once per change. On an error the last good value stays and the
// error travels to the page banner and /api/check.
type Parsed<T> = { stamp: string; raw: string; value: T; error?: string }
const parsed = new Map<string, Parsed<unknown>>()
async function parseFile<T>(file: string, parse: (raw: string) => T | Promise<T>, empty: T) {
	const stamp = getStamp(file)
	const old = parsed.get(file) as Parsed<T> | undefined
	if (old?.stamp === stamp) return old
	const raw = stamp ? readFileSync(file, "utf8") : ""
	let entry: Parsed<T>
	try {
		entry = { stamp, raw, value: await parse(raw) }
	} catch (e) {
		entry = { stamp, raw, value: old?.value ?? empty, error: (e as Error).message }
	}
	parsed.set(file, entry)
	return entry
}

// [Agent] Frontmatter is read by a regex and swapped for blank lines, so the line numbers in compile errors
// match the file the agent wrote.
async function compileMdx(raw: string) {
	const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw)
	const meta: Record<string, string> = {}
	for (const [, k, v] of (fm?.[1] ?? "").matchAll(/^(\w+):\s*(.*)$/gm))
		meta[k] = v.startsWith('"') ? JSON.parse(v) : v
	const body = fm ? "\n".repeat(fm[0].split("\n").length - 1) + raw.slice(fm[0].length) : raw
	try {
		const options = { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }
		return { code: String(await compile(body, { outputFormat: "function-body", ...options })), meta }
	} catch (e) {
		const err = e as { line?: number; column?: number; reason?: string; message: string }
		throw Error(`page.mdx ${err.line ?? "?"}:${err.column ?? "?"} ${err.reason ?? err.message}`)
	}
}

function parseJson(raw: string): PageJson {
	try {
		return raw ? JSON.parse(raw) : {}
	} catch (e) {
		throw Error(`page.json: ${(e as Error).message}`)
	}
}

function readFeedback(dir: string): Record<string, Feedback> {
	try {
		return JSON.parse(readFileSync(join(dir, "feedback.json"), "utf8"))
	} catch {
		return {}
	}
}

// [Agent] Everything a page points at. page.json is walked whole, so blocks of any component count, custom
// ones included. The MDX side is a regex over literal attributes of capitalised tags: all agents are told to
// write there.
function scanRefs(raw: string, data: PageJson) {
	const ids: string[] = []
	const files = new Set<string>()
	const refs: string[] = []
	const badges: string[] = []
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) return v.forEach(walk)
		if (!v || typeof v !== "object") return
		const o = v as Record<string, unknown>
		if (typeof o.id === "string") ids.push(o.id)
		if (typeof o.src === "string") files.add(o.src)
		if (typeof o.compare === "string") refs.push(o.compare)
		if (Array.isArray(o.badges)) badges.push(...o.badges)
		Object.values(o).forEach(walk)
	}
	walk(data)
	const attr = (name: string, tag = "[A-Z]\\w*") =>
		[...raw.matchAll(new RegExp(`<${tag}\\b[^>]*?\\b${name}=["']([^"']+)["']`, "g"))].map((m) => m[1])
	ids.push(...attr("id"))
	for (const src of attr("src")) files.add(src)
	refs.push(...attr("compare"))
	for (const [, list] of raw.matchAll(/badges=\{\[([^\]]*)\]\}/g)) badges.push(list)
	for (const ref of refs) if (!ids.includes(ref)) files.add(ref)
	return {
		ids,
		sections: [...attr("id", "Section"), ...(data.sections ?? []).map((s) => s.id)],
		files: [...files].filter((f) => !/^https?:/.test(f)),
		waiting: badges.join().match(/❓/g)?.length ?? 0,
	}
}

async function build(name: string, dir: string) {
	const mdx = await parseFile(join(dir, "page.mdx"), compileMdx, { code: "", meta: {} })
	const data = await parseFile(join(dir, "page.json"), parseJson, {})
	const found = scanRefs(mdx.raw, data.value)
	const media: Record<string, Probe | null> = {}
	await Promise.all(
		found.files.map(async (src) => {
			const file = resolve(dir, src)
			media[src] = inRoots(file) ? await probe(file) : null
		}),
	)
	const dupes = new Set(found.ids.filter((id, i) => found.ids.indexOf(id) !== i))
	const errors = [mdx.error, data.error, ...[...dupes].map((id) => `duplicate id: ${id}`)].filter(
		(e) => e !== undefined,
	)
	return { name, ...mdx.value, data: data.value, media, errors, found }
}

function check(page: Awaited<ReturnType<typeof build>>) {
	const base = `http://127.0.0.1:${PORT}/${encodeURIComponent(page.name)}`
	const media = Object.entries(page.media)
	return {
		ok: !page.errors.length,
		sections: page.found.sections.length,
		media: page.found.files.filter((f) => MEDIA.test(f)).length,
		missing: media.filter(([, p]) => !p).map(([src]) => src),
		errors: page.errors,
		warnings: media
			.filter(([, p]) => !playable(p?.codec))
			.map(([src, p]) => `${src}: ${p!.codec} does not play in Chrome, re-encode to H.264`),
		url: base,
		links: Object.fromEntries(page.found.sections.map((id) => [id, `${base}#${id}`])),
	}
}

// [Agent] Every JSON answer carries a hash of its body; a tab that already has that version gets an empty
// 304, so the 5 s poll costs nothing.
function sendJson(request: Request, body: unknown) {
	const text = JSON.stringify(body)
	const etag = `"${Bun.hash(text).toString(36)}"`
	if (request.headers.get("if-none-match") === etag)
		return new Response(null, { status: 304, headers: { etag } })
	const headers = { etag, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" }
	return new Response(text, { headers })
}

// [Agent] Bun does not honour Range on a file response, and browsers need it to seek video, so slice the file
// ourselves. A bad range gets 416.
function sendFile(request: Request, file: string) {
	const f = Bun.file(file)
	const etag = `"${f.size}-${Math.floor(f.lastModified)}"`
	const headers = {
		"Cache-Control": "no-cache",
		ETag: etag,
		"Accept-Ranges": "bytes",
		"Content-Type": f.type,
	}
	if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
	const range = request.headers.get("range")
	if (!range) return new Response(f, { headers })
	const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(range) ?? []
	const start = from ? Number(from) : Math.max(0, f.size - Number(to))
	const end = from && to ? Math.min(Number(to), f.size - 1) : f.size - 1
	if ((!from && !to) || start > end || start >= f.size) {
		return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${f.size}` } })
	}
	const partial = { ...headers, "Content-Range": `bytes ${start}-${end}/${f.size}` }
	return new Response(f.slice(start, end + 1), { status: 206, headers: partial })
}

// [Agent] Grid thumbnails are scaled by height (cards have a fixed height, so a wide strip stays sharp);
// viewer previews by the long side. The name holds the probe stamp, so a re-render gets a fresh thumbnail and
// the URL (with ?v=) can be cached forever by the browser.
const pending = new Map<string, Promise<string>>()
async function getThumb(dir: string, file: string, view: boolean) {
	const p = await probe(file)
	if (!p) throw Error("not ready")
	const cache = join(dir, ".review-cache")
	const out = join(cache, `${Bun.hash(`${file}|${p.v}|${view}`).toString(36)}.jpg`)
	if (existsSync(out)) return out
	const make = async () => {
		mkdirSync(cache, { recursive: true })
		const scale = view
			? "scale='if(gt(iw,ih),min(1600,iw),-2)':'if(gt(iw,ih),-2,min(1600,ih))'"
			: "scale=-2:'min(480,ih)'"
		const seek = p.video ? ["-ss", String(Math.min(1, (p.dur ?? 0) / 3))] : []
		await run([
			"ffmpeg",
			"-v",
			"error",
			"-y",
			...seek,
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			scale,
			"-q:v",
			"4",
			"-f",
			"mjpeg",
			`${out}.tmp`,
		])
		renameSync(`${out}.tmp`, out)
		return out
	}
	if (!pending.has(out))
		pending.set(
			out,
			thumbSlot(make).finally(() => pending.delete(out)),
		)
	return pending.get(out)!
}

Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	development: false,
	idleTimeout: 60,
	routes: {
		"/": index,
		"/:page": index,
		"/api/pages": async (request) => {
			const list = await Promise.all(
				[...scanPages(true)].map(async ([name, dir]) => {
					const p = await build(name, dir).catch(() => null)
					return {
						name,
						title: p?.meta.title ?? name,
						description: p?.meta.description ?? "",
						updated: Math.max(...["page.mdx", "page.json"].map((f) => stat(join(dir, f))?.mtimeMs ?? 0)),
						waiting: p?.found.waiting ?? 0,
						notes: Object.values(readFeedback(dir)).filter((r) => r.note?.trim()).length,
					}
				}),
			)
			return sendJson(
				request,
				list.sort((a, b) => b.updated - a.updated),
			)
		},
		"/api/page/:page": async (request) => {
			const name = decodeURIComponent(request.params.page)
			const dir = getDir(name)
			if (!dir) return missing(`page ${name}`)
			const { code, meta, data, media, errors } = await build(name, dir)
			const { title = name, description = "", order = "" } = meta
			const feedback = readFeedback(dir)
			return sendJson(request, { name, title, description, order, code, data, media, errors, feedback })
		},
		"/api/check/:page": async (request) => {
			const name = decodeURIComponent(request.params.page)
			const dir = getDir(name)
			return dir ? Response.json(check(await build(name, dir))) : missing(`page ${name}`)
		},
		"/api/feedback": {
			POST: async (request) => {
				const { page, id, delete: drop, ...entry } = JSON.parse(await request.text())
				const dir = typeof page === "string" && getDir(page)
				if (!dir || typeof id !== "string" || !id) return missing("page or id")
				// [Agent] Reread, merge and write in one synchronous step so overlapping saves cannot clobber each
				// other; the rename means nobody reads half a file. Fields older versions wrote survive the spread.
				const file = join(dir, "feedback.json")
				const all = readFeedback(dir)
				if (drop) delete all[id]
				else all[id] = { ...all[id], ...entry, updatedAt: new Date().toISOString() }
				writeFileSync(`${file}.tmp`, `${JSON.stringify(all, null, 2)}\n`)
				renameSync(`${file}.tmp`, file)
				return Response.json(all[id] ?? null)
			},
		},
	},
	// [Agent] /f/<page>?src= serves a file, /t/<page>?src= its thumbnail. src is relative to the page folder
	// and may leave it, but never the roots.
	fetch: async (request) => {
		const url = new URL(request.url)
		const kind = url.pathname.slice(0, 3)
		if (kind !== "/f/" && kind !== "/t/") return missing("route")
		const dir = getDir(decodeURIComponent(url.pathname.split("/")[2] ?? ""))
		const file = dir && resolve(dir, url.searchParams.get("src") ?? "")
		if (!dir || !file || !inRoots(file) || !existsSync(file)) return missing("file")
		if (kind === "/f/") return sendFile(request, file)
		const out = await getThumb(dir, file, url.searchParams.get("s") === "view").catch(() => "")
		if (!out) return missing("thumbnail")
		const headers = { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" }
		return new Response(Bun.file(out), { headers })
	},
	error: (error) => Response.json({ error: error.message }, { status: 400 }),
})
console.log(`http://127.0.0.1:${PORT}`)
