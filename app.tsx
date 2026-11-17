import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { marked } from "marked";
import { Component, createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import * as runtime from "react/jsx-runtime";
import type { Item, Probe, Prompt as PromptT, Review, Step as StepT } from "./types";

type PageData = { name: string; title: string; description: string; order: string; code: string; data: { steps?: StepT[] }; media: Record<string, Probe | null>; errors: string[]; feedback: Record<string, Review> };
type Entry = { id: string; when: string; title: string; mark: string; notes: number };
type Ctx = { media: Record<string, Probe | null>; view: (id: string) => void; sbs: (s: { ids: string[]; title: string }) => void };

// [Agent] Trimmed: a link pasted from a chat often carries a trailing space (…/my-page%20), which names no page.
const page = decodeURIComponent(location.pathname.replace(/^\/|\/$/g, "")).trim();
if (page && location.pathname !== `/${encodeURIComponent(page)}`) history.replaceState(null, "", `/${encodeURIComponent(page)}${location.search}${location.hash}`);
const params = new URLSearchParams(location.search);
// [Agent] The src rides in the query, not the path: browsers collapse "../" in a path, and srcs may climb out of the page folder.
const fileUrl = (src: string) => (/^https?:/.test(src) ? src : `/f/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}`);
const thumbUrl = (src: string, p: Probe, view = false) => `/t/${encodeURIComponent(page)}?src=${encodeURIComponent(src)}&v=${p.v}${view ? "&s=view" : ""}`;
const cards = () => [...document.querySelectorAll<HTMLElement>("[data-card]")].map((e) => e.dataset.card!);
const typing = (e: Event) => ["TEXTAREA", "INPUT", "SELECT"].includes((e.target as HTMLElement).tagName);
const PageCtx = createContext<Ctx>(null!);
const StepCtx = createContext<{ id: string; title: string } | null>(null);

// [Agent] What each card/step id is, filled while rendering: the viewer walks it and every feedback write carries it, so feedback.json says
// which step and file a note belongs to without the agent cross-referencing the page.
const meta = new Map<string, Item & { id: string; kind: string; step?: string; stepTitle?: string }>();
const picks = new Set((params.get("pick") ?? "").split(",").filter(Boolean));

// ---- feedback store -------------------------------------------------------------------------------------------------------------
let reviews: Record<string, Review> = {}, version = 0, status = "", writes = Promise.resolve();
const dirty = new Set<string>(), timers = new Map<string, Timer>(), subs = new Set<() => void>();
const emit = () => { version++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const useReview = (id: string) => useSyncExternalStore(subscribe, () => reviews[id]);
const useVersion = () => useSyncExternalStore(subscribe, () => version);

function body(id: string) {
	const { kind, step, stepTitle, title, src } = meta.get(id) ?? { kind: "item" };
	return JSON.stringify({ page, id, vote: reviews[id]?.vote ?? null, note: reviews[id]?.note ?? "", kind, step, stepTitle, title, src });
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
	}).catch((e) => { status = `Save failed: ${e.message}`; emit(); });
}
function edit(id: string, patch: Review) {
	reviews = { ...reviews, [id]: { ...reviews[id], ...patch } };
	dirty.add(id);
	status = "Saving…";
	clearTimeout(timers.get(id));
	timers.set(id, setTimeout(() => save(id), 300));
	emit();
}
const flush = () => { for (const id of [...timers.keys()]) save(id); };
// [Agent] A fetch can be cancelled when the tab closes; a beacon is queued by the browser and survives unload.
addEventListener("pagehide", () => { for (const id of dirty) navigator.sendBeacon("/api/feedback", body(id)); });

// ---- small pieces ---------------------------------------------------------------------------------------------------------------
const MARK: Record<string, string> = { "✅": "mark-ok", "❌": "mark-bad", "★": "mark-star", "★★": "mark-star", "❓": "mark-ask" };
function Marks({ mark }: { mark?: string }) {
	if (!mark) return null;
	return <>{mark.match(/★★|★|✅|❌|❓|[^★✅❌❓\s][^★✅❌❓]*/g)?.map((m, i) => <span key={i} className={`mark ${MARK[m] ?? "bg-muted"}`}>{m === "❓" ? "❓ your verdict" : m.trim()}</span>)}</>;
}

