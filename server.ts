#!/usr/bin/env bun
import { compile } from "@mdx-js/mdx";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import index from "./index.html";
import type { Feedback, PageJson, Probe } from "./types";

const PORT = Number(process.env.PORT ?? 8800);
const ROOTS = (process.env.ARTIFACTS_ROOTS ?? `${homedir()}/Documents:${homedir()}/Downloads`).split(":");
const MEDIA = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?|mp4|webm|mov|m4v|mkv)$/i, VIDEO = /\.(mp4|webm|mov|m4v|mkv)$/i;

const mtime = (file: string) => { try { return statSync(file).mtimeMs; } catch { return 0; } };
// [Agent] mtime alone misses two writes inside the same millisecond; size catches most of those.
const stampOf = (file: string) => { try { const s = statSync(file); return `${s.mtimeMs}-${s.size}`; } catch { return ""; } };
const inRoots = (file: string) => ROOTS.some((r) => file.startsWith(r + sep));

// [Agent] A page is any folder up to 3 levels under a root that holds page.mdx; the URL is the folder name. Rescanned at most every 10 s
// (and at once on an unknown name) so a new page shows up without a restart.
let pages = new Map<string, string>(), scannedAt = 0;
function discover(force = false) {
	if (!force && Date.now() - scannedAt < 10_000) return pages;
	const found = new Map<string, string>();
	const walk = (dir: string, depth: number) => {
		let entries;
		try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
		if (depth && entries.some((e) => e.name === "page.mdx") && !found.has(basename(dir))) found.set(basename(dir), dir);
		if (depth < 3) for (const e of entries) if (e.isDirectory() && e.name[0] !== "." && e.name !== "node_modules") walk(join(dir, e.name), depth + 1);
	};
	for (const root of ROOTS) walk(root, 0);
	scannedAt = Date.now();
	return (pages = found);
}
const pageDir = (name: string) => discover().get(name) ?? discover(true).get(name);

// [Agent] At most n ffmpeg/ffprobe processes at once; 300 cards opened together would otherwise fork 300 encoders.
function limiter(n: number) {
	let active = 0;
	const queue: (() => void)[] = [];
	return async <T>(job: () => Promise<T>): Promise<T> => {
		while (active >= n) await new Promise<void>((r) => queue.push(r));
		active++;
		try { return await job(); } finally { active--; queue.shift()?.(); }
	};
}
const probeSlot = limiter(8), thumbSlot = limiter(4);

async function run(cmd: string[]) {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	if (code) throw Error(err.trim().split("\n").pop() || `${cmd[0]} exit ${code}`);
	return out;
}

// [Agent] Size, duration and codec per file, kept until the file's size or mtime changes. Cards get their aspect ratio from this before any
// pixel loads (no layout shift), and a file that is not there yet (or still being written) is null, which the client shows as ⏳.
const probes = new Map<string, { key: string; probe: Probe }>();
async function probe(file: string): Promise<Probe | null> {
	let st;
	try { st = statSync(file); } catch { return null; }
	if (!st.isFile()) return null;
	const key = `${st.size}-${Math.floor(st.mtimeMs)}`, hit = probes.get(file);
	if (hit?.key === key) return hit.probe;
	let result: Probe = { v: Bun.hash(key).toString(36), video: VIDEO.test(file), w: 0, h: 0 };
	if (MEDIA.test(file)) {
		try {
			const out = JSON.parse(await probeSlot(() => run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file])));
			const s = out.streams?.[0] ?? {};
			result = { ...result, w: s.width ?? 0, h: s.height ?? 0, codec: result.video ? s.codec_name : undefined, dur: result.video ? Number(out.format?.duration) || 0 : undefined };
		} catch { return null; }
	}
	probes.set(file, { key, probe: result });
	return result;
}

const mdxCache = new Map<string, { stamp: string; code: string; meta: Record<string, string>; raw: string; error?: string }>();
type Data = { stamp: string; data: PageJson; error?: string };
const dataCache = new Map<string, Data>();

// [Agent] Compiled once per change of page.mdx. On a compile error the last good code stays and the error travels to the page banner and /api/check.
async function loadMdx(dir: string) {
	const file = join(dir, "page.mdx"), stamp = stampOf(file), old = mdxCache.get(dir);
	if (old?.stamp === stamp) return old;
	const raw = readFileSync(file, "utf8");
	const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
	const meta: Record<string, string> = {};
	for (const [, k, v] of (fm?.[1] ?? "").matchAll(/^(\w+):\s*(.*)$/gm)) meta[k] = v.startsWith('"') ? JSON.parse(v) : v;
	// [Agent] Frontmatter is swapped for blank lines so the line numbers in compile errors match the file the agent wrote.
	const body = fm ? "\n".repeat(fm[0].split("\n").length - 1) + raw.slice(fm[0].length) : raw;
	let entry;
	try {
		const code = String(await compile(body, { outputFormat: "function-body", remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }));
		entry = { stamp, code, meta, raw };
	} catch (e) {
		const err = e as { line?: number; column?: number; reason?: string; message: string };
		entry = { stamp, code: old?.code ?? "", meta: old?.meta ?? meta, raw, error: `page.mdx ${err.line ?? "?"}:${err.column ?? "?"} ${err.reason ?? err.message}` };
	}
	mdxCache.set(dir, entry);
	return entry;
}

