import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feedback } from "../types";
import { comments, edit, flush, remove, useVersion } from "./state";

type Quote = { quote: string; prefix: string; suffix: string };
type Draft = Quote & { section: string; sectionTitle?: string; range: Range; x: number; y: number };
const CONTEXT = 30, SKIP = "textarea, input, button, [data-cmt]";

// [Agent] The text a comment can anchor to: every text node of a section except form controls and the comment UI itself, so a
// detached card or a note being typed never shifts the offsets.
function texts(scope: Element) {
	const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
	const nodes: Text[] = [];
	while (walk.nextNode()) nodes.push(walk.currentNode as Text);
	return { nodes, full: nodes.map((n) => n.data).join("") };
}

// [Agent] A selection boundary can sit on an element (triple click) or inside a skipped node, so count the kept text that lies before it.
function offset(nodes: Text[], container: Node, at: number) {
	const point = document.createRange();
	point.setStart(container, at);
	let total = 0;
	for (const n of nodes) {
		if (n === container) return total + at;
		if (point.comparePoint(n, 0) >= 0) return total;
		total += n.length;
	}
	return total;
}

function quoteOf(scope: Element, range: Range): Quote | null {
	const { nodes, full } = texts(scope);
	let s = offset(nodes, range.startContainer, range.startOffset), e = offset(nodes, range.endContainer, range.endOffset);
	while (s < e && /\s/.test(full[s])) s++;
	while (e > s && /\s/.test(full[e - 1])) e--;
	return s < e ? { quote: full.slice(s, e), prefix: full.slice(Math.max(0, s - CONTEXT), s), suffix: full.slice(e, e + CONTEXT) } : null;
}

// [Agent] Text-quote anchoring: the quote must still be there word for word; when it appears more than once, the occurrence whose
// surroundings match the saved prefix and suffix best wins. So a re-render or an edit around the quote keeps the comment in place.
function anchor(scope: Element, r: Feedback) {
	const { nodes, full } = texts(scope), q = r.quote!, pre = r.prefix ?? "", suf = r.suffix ?? "";
	let best = -1, top = -1;
	for (let i = full.indexOf(q); i >= 0; i = full.indexOf(q, i + 1)) {
		let a = 0, b = 0;
		while (a < pre.length && full[i - 1 - a] === pre[pre.length - 1 - a]) a++;
		while (b < suf.length && full[i + q.length + b] === suf[b]) b++;
		if (a + b > top) { top = a + b; best = i; }
	}
	if (best < 0) return;
	const range = document.createRange(), set = (at: number, end: boolean) => {
		let total = 0;
		for (const n of nodes) {
			// [Agent] A start on a node boundary belongs to the next node, or the range would also cover whatever skipped text sits between.
			if (end ? at <= total + n.length : at < total + n.length) return end ? range.setEnd(n, at - total) : range.setStart(n, at - total);
			total += n.length;
		}
	};
	set(best, false);
	set(best + q.length, true);
	return range;
}