function Md({ text }: { text: string }) {
	const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
	return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function Votes({ id }: { id: string }) {
	const r = useReview(id);
	const vote = (v: "up" | "down") => (e: React.MouseEvent) => { e.stopPropagation(); edit(id, { vote: r?.vote === v ? null : v }); };
	return <>
		<button className="btn vote" data-vote="up" aria-pressed={r?.vote === "up"} onClick={vote("up")}>👍</button>
		<button className="btn vote" data-vote="down" aria-pressed={r?.vote === "down"} onClick={vote("down")}>👎</button>
	</>;
}

function Note({ id, placeholder, rows = 2, onSubmit }: { id: string; placeholder: string; rows?: number; onSubmit?: () => void }) {
	const r = useReview(id);
	return <textarea className="note" rows={rows} placeholder={placeholder} value={r?.note ?? ""} onChange={(e) => edit(id, { note: e.target.value })}
		onKeyDown={(e) => { if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} />;
}

// ---- the four page components ---------------------------------------------------------------------------------------------------
function Media(props: Item) {
	const { media, view } = useContext(PageCtx), step = useContext(StepCtx);
	const id = props.id ?? props.src, p = media[props.src], r = useReview(id);
	meta.set(id, { ...props, id, kind: "item", step: step?.id, stepTitle: step?.title });
	const bad = p?.codec && !/^(h264|vp9|av1)$/.test(p.codec);
	const note = r?.note?.trim().split("\n")[0];
	return <figure id={id} data-card={id} data-video={p?.video || undefined} onClick={() => view(id)}
		className={`card not-prose m-0 flex cursor-zoom-in flex-col overflow-hidden rounded-lg border bg-muted/40 hover:border-foreground/30${picks.has(id) ? " picked" : ""}`}
		style={{ "--ar": p?.w ? p.w / p.h : undefined } as React.CSSProperties}>
		<div className="thumb relative grid place-items-center bg-black">
			{p ? <img src={thumbUrl(props.src, p)} loading="lazy" decoding="async" alt="" className="absolute inset-0 size-full object-contain" />
				: <span className="px-3 text-center text-sm text-muted-foreground">⏳ not there yet<br /><span className="text-[11px] break-all">{props.src}</span></span>}
			<div className="absolute top-1.5 left-1.5 flex gap-1">
				{p?.video && <span className="chip border-0 bg-black/70 text-foreground">▶ {p.dur ? `${p.dur.toFixed(1)} s` : ""}</span>}
				{props.compare && <span className="chip border-0 bg-black/70 text-foreground" title={`compare: ${props.compare}`}>⇆</span>}
				{bad && <span className="chip border-0 bg-red-900 text-red-100" title="Chrome cannot play this codec; re-encode to H.264">⚠ {p.codec}</span>}
			</div>
		</div>
		<figcaption className="flex flex-1 flex-col gap-1 p-2 text-[13px] leading-snug">
			<div className="flex flex-wrap items-baseline gap-1"><Marks mark={props.mark} /><b className="line-clamp-2 font-medium" title={props.title}>{props.title ?? props.src.split("/").pop()}</b></div>
			{props.verdict && <div className="line-clamp-2 text-muted-foreground" title={props.verdict}>{props.verdict}</div>}
			{(props.time || props.meta) && <div className="flex flex-wrap gap-1">
				{props.time && <span className="chip">⏱ {props.time}</span>}
				{Object.entries(props.meta ?? {}).map(([k, v]) => <span key={k} className="chip" title={k}>{v}</span>)}
			</div>}
			<div className="mt-auto flex items-center gap-1 pt-1"><Votes id={id} />{note && <span className="truncate text-muted-foreground italic" title={r?.note}>💬 {note}</span>}</div>
		</figcaption>
	</figure>;
}

function Gallery({ title, items, children }: { title?: string; items?: Item[]; children?: ReactNode }) {
	return <section className="not-prose mt-5">
		{title && <h4 className="label">{title}</h4>}
		<div className="flex flex-wrap items-stretch gap-3">{items?.map((it) => <Media key={it.id ?? it.src} {...it} />)}{children}</div>
	</section>;
}

function Prompt({ src, text, title, children }: PromptT & { children?: ReactNode }) {
	const { media } = useContext(PageCtx), box = useRef<HTMLDivElement>(null);
	const [loaded, setLoaded] = useState(""), [copied, setCopied] = useState(false), v = src ? media[src]?.v : "";
	useEffect(() => {
		if (src) fetch(fileUrl(src)).then((r) => (r.ok ? r.text() : `⏳ not there yet: ${src}`)).then(setLoaded);
	}, [src, v]);
	const copy = () => {
		navigator.clipboard.writeText(box.current?.querySelector("pre")?.textContent ?? "");
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};
	const value = src ? loaded : text;
	return <div className="not-prose mt-5" ref={box}>
		<div className="flex items-center gap-2"><h4 className="label m-0">{title ?? "Prompt"}</h4><button className="btn ml-auto" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
		{value !== undefined ? <pre className="fold">{value}</pre> : <div className="fold-wrap">{children}</div>}
	</div>;
}

function Step({ id, title, when, mark, tags, open, text, inputs, prompt, results, children }: StepT & { children?: ReactNode }) {
	const { sbs } = useContext(PageCtx), ref = useRef<HTMLDetailsElement>(null), [videos, setVideos] = useState(0);
	meta.set(id, { id, src: "", kind: "step", title });
	useLayoutEffect(() => { const n = ref.current!.querySelectorAll("[data-video]").length; if (n !== videos) setVideos(n); });
	const prompts = [prompt ?? []].flat();
	const playAll = (e: React.MouseEvent) => {
		e.preventDefault();
		sbs({ ids: [...ref.current!.querySelectorAll<HTMLElement>("[data-card][data-video]")].map((c) => c.dataset.card!), title });
	};
	return <StepCtx.Provider value={{ id, title }}>
		<details ref={ref} id={id} className="step scroll-mt-6 border-b py-3" data-when={when ?? ""} data-title={title} data-mark={mark ?? ""} data-open={open ? "" : undefined}>
			<summary className="not-prose flex gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
				<span className="chev mt-1 h-4 w-4 shrink-0 self-start text-center text-xs leading-4 text-muted-foreground">▶</span>
				<div className="min-w-0 flex-1">
					{when && <div className="text-xs text-muted-foreground">{when}</div>}
					<div className="flex flex-wrap items-center gap-1.5"><h2 className="m-0 text-lg font-semibold tracking-tight text-balance">{title}</h2><Marks mark={mark} /></div>
					<div className="mt-1 flex flex-wrap items-center gap-1">
						{tags?.map((t) => <span key={t} className="chip">{t}</span>)}
						{videos > 1 && <button className="btn h-6 min-h-0 text-xs" onClick={playAll}>▶ Side by side · {videos} videos</button>}
						<StepNotes id={id} />
					</div>
				</div>
			</summary>
			<div className="body pt-2 pl-5">
				{text && <Md text={text} />}
				{children}
				{inputs?.length ? <Gallery title="Inputs" items={inputs} /> : null}
				{prompts.map((p, i) => <Prompt key={i} {...p} />)}
				{results?.length ? <Gallery title="Results" items={results} /> : null}
				<div className="not-prose mt-5"><Note id={id} placeholder="Note on this whole step…" /></div>
			</div>
		</details>
	</StepCtx.Provider>;
}

// [Agent] Its own subscriber, so a keystroke in a note re-renders this chip and not every card of the step.
function StepNotes({ id }: { id: string }) {
	useVersion();
	const n = [id, ...[...meta.values()].filter((x) => x.step === id).map((x) => x.id)].filter((k) => reviews[k]?.note?.trim()).length;
	return n ? <span className="chip">💬 {n}</span> : null;
}

// ---- synced video clock (viewer compare + side by side) -------------------------------------------------------------------------
const FPS = 24;
// [Agent] The first video is the clock: the others are snapped to it whenever they drift, and all restart at the shortest duration so
// columns stay frame-aligned across loops. Only the clock ever gets sound, so the same track never plays twice out of sync.
function Controls({ videos, keys }: { videos: HTMLVideoElement[]; keys?: boolean }) {
	const [playing, setPlaying] = useState(false), [muted, setMuted] = useState(true), seek = useRef<HTMLInputElement>(null);
	const clock = videos[0];
	const dur = () => Math.min(...videos.map((v) => v.duration || Infinity));
	const step = (d: number) => { const t = Math.max(0, clock.currentTime + d / FPS); videos.forEach((v) => { v.pause(); v.currentTime = t; }); };
	// [Agent] Read paused once: after the clock's play() it is already false, and the followers would be paused instead of started.
	const toggle = () => { const go = clock.paused; videos.forEach((v) => (go ? v.play().catch(() => {}) : v.pause())); };
	useEffect(() => {
		if (!clock) return;
		videos.forEach((v) => { v.muted = v !== clock || muted; });
		let raf = 0;
		const show = () => { if (seek.current) seek.current.value = String((clock.currentTime / dur()) * 1000); };
		const tick = () => {
			if (clock.currentTime >= dur() - 0.03) videos.forEach((v) => { v.currentTime = 0; });
			for (const v of videos) if (v !== clock && Math.abs(v.currentTime - clock.currentTime) > 0.08) v.currentTime = clock.currentTime;
			show();
			raf = requestAnimationFrame(tick);
		};
		const on = () => { setPlaying(true); cancelAnimationFrame(raf); tick(); }, off = () => { setPlaying(false); cancelAnimationFrame(raf); };
		clock.addEventListener("play", on); clock.addEventListener("pause", off); clock.addEventListener("seeked", show);
		if (!clock.paused) on();
		return () => { cancelAnimationFrame(raf); clock.removeEventListener("play", on); clock.removeEventListener("pause", off); clock.removeEventListener("seeked", show); };
	}, [videos]);
	useEffect(() => {
		if (!keys) return;
		const key = (e: KeyboardEvent) => {
			if (typing(e)) return;
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); step(e.key === "ArrowLeft" ? -1 : 1); }
			if (e.key === " ") { e.preventDefault(); toggle(); }
		};
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	}, [videos, keys]);
	if (!clock) return null;
	return <div className="flex items-center gap-2 border-t bg-popover px-3 py-2">
		<button className="btn" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
		<input ref={seek} type="range" max={1000} defaultValue={0} className="min-w-0 flex-1" onInput={(e) => videos.forEach((v) => { v.currentTime = (Number(e.currentTarget.value) / 1000) * dur(); })} onPointerUp={(e) => e.currentTarget.blur()} />
		<select className="btn" onChange={(e) => videos.forEach((v) => { v.playbackRate = Number(e.target.value); })}>{[1, 0.5, 0.25].map((s) => <option key={s} value={s}>{s}×</option>)}</select>
		<button className="btn" title="One frame back" onClick={() => step(-1)}>◀ frame</button>
		<button className="btn" title="One frame forward" onClick={() => step(1)}>frame ▶</button>
		<button className="btn" title="Sound of the result" onClick={() => { clock.muted = !clock.muted; setMuted(clock.muted); }}>{muted ? "🔇" : "🔊"}</button>
	</div>;
}