function loadData(dir: string) {
	const file = join(dir, "page.json"), stamp = stampOf(file), old = dataCache.get(dir);
	if (old?.stamp === stamp) return old;
	let entry: Data;
	try { entry = { stamp, data: stamp ? JSON.parse(readFileSync(file, "utf8")) : {} }; }
	catch (e) { entry = { stamp, data: old?.data ?? {}, error: `page.json: ${(e as Error).message}` }; }
	dataCache.set(dir, entry);
	return entry;
}

const readFeedback = (dir: string): Record<string, Feedback> => {
	try { return JSON.parse(readFileSync(join(dir, "feedback.json"), "utf8")); } catch { return {}; }
};

// [Agent] Everything a page points at. page.json is walked whole, so blocks of any component count, custom ones included. The MDX side is
// a regex over literal attributes of capitalised tags, which is all agents are told to write there.
function scan(raw: string, data: PageJson) {
	const ids: string[] = [], files = new Set<string>(), refs: string[] = [], badges: string[] = [];
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) return v.forEach(walk);
		if (!v || typeof v !== "object") return;
		const o = v as Record<string, unknown>;
		if (typeof o.id === "string") ids.push(o.id);
		if (typeof o.src === "string") files.add(o.src);
		if (typeof o.compare === "string") refs.push(o.compare);
		if (Array.isArray(o.badges)) badges.push(...o.badges);
		Object.values(o).forEach(walk);
	};
	walk(data);
	const attr = (name: string, tag = "[A-Z]\\w*") => [...raw.matchAll(new RegExp(`<${tag}\\b[^>]*?\\b${name}=["']([^"']+)["']`, "g"))].map((m) => m[1]);
	ids.push(...attr("id"));
	attr("src").forEach((f) => files.add(f));
	refs.push(...attr("compare"));
	for (const [, list] of raw.matchAll(/badges=\{\[([^\]]*)\]\}/g)) badges.push(list);
	const known = new Set(ids);
	for (const ref of refs) if (!known.has(ref)) files.add(ref);
	return {
		ids,
		sections: [...attr("id", "Section"), ...(data.sections ?? []).map((s) => s.id)],
		files: [...files].filter((f) => !/^https?:/.test(f)),
		waiting: badges.join().match(/❓/g)?.length ?? 0,
	};
}

async function build(name: string, dir: string) {
	const mdx = await loadMdx(dir), data = loadData(dir);
	const found = scan(mdx.raw, data.data);
	const media: Record<string, Probe | null> = {};
	await Promise.all(found.files.map(async (src) => {
		const file = resolve(dir, src);
		media[src] = inRoots(file) ? await probe(file) : null;
	}));
	const seen = new Set<string>(), dupes = found.ids.filter((id) => seen.size === seen.add(id).size);
	const errors = [mdx.error, data.error, ...[...new Set(dupes)].map((id) => `duplicate id: ${id}`)].filter((e): e is string => !!e);
	return { name, mdx, data: data.data, media, errors, found };
}

