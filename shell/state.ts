import { createContext } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import type { Feedback, MediaProps, Probe, SectionProps } from "@/types"

// [Agent] Trimmed: a link pasted from a chat often carries a trailing space (…/my-page%20), which names no
// page.
export const page = decodeURIComponent(location.pathname.replace(/^\/|\/$/g, "")).trim()
if (page && location.pathname !== `/${encodeURIComponent(page)}`) {
	history.replaceState(null, "", `/${encodeURIComponent(page)}${location.search}${location.hash}`)
}
export const picks = new Set(new URLSearchParams(location.search).get("pick")?.split(",").filter(Boolean))

// [Agent] The src rides in the query, not the path: browsers collapse "../" in a path, and srcs may climb out
// of the page folder.
export const fileUrl = (src: string) =>
	/^https?:/.test(src) ? src : `/f/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}`
export const thumbUrl = (src: string, probe: Probe, view = false) =>
	`/t/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}&v=${probe.v}${view ? "&s=view" : ""}`

export const cards = () => [...document.querySelectorAll<HTMLElement>("[data-card]")].map((el) => el.id)
export const typing = (e: Event) => ["TEXTAREA", "INPUT", "SELECT"].includes((e.target as Element).tagName)

export const SectionCtx = createContext<{ id: string; title: string } | null>(null)

// [Agent] What each card, section and note id is, filled while rendering: the viewer and the contents read
// it, and every feedback write carries it, so feedback.json says which section and file a note belongs to.
export type Entry = Partial<MediaProps & SectionProps> & {
	id: string
	kind: NonNullable<Feedback["kind"]>
	section?: string
	sectionTitle?: string
}
export const registry = new Map<string, Entry>()

export const useStore = create(() => ({
	feedback: {} as Record<string, Feedback>,
	media: {} as Record<string, Probe | null>,
	open: {} as Record<string, boolean>,
	viewing: null as string | null,
	side: null as { ids: string[]; title: string } | null,
	status: "",
}))
const { getState: get, setState: set } = useStore

// [Agent] Shallow, so a poll that rewrites feedback.json re-renders only the cards whose entry changed.
export const useReview = (id: string) => useStore(useShallow((s) => s.feedback[id]))
export const setOpen = (ids: string[], open: boolean) =>
	set((s) => ({ open: { ...s.open, ...Object.fromEntries(ids.map((id) => [id, open])) } }))

// [Agent] Notes on the section, its cards and note boxes, plus its open text comments.
export const countNotes = (feedback: Record<string, Feedback>, section: string) =>
	Object.entries(feedback).filter(([id, r]) =>
		r?.kind === "comment"
			? !r.resolved && r.section === section
			: (id === section || registry.get(id)?.section === section) && r?.note?.trim(),
	).length

// [Agent] `dirty` holds every change the server has not confirmed yet (a poll must not overwrite it); `queued`
// the ones still waiting out the 300 ms debounce.
const dirty = new Set<string>()
const queued = new Set<string>()
let timer: Timer
export let saves = 0
let writes = Promise.resolve()

// [Agent] A comment is not in the registry, so its own entry carries its section and quote. An id with no
// entry left was deleted.
function body(id: string) {
	const r = get().feedback[id]
	if (!r) return JSON.stringify({ page, id, delete: true })
	const { kind, section, sectionTitle, title, src } = registry.get(id) ?? r
	return JSON.stringify({ page, id, ...r, kind, section, sectionTitle, title, src: src || undefined })
}

// [Agent] Chained, so the server sees writes in order and an older note never lands after a newer one.
export function flush() {
	clearTimeout(timer)
	for (const id of queued) {
		const sent = get().feedback[id]
		const data = body(id)
		writes = writes
			.then(async () => {
				const res = await fetch("/api/feedback", { method: "POST", body: data, keepalive: true })
				if (!res.ok) throw Error((await res.json()).error)
				saves++
				if (get().feedback[id] === sent) dirty.delete(id)
				set({ status: dirty.size ? "Saving…" : "Saved" })
			})
			.catch((e) => set({ status: `Save failed: ${e.message}` }))
	}
	queued.clear()
}

export function edit(id: string, patch: Feedback | null) {
	const { [id]: old, ...rest } = get().feedback
	set({ feedback: patch ? { ...rest, [id]: { ...old, ...patch } } : rest, status: "Saving…" })
	dirty.add(id)
	queued.add(id)
	clearTimeout(timer)
	timer = setTimeout(flush, 300)
}

// [Agent] Notes being typed win over the server copy, so a poll never wipes a half-written note. A poll sent
// before a save landed carries the file from before it: dropping it keeps a just-saved note from flickering.
export function load(feedback: Record<string, Feedback>, savesAtSend: number) {
	if (savesAtSend !== saves) return false
	const local = get().feedback
	set({ feedback: { ...feedback, ...Object.fromEntries([...dirty].map((id) => [id, local[id]])) } })
	return true
}

// [Agent] A fetch can be cancelled when the tab closes; a beacon is queued by the browser and survives unload.
addEventListener("pagehide", () => {
	for (const id of dirty) navigator.sendBeacon("/api/feedback", body(id))
})