function useModal(onClose: () => void) {
	const ref = useRef<HTMLDialogElement>(null), latest = useRef(onClose);
	latest.current = onClose;
	const close = () => { ref.current?.querySelectorAll("video").forEach((v) => v.pause()); latest.current(); };
	// [Agent] showModal focuses the first link or button, which then swallows arrow keys and shows a focus ring; focus the dialog itself.
	// Esc is taken at the synchronous `cancel` event and the parent unmounts the dialog; the async `close` event was not delivered in testing.
	useEffect(() => {
		const d = ref.current!, esc = (e: Event) => { e.preventDefault(); close(); };
		d.showModal();
		d.focus();
		d.addEventListener("cancel", esc);
		return () => d.removeEventListener("cancel", esc);
	}, []);
	return { ref, tabIndex: -1, close };
}

function Frame({ it }: { it: Item }) {
	const { media } = useContext(PageCtx), box = useRef<HTMLDivElement>(null);
	const [videos, setVideos] = useState<HTMLVideoElement[]>([]), [split, setSplit] = useState(50);
	const p = media[it.src], refSrc = it.compare ? meta.get(it.compare)?.src || it.compare : undefined, rp = refSrc ? media[refSrc] : undefined;
	useEffect(() => setVideos([...(box.current?.querySelectorAll("video") ?? [])]), [it.src, refSrc, !!p, !!rp]);
	if (!p) return <div className="grid h-full place-items-center text-muted-foreground">⏳ not there yet · {it.src}</div>;
	const el = (src: string, q: Probe, cls: string) => q.video
		? <video src={fileUrl(src)} className={cls} muted loop playsInline autoPlay preload="auto" />
		: <img src={thumbUrl(src, q, true)} className={cls} alt="" />;
	return <div className="flex h-full flex-col">
		<div className="stage grid min-h-0 flex-1 place-items-center p-2">
			<div ref={box} className="relative" style={{ aspectRatio: `${p.w} / ${p.h}`, width: `min(100cqw, 100cqh * ${p.w / p.h})` }}>
				{el(it.src, p, "absolute inset-0 size-full object-contain")}
				{rp && refSrc && <>
					<div className="overlay absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>{el(refSrc, rp, "size-full bg-black object-contain")}</div>
					<i className="overlay absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${split}%` }} />
					<input type="range" value={split} aria-label="Compare" onChange={(e) => setSplit(Number(e.target.value))} onPointerUp={(e) => e.currentTarget.blur()} className="overlay absolute inset-0 m-0 size-full cursor-ew-resize opacity-0" />
					<b className="overlay absolute top-2 left-2 rounded bg-black/70 px-1.5 text-[11px]">Reference</b>
					<b className="overlay absolute top-2 right-2 rounded bg-black/70 px-1.5 text-[11px]">Result</b>
				</>}
			</div>
		</div>
		<Controls videos={videos} />
	</div>;
}