// [Agent] Every JSON answer carries a hash of its body; a tab that already has that version gets an empty 304, so the 5 s poll costs nothing.
function tagged(request: Request, body: string) {
	const etag = `"${Bun.hash(body).toString(36)}"`;
	if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
	return new Response(body, { headers: { etag, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
}

// [Agent] Bun does not honour Range on a file response, and browsers need it to seek video, so slice the file ourselves. A bad range gets 416.
function serve(request: Request, file: string) {
	const f = Bun.file(file), etag = `"${f.size}-${Math.floor(f.lastModified)}"`;
	const headers: Record<string, string> = { "Cache-Control": "no-cache", ETag: etag, "Accept-Ranges": "bytes", "Content-Type": f.type };
	if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
	const range = request.headers.get("range");
	if (!range) return new Response(f, { headers });
	const [, from, to] = /^bytes=(\d*)-(\d*)$/.exec(range) ?? [];
	const start = from ? Number(from) : Math.max(0, f.size - Number(to)), end = from && to ? Math.min(Number(to), f.size - 1) : f.size - 1;
	if ((!from && !to) || start > end || start >= f.size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${f.size}` } });
	return new Response(f.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${f.size}` } });
}

const missing = (what: string) => Response.json({ error: `Not found: ${what}` }, { status: 404 });

// [Agent] /f/<page>?src= and /t/<page>?src=: src is relative to the page folder and may leave it, but never the roots.
function fileOf(request: Request) {
	const url = new URL(request.url), dir = pageDir(decodeURIComponent(url.pathname.split("/")[2] ?? ""));
	if (!dir) return;
	const file = resolve(dir, url.searchParams.get("src") ?? "");
	return inRoots(file) && existsSync(file) ? { dir, file } : undefined;
}

// [Agent] Grid thumbnails are scaled by height (cards have a fixed height, so a wide strip stays sharp); viewer previews by the long side.
// The cache key holds size+mtime, so a re-render gets a fresh thumbnail and the URL (with ?v=) can be cached forever by the browser.
const pending = new Map<string, Promise<string>>();
async function thumb(dir: string, file: string, view: boolean) {
	const p = await probe(file);
	if (!p) throw Error("not ready");
	const cache = join(dir, ".review-cache"), out = join(cache, `${Bun.hash(`${file}|${p.v}|${view}`).toString(36)}.jpg`);
	if (existsSync(out)) return out;
	if (!pending.has(out)) pending.set(out, thumbSlot(async () => {
		mkdirSync(cache, { recursive: true });
		const scale = view ? "scale='if(gt(iw,ih),min(1600,iw),-2)':'if(gt(iw,ih),-2,min(1600,ih))'" : "scale=-2:'min(480,ih)'";
		const seek = p.video ? ["-ss", String(Math.min(1, (p.dur ?? 0) / 3))] : [];
		await run(["ffmpeg", "-v", "error", "-y", ...seek, "-i", file, "-frames:v", "1", "-vf", scale, "-q:v", "4", "-f", "mjpeg", `${out}.tmp`]);
		renameSync(`${out}.tmp`, out);
		return out;
	}).finally(() => pending.delete(out)));
	return pending.get(out)!;
}

function check(page: Awaited<ReturnType<typeof build>>) {
	const base = `http://127.0.0.1:${PORT}/${encodeURIComponent(page.name)}`;
	return {
		ok: !page.errors.length,
		sections: page.found.sections.length,
		media: page.found.files.filter((f) => MEDIA.test(f)).length,
		missing: Object.entries(page.media).filter(([, p]) => !p).map(([src]) => src),
		errors: page.errors,
		warnings: Object.entries(page.media).filter(([, p]) => p?.codec && !/^(h264|vp9|av1)$/.test(p.codec)).map(([src, p]) => `${src}: ${p!.codec} does not play in Chrome, re-encode to H.264`),
		url: base,
		links: Object.fromEntries(page.found.sections.map((id) => [id, `${base}#${id}`])),
	};
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
			const list = await Promise.all([...discover(true)].map(async ([name, dir]) => {
				const p = await build(name, dir).catch(() => null);
				return {
					name, title: p?.mdx.meta.title ?? name, description: p?.mdx.meta.description ?? "",
					updated: Math.max(mtime(join(dir, "page.mdx")), mtime(join(dir, "page.json"))),
					waiting: p?.found.waiting ?? 0,
					notes: Object.values(readFeedback(dir)).filter((r) => r.note?.trim()).length,
				};
			}));
			return tagged(request, JSON.stringify(list.sort((a, b) => b.updated - a.updated)));
		},
		"/api/page/:page": async (request) => {
			const name = decodeURIComponent(request.params.page), dir = pageDir(name);
			if (!dir) return missing(`page ${name}`);
			const p = await build(name, dir);
			const { title = name, description = "", order = "" } = p.mdx.meta;
			return tagged(request, JSON.stringify({ name, title, description, order, code: p.mdx.code, data: p.data, media: p.media, errors: p.errors, feedback: readFeedback(dir) }));
		},
		"/api/check/:page": async (request) => {
			const name = decodeURIComponent(request.params.page), dir = pageDir(name);
			return dir ? Response.json(check(await build(name, dir))) : missing(`page ${name}`);
		},
		"/api/feedback": {
			POST: async (request) => {
				const { page, id, ...entry } = JSON.parse(await request.text());
				const dir = typeof page === "string" && pageDir(page);
				if (!dir || typeof id !== "string" || !id) return missing("page or id");
				// [Agent] Reread, merge and write in one synchronous step so overlapping saves cannot clobber each other; the rename means nobody
				// reads half a file. Fields older versions wrote survive the spread.
				const file = join(dir, "feedback.json"), all = readFeedback(dir);
				all[id] = { ...all[id], ...entry, updatedAt: new Date().toISOString() };
				writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2) + "\n");
				renameSync(`${file}.tmp`, file);
				return Response.json(all[id]);
			},
		},
	},
	fetch: async (request) => {
		const path = new URL(request.url).pathname;
		if (path.startsWith("/f/")) { const hit = fileOf(request); return hit ? serve(request, hit.file) : missing("file"); }
		if (path.startsWith("/t/")) {
			const hit = fileOf(request);
			if (!hit) return missing("file");
			const out = await thumb(hit.dir, hit.file, new URL(request.url).searchParams.get("s") === "view").catch(() => "");
			if (!out) return missing("thumbnail");
			return new Response(Bun.file(out), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
		}
		return missing("route");
	},
	error: (error) => Response.json({ error: error.message }, { status: 400 }),
});
console.log(`http://127.0.0.1:${PORT}`);