const below = (range: Range) => {
	const rect = [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect();
	return { x: Math.min(rect.left + scrollX, scrollX + innerWidth - 340), y: rect.bottom + scrollY + 6 };
};

// [Agent] One box for a new comment (no id yet: Save creates it) and for a saved one (id: edit in place, resolve, delete).
function Card({ id, r, detached, save, close }: { id?: string; r: Feedback; detached?: boolean; save: (note: string) => void; close?: () => void }) {
	const [editing, setEditing] = useState(!r.note), [text, setText] = useState(r.note ?? "");
	const done = () => { if (text.trim()) { save(text.trim()); setEditing(false); } };
	return <div data-cmt className={`not-prose w-80 max-w-full rounded-md border bg-popover p-2.5 text-sm shadow-xl${detached ? " mt-3" : ""}`}>
		<div className="mb-1.5 line-clamp-2 border-l-2 border-yellow-400/70 pl-2 text-xs text-muted-foreground">
			{detached && <span className="badge badge-ask mr-1" title="This text is no longer on the page">detached</span>}{r.quote}
		</div>
		{editing
			? <textarea className="note" rows={3} autoFocus placeholder="Comment…" value={text} onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done(); }} />
			: <p className="whitespace-pre-wrap">{r.note}</p>}
		<div className="mt-2 flex flex-wrap items-center gap-1">
			{editing ? <button className="btn" onClick={done}>Save</button> : <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
			{id && <button className="btn" onClick={() => { edit(id, { resolved: true }); flush(); }}>✓ Resolve</button>}
			{id && <button className="btn" onClick={() => remove(id)}>Delete</button>}
			{close && <button className="btn ml-auto" onClick={close}>{id ? "Close" : "Cancel"}</button>}
		</div>
		{r.updatedAt && <div className="mt-1.5 text-[11px] text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}</div>}
	</div>;
}

const Saved = ({ id, r, detached, close }: { id: string; r: Feedback; detached?: boolean; close?: () => void }) =>
	<Card key={r.note} id={id} r={r} detached={detached} close={close} save={(note) => { edit(id, { note }); flush(); }} />;

// [Agent] Comments on selected text. Highlights use the CSS Custom Highlight API, so the React-rendered page is never split into marks
// and a re-render cannot break them; every DOM change re-anchors all comments, and one whose quote is gone shows as detached in its section.
export function Comments() {
	const v = useVersion(), ranges = useRef(new Map<string, Range>()), [anchored, setAnchored] = useState<string>();
	const [pending, setPending] = useState<Draft | null>(null), [draft, setDraft] = useState<Draft | null>(null);
	const [hover, setHover] = useState<string | null>(null), [open, setOpen] = useState<string | null>(null), leave = useRef<Timer>(undefined);
	const list = comments(), shown = draft ? null : open ?? hover;

	const focus = useRef<() => Range | undefined>(undefined!);
	focus.current = () => draft?.range ?? (shown ? ranges.current.get(shown) : undefined);
	const paint = () => { const r = focus.current(); CSS.highlights.set("comment-active", r ? new Highlight(r) : new Highlight()); };
	const pass = useRef(() => {});
	pass.current = () => {
		const next = new Map<string, Range>();
		for (const [id, r] of comments()) {
			const scope = r.section && document.getElementById(r.section), range = scope && r.quote ? anchor(scope, r) : undefined;
			if (range) next.set(id, range);
		}
		ranges.current = next;
		CSS.highlights.set("comment", new Highlight(...next.values()));
		paint();
		setAnchored([...next.keys()].join());
	};
	useLayoutEffect(() => pass.current(), [v]);
	useEffect(paint, [draft, shown]);
	useEffect(() => {
		let frame = 0;
		const watch = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => pass.current()); });
		watch.observe(document.querySelector("article")!, { childList: true, subtree: true, characterData: true });
		return () => { watch.disconnect(); cancelAnimationFrame(frame); };
	}, []);

	useEffect(() => {
		const inUi = (e: Event) => !!(e.target as Element).closest?.("[data-cmt]");
		const hit = (x: number, y: number) => {
			for (const [id, range] of ranges.current) for (const b of range.getClientRects()) if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return id;
		};
		const pick = (e: Event) => {
			if (inUi(e)) return;
			setTimeout(() => {
				const sel = getSelection(), range = sel?.rangeCount ? sel.getRangeAt(0) : null;
				const start = range && (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement);
				const section = start?.closest<HTMLElement>("article details.section");
				const quote = range && !range.collapsed && section && !start!.closest(SKIP) && section.contains(range.endContainer) ? quoteOf(section, range) : null;
				setPending(quote && { ...quote, section: section!.id, sectionTitle: section!.dataset.title, range: range!.cloneRange(), ...below(range!) });
			});
		};
		let frame = 0;
		const move = (e: MouseEvent) => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const id = inUi(e) ? undefined : hit(e.clientX, e.clientY);
				if (id || inUi(e)) { clearTimeout(leave.current); if (id) setHover(id); }
				else { clearTimeout(leave.current); leave.current = setTimeout(() => setHover(null), 300); }
			});
		};
		// [Agent] Capture phase, so a click on highlighted text inside a card caption pins the comment instead of opening the viewer.
		const click = (e: MouseEvent) => {
			if (inUi(e)) return;
			const id = getSelection()?.isCollapsed ? hit(e.clientX, e.clientY) : undefined;
			if (id) { e.stopPropagation(); e.preventDefault(); }
			setOpen(id ?? null);
		};
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setDraft(null); setOpen(null); setHover(null); } };
		document.addEventListener("pointerup", pick);
		document.addEventListener("keyup", pick);
		document.addEventListener("mousemove", move);
		document.addEventListener("click", click, true);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("pointerup", pick); document.removeEventListener("keyup", pick); document.removeEventListener("mousemove", move);
			document.removeEventListener("click", click, true); document.removeEventListener("keydown", esc);
		};
	}, []);

	const start = () => { setDraft(pending); setPending(null); getSelection()?.removeAllRanges(); };
	const create = (note: string) => {
		const { range, x, y, ...rest } = draft!, id = `c-${Math.random().toString(36).slice(2, 8)}`;
		edit(id, { kind: "comment", ...rest, note, resolved: false });
		flush();
		setDraft(null);
	};
	const at = (p: { x: number; y: number }) => ({ left: p.x, top: p.y });
	const box = shown && ranges.current.get(shown);
	const shownEntry = shown ? list.find(([id]) => id === shown)?.[1] : undefined;
	const detached = anchored === undefined ? [] : list.filter(([id]) => !ranges.current.has(id));
	return <>
		{pending && <button data-cmt className="btn absolute z-30 shadow-lg" style={at(pending)} onMouseDown={(e) => e.preventDefault()} onClick={start}>💬 Comment</button>}
		{draft && <div className="absolute z-30" style={at(draft)}><Card r={{ quote: draft.quote }} save={create} close={() => setDraft(null)} /></div>}
		{box && shownEntry && <div className="absolute z-30" style={at(below(box))} onClickCapture={() => setOpen(shown)}><Saved key={shown} id={shown} r={shownEntry} close={() => { setOpen(null); setHover(null); }} /></div>}
		{detached.map(([id, r]) => {
			const slot = document.querySelector(`[data-comments="${CSS.escape(r.section ?? "")}"]`) ?? document.querySelector('[data-comments=""]');
			return slot && createPortal(<Saved id={id} r={r} detached />, slot, id);
		})}
	</>;
}