function Viewer({ id, setId }: { id: string; setId: (id: string | null) => void }) {
	const ids = cards(), i = ids.indexOf(id), it = meta.get(id)!;
	const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("review.hide-ov") === "1"; } catch { return false; } });
	const go = (d: number) => { flush(); setId(ids[Math.max(0, Math.min(ids.length - 1, i + d))]); };
	const { close, ...modal } = useModal(() => { flush(); setId(null); });
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			const d = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[e.key];
			if (d && !typing(e)) { e.preventDefault(); go(d); }
		};
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	}, [i]);
	const hide = () => { setHidden(!hidden); try { localStorage.setItem("review.hide-ov", hidden ? "0" : "1"); } catch {} };
	return <dialog {...modal} className={`m-0 h-dvh max-h-none w-screen max-w-none bg-background p-0 text-foreground open:flex open:flex-col${hidden ? " hide-ov" : ""}`}>
		<div className="min-h-0 flex-1 bg-black"><Frame key={id} it={it} /></div>
		<footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-sm">
			<div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5">
				<span className="text-muted-foreground">{it.stepTitle} /</span><Marks mark={it.mark} /><b>{it.title}</b>
				{it.verdict && <span className="text-muted-foreground">{it.verdict}</span>}
				{it.time && <span className="chip">⏱ {it.time}</span>}
				{Object.entries(it.meta ?? {}).map(([k, v]) => <span key={k} className="chip" title={k}>{v}</span>)}
				<a href={fileUrl(it.src)} download={it.src.split("/").pop()} className="text-sky-300 underline">⬇ original</a>
			</div>
			<button className="btn" onClick={() => go(-1)} aria-label="Previous">←</button><button className="btn" onClick={() => go(1)} aria-label="Next">→</button>
			<Votes id={id} />
			<div className="min-w-60 flex-1"><Note key={id} id={id} rows={2} placeholder="Note · Ctrl/⌘+Enter saves and goes next · ←/→ move · Esc closes" onSubmit={() => go(1)} /></div>
			<span className="text-muted-foreground">{i + 1} / {ids.length}</span>
			<button className="btn" onClick={hide}>{hidden ? "Show overlays" : "Hide overlays"}</button>
			<button className="btn" onClick={close}>Close</button>
		</footer>
	</dialog>;
}

