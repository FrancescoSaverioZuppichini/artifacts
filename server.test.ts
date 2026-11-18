import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// [Agent] A temp HOME holds the page and the server's recents file, so a run never touches the real ones.
const home = mkdtempSync(join(tmpdir(), "artifacts-test-"))
const dir = join(home, "my run")
const port = 8800 + Math.floor(Math.random() * 1000) + 100
const base = `http://127.0.0.1:${port}`
let server: Bun.Subprocess

describe("server", () => {
	beforeAll(async () => {
		mkdirSync(dir)
		// [Agent] An Apple-encoded JPEG: with a seek in front of it ffmpeg wrote an empty thumbnail and exited 0.
		copyFileSync(join(import.meta.dir, "fixtures/still.jpg"), join(dir, "still.jpg"))
		writeFileSync(
			join(dir, "page.mdx"),
			`<Section id="s1" title="One">\n<Media id="a" src="still.jpg" />\n<Media id="b" src="later.png" />\n</Section>\n`,
		)
		server = Bun.spawn(["bun", "server.ts"], {
			cwd: import.meta.dir,
			env: { ...process.env, HOME: home, PORT: String(port) },
		})
		for (let i = 0; i < 50 && !(await fetch(base).catch(() => null)); i++) await Bun.sleep(100)
	})

	afterAll(() => {
		server.kill()
		rmSync(home, { recursive: true })
	})

	test("?path= takes the page file, its folder or ~/", async () => {
		for (const path of [join(dir, "page.mdx"), dir, "~/my run"]) {
			const res = await fetch(`${base}/api/page?path=${encodeURIComponent(path)}`)
			expect(res.status).toBe(200)
		}
		expect((await fetch(`${base}/api/page?path=/nope`)).status).toBe(404)
	})

	test("/api/check lists missing media", async () => {
		const check = await (await fetch(`${base}/api/check?path=${encodeURIComponent(dir)}`)).json()
		expect(check.ok).toBe(true)
		expect(check.missing).toEqual(["later.png"])
	})

	test("a JPEG gets a non-empty thumbnail and Range works", async () => {
		const src = `path=${encodeURIComponent(dir)}&src=still.jpg`
		expect((await (await fetch(`${base}/t?${src}`)).arrayBuffer()).byteLength).toBeGreaterThan(100)
		const part = await fetch(`${base}/f?${src}`, { headers: { range: "bytes=0-9" } })
		expect(part.status).toBe(206)
		expect((await part.arrayBuffer()).byteLength).toBe(10)
	})

	test("a foreign Host gets 403", async () => {
		const url = `${base}/api/check?path=${encodeURIComponent(dir)}`
		expect((await fetch(url, { headers: { host: "evil.example" } })).status).toBe(403)
		expect((await fetch(url, { headers: { host: `localhost:${port}` } })).status).toBe(200)
	})

	test("an old /<name> link redirects to its ?path=", async () => {
		const res = await fetch(`${base}/my%20run?section=s1`, { redirect: "manual" })
		expect(res.status).toBe(302)
		expect(res.headers.get("location")).toBe(
			`${base}/?path=${join(dir, "page.mdx").replaceAll(" ", "%20")}&section=s1`,
		)
	})
})
