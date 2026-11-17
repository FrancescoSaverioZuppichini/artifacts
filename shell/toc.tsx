import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "../components/badge";
import { noteCount, useVersion } from "./state";

type Entry = { id: string; date: string; title: string; badges: string[]; notes: number };
const sections = () => [...document.querySelectorAll<HTMLDetailsElement>("details.section")];

// [Agent] A link target can be a section or a card: open every <details> around it, scroll, and ring a card.
export function jump(id: string) {
	const el = document.getElementById(id);
	if (!el) return;
	for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
	if (el.dataset.card) el.classList.add("picked");
	history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(id)}`);
	el.scrollIntoView({ block: el.dataset.card ? "center" : "start" });
}

export function Toc({ data, onPick }: { data: unknown; onPick: () => void }) {
	const v = useVersion(), [entries, setEntries] = useState<Entry[]>([]), [active, setActive] = useState(""), list = useRef<HTMLDivElement>(null);
	// [Agent] Read from the rendered sections, not from page.json, so sections written by hand in the MDX are listed too.
	useLayoutEffect(() => {
		const next = sections().map((el) => ({
			id: el.id, date: el.dataset.date!, title: el.dataset.title!, badges: JSON.parse(el.dataset.badges!),
			notes: noteCount(el.id, [el.id, ...[...el.querySelectorAll<HTMLElement>("[data-card]")].map((c) => c.dataset.card!)]),
		}));
		if (JSON.stringify(next) !== JSON.stringify(entries)) setEntries(next);
	}, [data, v]);
	// [Agent] Scroll-spy: the active entry is the last section whose top has passed the edge, or the last one at the bottom of the page.
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
	const all = (open: boolean) => sections().forEach((d) => { d.open = open; });
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
					{e.date && <span className="block text-[11px] opacity-70">{e.date}</span>}
					<span className="line-clamp-2">{e.title}</span>
					{(e.badges.length > 0 || e.notes > 0) && <span className="mt-0.5 flex flex-wrap gap-1">{e.badges.map((b) => <Badge key={b}>{b}</Badge>)}{e.notes > 0 && <span className="chip">💬 {e.notes}</span>}</span>}
				</a>
			</li>)}</ul>
		</div>
	</nav>;
}