// [Agent] Every video of one step in a full-screen row on one clock, so renders of the same clip can be audited frame against frame.
// Unticking a column hides it; the sound pick decides the clock, while the on-screen order stays the step's.
function Sbs({ ids, title, close }: { ids: string[]; title: string; close: () => void }) {
	const items = ids.map((id) => meta.get(id)!).filter(Boolean);
	const [shown, setShown] = useState(() => new Set(ids)), [voice, setVoice] = useState(ids[0]), row = useRef<HTMLDivElement>(null);
	const [videos, setVideos] = useState<HTMLVideoElement[]>([]), { close: shut, ...modal } = useModal(close);
	const pick = items.filter((it) => shown.has(it.id));
	useEffect(() => {
		const vs = [...row.current!.querySelectorAll("video")], at = Math.max(0, pick.findIndex((it) => it.id === voice));
		setVideos([vs[at], ...vs.filter((_, j) => j !== at)]);
	}, [shown, voice]);
	const tick = (id: string) => {
		const next = new Set(shown);
		next.has(id) ? next.size > 1 && next.delete(id) : next.add(id);
		setShown(next);
		if (!next.has(voice)) setVoice([...next][0]);
	};
	return <dialog {...modal} className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-foreground open:flex open:flex-col">
		<header className="flex flex-wrap items-center gap-3 bg-popover px-4 py-2 text-sm">
			<b className="max-w-[40ch] truncate">{title}</b>
			<span className="flex flex-wrap gap-3 text-muted-foreground">{items.map((it) => <label key={it.id} className="cursor-pointer whitespace-nowrap" title={it.title}><input type="checkbox" checked={shown.has(it.id)} onChange={() => tick(it.id)} /> {(it.title ?? it.id).slice(0, 40)}</label>)}</span>
			<label>Sound: <select className="btn" value={voice} onChange={(e) => setVoice(e.target.value)}>{pick.map((it) => <option key={it.id} value={it.id}>{(it.title ?? it.id).slice(0, 40)}</option>)}</select></label>
			<button className="btn ml-auto" onClick={shut}>Close (Esc)</button>
		</header>
		<div ref={row} className="flex min-h-0 flex-1 gap-1">
			{pick.map((it) => <figure key={it.id} className="m-0 flex min-w-0 flex-1 flex-col">
				<figcaption className="truncate bg-popover px-1.5 py-1 text-[13px] font-semibold" title={it.title}>{it.title}</figcaption>
				<video src={fileUrl(it.src)} muted playsInline preload="auto" className="min-h-0 w-full flex-1 bg-black object-contain" />
			</figure>)}
		</div>
		<Controls videos={videos} keys />
	</dialog>;
}

