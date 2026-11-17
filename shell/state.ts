import { createContext, useSyncExternalStore } from "react";
import type { Feedback, MediaProps, Probe } from "../types";

// [Agent] Trimmed: a link pasted from a chat often carries a trailing space (…/my-page%20), which names no page.
export const page = decodeURIComponent(location.pathname.replace(/^\/|\/$/g, "")).trim();
if (page && location.pathname !== `/${encodeURIComponent(page)}`) history.replaceState(null, "", `/${encodeURIComponent(page)}${location.search}${location.hash}`);
export const params = new URLSearchParams(location.search);
export const picks = new Set((params.get("pick") ?? "").split(",").filter(Boolean));

// [Agent] The src rides in the query, not the path: browsers collapse "../" in a path, and srcs may climb out of the page folder.
export const fileUrl = (src: string) => (/^https?:/.test(src) ? src : `/f/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}`);
export const thumbUrl = (src: string, p: Probe, view = false) => `/t/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}&v=${p.v}${view ? "&s=view" : ""}`;
export const cards = () => [...document.querySelectorAll<HTMLElement>("[data-card]")].map((e) => e.dataset.card!);
// [Agent] Storage throws in some private windows; a lost preference is fine, a crashed page is not.
export const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
export const typing = (e: Event) => ["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement).tagName);

export type Show = { ids: string[]; title: string };
export const PageCtx = createContext<{ media: Record<string, Probe | null>; view: (id: string) => void; sideBySide: (s: Show) => void }>(null!);
export const SectionCtx = createContext<{ id: string; title: string } | null>(null);

// [Agent] What each card, section and note id is, filled while rendering: the viewer walks it and every feedback write carries it, so
// feedback.json says which section and file a note belongs to without the agent cross-referencing the page.
export type Entry = MediaProps & { id: string; kind: NonNullable<Feedback["kind"]>; section?: string; sectionTitle?: string };
export const registry = new Map<string, Entry>();

let reviews: Record<string, Feedback> = {}, version = 0, writes = Promise.resolve();
export let status = "";
const dirty = new Set<string>(), timers = new Map<string, Timer>(), subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const review = (id: string) => reviews[id];
export const useReview = (id: string) => useSyncExternalStore(subscribe, () => reviews[id]);
export const useVersion = () => useSyncExternalStore(subscribe, () => version);
export const comments = () => Object.entries(reviews).filter(([, r]) => r?.kind === "comment" && !r.resolved);
export const noteCount = (section: string, ids: string[]) => ids.filter((id) => reviews[id]?.note?.trim()).length + comments().filter(([, r]) => r.section === section).length;

// [Agent] A comment is not in the registry, so its own entry carries its section and quote. An id with no entry left was deleted.
function body(id: string) {
	const r = reviews[id];
	if (!r) return JSON.stringify({ page, id, delete: true });
	const { kind, section, sectionTitle, title, src } = registry.get(id) ?? r;
	return JSON.stringify({ page, id, ...r, kind, section, sectionTitle, title, src: src || undefined });
}
function save(id: string) {
	clearTimeout(timers.get(id));
	timers.delete(id);
	const sent = reviews[id], data = body(id);
	// [Agent] Writes are chained so the server sees them in order and an older note never lands after a newer one.
	writes = writes.then(async () => {
		const r = await fetch("/api/feedback", { method: "POST", body: data, keepalive: true });
		if (!r.ok) throw Error((await r.json()).error);
		if (reviews[id] === sent) dirty.delete(id);
		status = dirty.size ? "Saving…" : "Saved";
		emit();
	}).catch((e) => fail(`Save failed: ${e.message}`));
}
export function edit(id: string, patch: Feedback) {
	reviews = { ...reviews, [id]: { ...reviews[id], ...patch } };
	dirty.add(id);
	status = "Saving…";
	clearTimeout(timers.get(id));
	timers.set(id, setTimeout(() => save(id), 300));
	emit();
}
export function remove(id: string) {
	const { [id]: _, ...rest } = reviews;
	reviews = rest;
	dirty.add(id);
	save(id);
	emit();
}
export const flush = () => { for (const id of [...timers.keys()]) save(id); };
// [Agent] Notes being typed win over the server copy, so a refresh never wipes a half-written note.
export function load(feedback: Record<string, Feedback>) {
	reviews = { ...feedback, ...Object.fromEntries([...dirty].map((id) => [id, reviews[id]])) };
	emit();
}
export function fail(message: string) { status = message; emit(); }
// [Agent] A fetch can be cancelled when the tab closes; a beacon is queued by the browser and survives unload.
addEventListener("pagehide", () => { for (const id of dirty) navigator.sendBeacon("/api/feedback", body(id)); });
