import { createContext, useSyncExternalStore } from "react"
import type { Feedback, MediaProps, Probe } from "@/types"

// [Agent] Trimmed: a link pasted from a chat often carries a trailing space (…/my-page%20), which names no
// page.
export const page = decodeURIComponent(location.pathname.replace(/^\/|\/$/g, "")).trim()
if (page && location.pathname !== `/${encodeURIComponent(page)}`) {
	history.replaceState(null, "", `/${encodeURIComponent(page)}${location.search}${location.hash}`)
}
export const params = new URLSearchParams(location.search)
export const picks = new Set((params.get("pick") ?? "").split(",").filter(Boolean))

// [Agent] The src rides in the query, not the path: browsers collapse "../" in a path, and srcs may climb out
// of the page folder.
export function fileUrl(src: string) {
	return /^https?:/.test(src) ? src : `/f/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}`
}

export function thumbUrl(src: string, probe: Probe, view = false) {
	return `/t/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}&v=${probe.v}${view ? "&s=view" : ""}`
}

export const cards = () =>
	[...document.querySelectorAll<HTMLElement>("[data-card]")].map((el) => el.dataset.card!)
export const typing = (e: Event) =>
	["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement).tagName)

export type Show = { ids: string[]; title: string }
type PageContext = {
	media: Record<string, Probe | null>
	view: (id: string) => void
	sideBySide: (show: Show) => void
}
export const PageCtx = createContext<PageContext>(null!)
export const SectionCtx = createContext<{ id: string; title: string } | null>(null)

// [Agent] What each card, section and note id is, filled while rendering: the viewer walks it and every
// feedback write carries it, so feedback.json says which section and file a note belongs to.
export type Entry = MediaProps & {
	id: string
	kind: NonNullable<Feedback["kind"]>
	section?: string
	sectionTitle?: string
}
export const registry = new Map<string, Entry>()

let reviews: Record<string, Feedback> = {}
let version = 0
let saves = 0
let writes = Promise.resolve()
export let status = ""
const openSections = new Set<string>()
const dirty = new Set<string>()
const timers = new Map<string, Timer>()
const subs = new Set<() => void>()

function emit() {
	version++
	for (const f of subs) f()
}

function subscribe(f: () => void) {
	subs.add(f)
	return () => subs.delete(f)
}

export const review = (id: string) => reviews[id]
export const useReview = (id: string) => useSyncExternalStore(subscribe, () => reviews[id])
export const useVersion = () => useSyncExternalStore(subscribe, () => version)
export const useOpen = (id: string) => useSyncExternalStore(subscribe, () => openSections.has(id))
export const savesDone = () => saves

export function setOpen(id: string, open: boolean) {
	if (open === openSections.has(id)) return
	if (open) openSections.add(id)
	else openSections.delete(id)
	emit()
}

export const comments = () => Object.entries(reviews).filter(([, r]) => r?.kind === "comment" && !r.resolved)

export function countNotes(section: string, ids: string[]) {
	const notes = ids.filter((id) => reviews[id]?.note?.trim()).length
	return notes + comments().filter(([, r]) => r.section === section).length
}

// [Agent] A comment is not in the registry, so its own entry carries its section and quote. An id with no
// entry left was deleted.
function body(id: string) {
	const r = reviews[id]
	if (!r) return JSON.stringify({ page, id, delete: true })
	const { kind, section, sectionTitle, title, src } = registry.get(id) ?? r
	return JSON.stringify({ page, id, ...r, kind, section, sectionTitle, title, src: src || undefined })
}

function save(id: string) {
	clearTimeout(timers.get(id))
	timers.delete(id)
	const sent = reviews[id]
	const data = body(id)
	// [Agent] Chained, so the server sees writes in order and an older note never lands after a newer one.
	writes = writes
		.then(async () => {
			const res = await fetch("/api/feedback", { method: "POST", body: data, keepalive: true })
			if (!res.ok) throw Error((await res.json()).error)
			saves++
			if (reviews[id] === sent) dirty.delete(id)
			status = dirty.size ? "Saving…" : "Saved"
			emit()
		})
		.catch((e) => fail(`Save failed: ${e.message}`))
}

export function edit(id: string, patch: Feedback) {
	reviews = { ...reviews, [id]: { ...reviews[id], ...patch } }
	dirty.add(id)
	status = "Saving…"
	clearTimeout(timers.get(id))
	timers.set(
		id,
		setTimeout(() => save(id), 300),
	)
	emit()
}

export function remove(id: string) {
	const { [id]: _, ...rest } = reviews
	reviews = rest
	dirty.add(id)
	save(id)
	emit()
}

export function flush() {
	for (const id of [...timers.keys()]) save(id)
}

// [Agent] Notes being typed win over the server copy, so a refresh never wipes a half-written note. A poll
// sent before a save landed carries the file from before it: dropping it keeps a just-saved note from
// vanishing.
export function load(feedback: Record<string, Feedback>, savesAtSend: number) {
	if (savesAtSend !== saves) return false
	reviews = { ...feedback, ...Object.fromEntries([...dirty].map((id) => [id, reviews[id]])) }
	emit()
	return true
}

export function fail(message: string) {
	status = message
	emit()
}

// [Agent] A fetch can be cancelled when the tab closes; a beacon is queued by the browser and survives
// unload.
addEventListener("pagehide", () => {
	for (const id of dirty) navigator.sendBeacon("/api/feedback", body(id))
})