// ---- page shell -------------------------------------------------------------------------------------------------------------------
function Toc({ data, onPick }: { data: PageData; onPick: () => void }) {
	const v = useVersion(), [entries, setEntries] = useState<Entry[]>([]), [active, setActive] = useState(""), list = useRef<HTMLDivElement>(null);
	// [Agent] Built from the rendered DOM, not from page.json, so steps written by hand in the MDX are listed too.
	useLayoutEffect(() => {
		const next = [...document.querySelectorAll<HTMLElement>("details.step")].map((el) => ({
			id: el.id, when: el.dataset.when!, title: el.dataset.title!, mark: el.dataset.mark!,
			notes: [el.id, ...[...el.querySelectorAll<HTMLElement>("[data-card]")].map((c) => c.dataset.card!)].filter((id) => reviews[id]?.note?.trim()).length,
		}));
		if (JSON.stringify(next) !== JSON.stringify(entries)) setEntries(next);
	}, [data, v]);
	// [Agent] Scroll-spy as in alterego's blog-toc: the active entry is the last step whose top has passed the edge, or the last one at the bottom.
	useEffect(() => {
		let frame = 0;
		const spy = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const tops = entries.map((e) => ({ id: e.id, top: document.getElementById(e.id)?.getBoundingClientRect().top ?? Infinity }));
				const bottom = document.documentElement.scrollHeight - scrollY - innerHeight < 2;
				setActive((bottom ? tops.at(-1)?.id : tops.filter((t) => t.top <= 80).at(-1)?.id) ?? tops[0]?.id ?? "");
			});
		};
		addEventListener("scroll", spy, { passive: true });
		addEventListener("resize", spy);
		spy();
		return () => { removeEventListener("scroll", spy); removeEventListener("resize", spy); };
	}, [entries]);
	useEffect(() => { list.current?.querySelector(`[data-toc="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
	const all = (open: boolean) => document.querySelectorAll<HTMLDetailsElement>("details.step").forEach((d) => { d.open = open; });
	return <nav className="flex min-h-0 flex-col text-sm">
		<div className="mb-2 flex items-center gap-1.5">
			<span className="font-medium">Contents</span>
			<button className="btn ml-auto h-6 min-h-0 text-xs" onClick={() => all(true)}>Expand all</button>
			<button className="btn h-6 min-h-0 text-xs" onClick={() => all(false)}>Collapse all</button>
		</div>
		<div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1 pr-2 [scrollbar-width:none]">
			<ul className="space-y-0.5">{entries.map((e) => <li key={e.id}>
				<a href={`#${e.id}`} data-toc={e.id} aria-current={active === e.id ? "location" : undefined} onClick={(ev) => { ev.preventDefault(); jump(e.id); onPick(); }}
					className={`block rounded-md px-2 py-1 leading-snug text-muted-foreground transition-colors hover:bg-muted hover:text-foreground${active === e.id ? " bg-muted text-foreground" : ""}`}>
					{e.when && <span className="block text-[11px] opacity-70">{e.when}</span>}
					<span className="line-clamp-2">{e.title}</span>
					{(e.mark || e.notes > 0) && <span className="mt-0.5 flex flex-wrap gap-1"><Marks mark={e.mark} />{e.notes > 0 && <span className="chip">💬 {e.notes}</span>}</span>}
				</a>
			</li>)}</ul>
		</div>
	</nav>;
}

