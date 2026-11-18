import { afterAll, beforeAll, expect, test } from "bun:test"
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { networkInterfaces, tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"

// [Agent] Fixtures live in a temp HOME outside the repo, so the server's recents file and `~/` both point there
// and a test run never touches the real ones.
const home = mkdtempSync(join(tmpdir(), "artifacts-test-"))
const page = join(home, "runs", "space ünï page")
const fb = join(home, "fb")
const broken = join(home, "broken")
const seeded = join(home, "seeded")
const link = join(home, "link")
const port = (() => {
	const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
	const free = probe.port
	probe.stop(true)
	return free
})()
const base = `http://127.0.0.1:${port}`
const q = (path: string) => `path=${encodeURIComponent(path)}`
const mdx = (body: string) => `---\ntitle: Test\n---\n\n<Section id="s1" title="One">\n${body}\n</Section>\n`
let server: Bun.Subprocess

beforeAll(async () => {
	for (const dir of [join(page, "in"), fb, broken, seeded]) mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(page, "page.mdx"),
		mdx(`<Gallery>
  <Media id="photo" src="in/photo.png" />
  <Media id="still" src="in/still.jpg" />
  <Media id="clip" src="in/clip.mp4" />
  <Media id="later" src="out/missing.png" />
</Gallery>`),
	)
	await $`ffmpeg -v error -f lavfi -i color=red:s=64x48 -frames:v 1 ${join(page, "in/photo.png")}`
	// [Agent] An Apple-encoded JPEG: with a seek in front, ffmpeg wrote an empty thumbnail for it and exited 0.
	copyFileSync(join(import.meta.dir, "fixtures/still.jpg"), join(page, "in/still.jpg"))
	await $`ffmpeg -v error -f lavfi -i testsrc=duration=1:size=64x48:rate=10 -c:v libx264 -pix_fmt yuv420p ${join(page, "in/clip.mp4")}`
	writeFileSync(join(fb, "page.mdx"), mdx(`<Note id="n1" />`))
	writeFileSync(join(broken, "page.mdx"), mdx("{nope"))
	writeFileSync(join(seeded, "page.mdx"), mdx("seeded"))
	symlinkSync(page, link)
	// [Agent] What the one-off migration wrote on the real machine: folder name → page file.
	writeFileSync(join(home, ".artifacts-recent.json"), JSON.stringify({ seeded: join(seeded, "page.mdx") }))
	server = Bun.spawn(["bun", "server.ts"], {
		cwd: import.meta.dir,
		env: { ...process.env, HOME: home, PORT: String(port) },
		stdout: "ignore",
	})
	for (let i = 0; i < 100; i++) {
		if (
			await fetch(base).then(
				(r) => r.ok,
				() => false,
			)
		)
			return
		await Bun.sleep(100)
	}
	throw Error("server did not start")
})

afterAll(() => {
	server?.kill()
	rmSync(home, { recursive: true, force: true })
})

const getPage = (path: string) => fetch(`${base}/api/page?${q(path)}`)
const check = async (path: string) => (await fetch(`${base}/api/check?${q(path)}`)).json()

test("?path= takes the page file, its folder or ~/…, through spaces and unicode", async () => {
	expect((await fetch(`${base}/?${q(join(page, "page.mdx"))}`)).status).toBe(200)
	for (const path of [join(page, "page.mdx"), page, "~/runs/space ünï page", `${page}/ `]) {
		const res = await getPage(path)
		expect(res.status).toBe(200)
		expect((await res.json()).title).toBe("Test")
	}
})

test("a symlinked folder serves the page and its media", async () => {
	expect((await getPage(link)).status).toBe(200)
	expect((await fetch(`${base}/f?${q(link)}&src=in/photo.png`)).status).toBe(200)
})

test("/api/check: ok, missing media, and an MDX error", async () => {
	const good = await check(page)
	expect(good.ok).toBe(true)
	expect(good.media).toBe(4)
	expect(good.missing).toEqual(["out/missing.png"])
	expect(good.url).toBe(`${base}/?path=${encodeURIComponent(join(page, "page.mdx")).replaceAll("%2F", "/")}`)
	expect(good.links.s1).toBe(`${good.url}#s1`)
	const bad = await check(broken)
	expect(bad.ok).toBe(false)
	expect(bad.errors[0]).toContain("page.mdx")
})