// [Agent] A link target can be a step or a card: open every <details> around it, scroll, and ring a card.
function jump(id: string) {
	const el = document.getElementById(id);
	if (!el) return;
	for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
	if (el.dataset.card) el.classList.add("picked");
	history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(id)}`);
	el.scrollIntoView({ block: el.dataset.card ? "center" : "start" });
}

function Status({ data }: { data: PageData }) {
	const v = useVersion(), [ids, setIds] = useState<string[]>([]);
	useLayoutEffect(() => { const next = cards(); if (next.join("\n") !== ids.join("\n")) setIds(next); }, [data, v]);
	const done = ids.filter((id) => reviews[id]?.vote || reviews[id]?.note?.trim()).length;
	const [size, setSize] = useState(() => { try { return localStorage.getItem("review.card-h") ?? "200px"; } catch { return "200px"; } });
	useEffect(() => { document.documentElement.style.setProperty("--card-h", size); try { localStorage.setItem("review.card-h", size); } catch {} }, [size]);
	return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		<span>{done} / {ids.length} reviewed</span><span>{status}</span>
		<span className="ml-auto flex gap-1">{([["S", "140px"], ["M", "200px"], ["L", "300px"]] as const).map(([l, h]) => <button key={l} className="btn h-6 min-h-0 text-xs" aria-pressed={size === h} onClick={() => setSize(h)}>{l}</button>)}</span>
	</div>;
}

class Guard extends Component<{ children: ReactNode; data: unknown }, { error?: string }> {
	state: { error?: string } = {};
	static getDerivedStateFromError(e: Error) { return { error: e.message }; }
	componentDidUpdate(prev: { data: unknown }) { if (this.state.error && prev.data !== this.props.data) this.setState({ error: undefined }); }
	render() { return this.state.error ? <Banner errors={[`page.mdx failed to render: ${this.state.error}`]} /> : this.props.children; }
}
const Banner = ({ errors }: { errors: string[] }) => <div className="not-prose my-4 rounded-md border border-red-500/60 bg-red-950/60 p-3 text-sm text-red-100">
	<b>This page has a problem; the last good version is shown.</b>
	<ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e} className="font-mono text-xs whitespace-pre-wrap">{e}</li>)}</ul>
</div>;

const components = { Step, Gallery, Media, Prompt };
const seen = new Set<string>();

function Page() {
	const [data, setData] = useState<PageData>(), [viewing, setViewing] = useState<string | null>(null), [side, setSide] = useState<{ ids: string[]; title: string } | null>(null);
	const [drawer, setDrawer] = useState(false), first = useRef(true), [error, setError] = useState<string>();
	useEffect(() => {
		let etag = "";
		// [Agent] One request every 5 s; the server answers 304 unless page.mdx, page.json, a media file or feedback.json changed. Hidden tabs skip.
		const poll = async () => {
			if (document.hidden && etag) return;
			try {
				const r = await fetch(`/api/page/${encodeURIComponent(page)}`, { headers: etag ? { "If-None-Match": etag } : {} });
				if (r.status === 304) return;
				if (!r.ok) throw Error((await r.json()).error);
				etag = r.headers.get("etag") ?? "";
				const next: PageData = await r.json();
				// [Agent] Notes being typed win over the server copy, so a refresh never wipes a half-written note.
				reviews = { ...next.feedback, ...Object.fromEntries([...dirty].map((id) => [id, reviews[id]])) };
				emit();
				setData(next);
			} catch (e) { status = (e as Error).message; setError(status); emit(); }
		};
		poll();
		const t = setInterval(poll, 5000);
		document.addEventListener("visibilitychange", poll);
		return () => { clearInterval(t); document.removeEventListener("visibilitychange", poll); };
	}, []);
	const Content = useMemo(() => (data?.code ? (new Function(data.code)({ ...runtime }).default as React.ComponentType<{ components: typeof components; data: PageData["data"] }>) : null), [data?.code]);
	// [Agent] Steps are opened once, the first time they appear: those marked `open` and the newest two (by page order; frontmatter
	// `order: newest-first` flips it). After that the reader's folding is never touched, even when page.json is rewritten.
	useLayoutEffect(() => {
		if (!data) return;
		const steps = [...document.querySelectorAll<HTMLDetailsElement>("details.step")], dated = steps.filter((s) => s.dataset.when);
		const newest = new Set((data.order === "newest-first" ? dated.slice(0, 2) : dated.slice(-2)).map((s) => s.id));
		for (const s of steps) if (!seen.has(s.id)) { seen.add(s.id); if (s.dataset.open !== undefined || newest.has(s.id)) s.open = true; }
		if (!first.current) return;
		first.current = false;
		document.title = data.title;
		const target = params.get("section") ?? decodeURIComponent(location.hash.slice(1));
		const pick = [...picks].find((id) => document.getElementById(id));
		for (const id of picks) document.getElementById(id)?.closest("details")?.setAttribute("open", "");
		if (target) jump(target); else if (pick) jump(pick);
	}, [data]);
	useEffect(() => { const h = () => jump(decodeURIComponent(location.hash.slice(1))); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }, []);
	// [Agent] A wrong page name must say so, not spin: the poll's 404 lands here before any data exists.
	if (!data) return <p className="p-8 text-muted-foreground">{error ? <>Page “{page}” not found ({error}). <a className="underline" href="/">All pages</a></> : `Loading ${page}…`}</p>;
	const ctx: Ctx = { media: data.media, view: setViewing, sbs: setSide };
	return <PageCtx.Provider value={ctx}>
		<div className="p-4 pt-8 xl:p-6 xl:pt-10">
			<div className="mx-auto grid w-full max-w-[1600px] md:grid-cols-[270px_minmax(0,1100px)] md:justify-center md:gap-8">
				<aside className="hidden md:block">
					<div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-4">
						<a href="/" className="text-xs text-muted-foreground hover:text-foreground">← all pages</a>
						<Status data={data} />
						<Toc data={data} onPick={() => {}} />
					</div>
				</aside>
				<article className="min-w-0">
					<header className="mb-6">
						<h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{data.title}</h1>
						{data.description && <p className="mt-3 text-lg text-muted-foreground">{data.description}</p>}
						<div className="mt-3 md:hidden"><Status data={data} /></div>
					</header>
					{data.errors.length > 0 && <Banner errors={data.errors} />}
					<div className="prose prose-invert max-w-none prose-sm sm:prose-base prose-code:before:content-none prose-code:after:content-none">
						<Guard key={data.code} data={data.data}>{Content && <Content components={components} data={data.data} />}</Guard>
					</div>
				</article>
			</div>
		</div>
		<button className="btn fixed right-5 bottom-5 z-40 h-10 px-3 md:hidden" onClick={() => setDrawer(true)} aria-label="Open contents">☰</button>
		{drawer && <div className="fixed inset-0 z-50 md:hidden">
			<button className="absolute inset-0 bg-background/75 backdrop-blur-sm" aria-label="Close contents" onClick={() => setDrawer(false)} />
			<div className="absolute top-0 right-0 flex h-full w-80 max-w-[85vw] flex-col border-l bg-background p-5 shadow-xl"><Toc data={data} onPick={() => setDrawer(false)} /></div>
		</div>}
		{viewing && meta.has(viewing) && <Viewer id={viewing} setId={setViewing} />}
		{side && <Sbs {...side} close={() => setSide(null)} />}
	</PageCtx.Provider>;
}

function Index() {
	const [list, setList] = useState<{ name: string; title: string; description: string; updated: number; waiting: number; notes: number }[]>();
	useEffect(() => { fetch("/api/pages").then((r) => r.json()).then(setList); }, []);
	return <main className="mx-auto max-w-3xl p-6 pt-12">
		<h1 className="text-3xl font-semibold tracking-tight">Review pages</h1>
		<ul className="mt-6 divide-y">{list?.map((p) => <li key={p.name} className="py-4">
			<a href={`/${encodeURIComponent(p.name)}`} className="text-lg font-medium hover:underline">{p.title}</a>
			<p className="text-sm text-muted-foreground">{p.description}</p>
			<div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
				<span className="chip">/{p.name}</span><span className="chip">updated {new Date(p.updated).toLocaleString()}</span>
				{p.waiting > 0 && <span className="mark mark-ask">❓ {p.waiting} waiting</span>}
				{p.notes > 0 && <span className="chip">💬 {p.notes}</span>}
			</div>
		</li>)}</ul>
		{list?.length === 0 && <p className="text-muted-foreground">No page.mdx found under the roots.</p>}
	</main>;
}

// [Agent] One video plays at a time: starting one pauses every other, except its companions on the same clock (viewer compare, side by side).
document.addEventListener("play", (e) => {
	const group = (e.target as HTMLElement).closest("dialog");
	document.querySelectorAll("video").forEach((v) => { if (v !== e.target && !v.paused && !group?.contains(v)) v.pause(); });
}, true);
// [Agent] Selecting text to copy a prompt must not collapse it.
document.addEventListener("click", (e) => {
	const pre = (e.target as HTMLElement).closest<HTMLElement>(".prose pre, pre.fold, .fold-wrap pre");
	if (pre && getSelection()?.isCollapsed) pre.classList.toggle("open");
});

createRoot(document.getElementById("root")!).render(page ? <Page /> : <Index />);