test("a missing path, no path or a non-mdx file is a 404 with a message", async () => {
	for (const url of [
		`/api/page?${q(join(home, "nope"))}`,
		"/api/page",
		`/api/check?${q(join(page, "in/photo.png"))}`,
		`/f?${q(page)}&src=in/nope.png`,
		"/t",
	]) {
		const res = await fetch(base + url)
		expect(res.status).toBe(404)
		expect((await res.json()).error).toStartWith("Not found")
	}
})

test("media by relative src, and non-empty thumbnails for an image and a video", async () => {
	const file = await fetch(`${base}/f?${q(page)}&src=in/photo.png`)
	expect(file.status).toBe(200)
	expect(file.headers.get("content-type")).toStartWith("image/png")
	for (const src of ["in/photo.png", "in/still.jpg", "in/clip.mp4"]) {
		const thumb = await fetch(`${base}/t?${q(page)}&src=${src}`)
		expect(thumb.status).toBe(200)
		expect(thumb.headers.get("content-type")).toBe("image/jpeg")
		expect((await thumb.arrayBuffer()).byteLength).toBeGreaterThan(100)
	}
})

test("video Range requests return 206 with the asked bytes", async () => {
	const size = statSync(join(page, "in/clip.mp4")).size
	const url = `${base}/f?${q(page)}&src=in/clip.mp4`
	const head = await fetch(url, { headers: { range: "bytes=0-99" } })
	expect(head.status).toBe(206)
	expect(head.headers.get("content-range")).toBe(`bytes 0-99/${size}`)
	expect((await head.arrayBuffer()).byteLength).toBe(100)
	const tail = await fetch(url, { headers: { range: "bytes=-50" } })
	expect(tail.headers.get("content-range")).toBe(`bytes ${size - 50}-${size - 1}/${size}`)
	expect((await fetch(url, { headers: { range: `bytes=${size}-` } })).status).toBe(416)
})

test("a feedback POST writes feedback.json in the page folder and nothing else", async () => {
	const before = readdirSync(fb).map((f) => [f, statSync(join(fb, f)).mtimeMs])
	const body = JSON.stringify({ path: fb, id: "n1", kind: "note", note: "hi" })
	expect((await fetch(`${base}/api/feedback`, { method: "POST", body })).status).toBe(200)
	expect(JSON.parse(readFileSync(join(fb, "feedback.json"), "utf8")).n1.note).toBe("hi")
	const after = readdirSync(fb).filter((f) => f !== "feedback.json")
	expect(after.map((f) => [f, statSync(join(fb, f)).mtimeMs])).toEqual(before)
})

test("old /<name> links redirect, from the seeded file and after a ?path= open", async () => {
	const go = (name: string) => fetch(`${base}/${encodeURIComponent(name)}?section=s1`, { redirect: "manual" })
	const old = await go("seeded")
	expect(old.status).toBe(302)
	expect(old.headers.get("location")).toBe(`${base}/?path=${join(seeded, "page.mdx")}&section=s1`)
	await getPage(page)
	const opened = await go("space ünï page")
	expect(opened.status).toBe(302)
	expect(decodeURIComponent(opened.headers.get("location")!)).toBe(
		`${base}/?path=${join(page, "page.mdx")}&section=s1`,
	)
	expect((await go("never-opened")).status).toBe(404)
	const list = await (await fetch(`${base}/api/pages`)).json()
	expect(list.map((p: { path: string }) => p.path).sort()).toContain(join(seeded, "page.mdx"))
})

// [Agent] ?path= reads any folder on disk, so the server must only answer on loopback.
const lan = Object.values(networkInterfaces())
	.flat()
	.find((i) => i?.family === "IPv4" && !i.internal)?.address
test.skipIf(!lan)(`does not listen on the LAN address (${lan ?? "none found"})`, async () => {
	const reached = await fetch(`http://${lan}:${port}/`, { signal: AbortSignal.timeout(2000) }).then(
		() => true,
		() => false,
	)
	expect(reached).toBe(false)
})
