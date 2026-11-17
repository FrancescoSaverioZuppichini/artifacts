import { Component, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as runtime from "react/jsx-runtime";
import { components } from "../components";
import type { Feedback, PageJson, Probe } from "../types";
import { Comments } from "./comments";
import { SideBySide } from "./side-by-side";
import { cards, fail, load, page, PageCtx, params, picks, registry, review, type Show, status, store, stored, useVersion } from "./state";
import { jump, Toc } from "./toc";
import { Viewer } from "./viewer";

type PageData = { name: string; title: string; description: string; order: string; code: string; data: PageJson; media: Record<string, Probe | null>; errors: string[]; feedback: Record<string, Feedback> };
const opened = new Set<string>();

function Status({ data }: { data: PageData }) {
	const v = useVersion(), [ids, setIds] = useState<string[]>([]);
	useLayoutEffect(() => { const next = cards(); if (next.join("\n") !== ids.join("\n")) setIds(next); }, [data, v]);
	const done = ids.filter((id) => review(id)?.vote || review(id)?.note?.trim()).length;
	const [size, setSize] = useState(() => stored("artifacts.card-h") ?? "200px");
	useEffect(() => { document.documentElement.style.setProperty("--card-h", size); store("artifacts.card-h", size); }, [size]);
	return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		<span>{done} / {ids.length} reviewed</span><span>{status}</span>
		<span className="ml-auto flex gap-1">{([["S", "140px"], ["M", "200px"], ["L", "300px"]] as const).map(([l, h]) => <button key={l} className="btn h-6 min-h-0 text-xs" aria-pressed={size === h} onClick={() => setSize(h)}>{l}</button>)}</span>
	</div>;
}

const Banner = ({ errors }: { errors: string[] }) => <div className="not-prose my-4 rounded-md border border-red-500/60 bg-red-950/60 p-3 text-sm text-red-100">
	<b>This page has a problem; the last good version is shown.</b>
	<ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e} className="font-mono text-xs whitespace-pre-wrap">{e}</li>)}</ul>
</div>;

// [Agent] A component that throws while rendering would blank the whole page; show the error instead and retry on the next data.
class Guard extends Component<{ children: ReactNode; data: unknown }, { error?: string }> {
	state: { error?: string } = {};
	static getDerivedStateFromError(e: Error) { return { error: e.message }; }
	componentDidUpdate(prev: { data: unknown }) { if (this.state.error && prev.data !== this.props.data) this.setState({ error: undefined }); }
	render() { return this.state.error ? <Banner errors={[`page.mdx failed to render: ${this.state.error}`]} /> : this.props.children; }
}

export function Page() {
	const [data, setData] = useState<PageData>(), [viewing, setViewing] = useState<string | null>(null), [side, setSide] = useState<Show | null>(null);
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
				load(next.feedback);
				setData(next);
			} catch (e) { fail((e as Error).message); setError((e as Error).message); }
		};
		poll();
		const t = setInterval(poll, 5000);
		document.addEventListener("visibilitychange", poll);
		return () => { clearInterval(t); document.removeEventListener("visibilitychange", poll); };
	}, []);
	const Content = useMemo(() => (data?.code ? (new Function(data.code)({ ...runtime }).default as React.ComponentType<{ components: typeof components; data: PageJson }>) : null), [data?.code]);
	// [Agent] Sections are opened once, the first time they appear: those marked `open` and the newest two dated ones (by page order;
	// frontmatter `order: newest-first` flips it). After that the reader's folding is never touched, even when page.json is rewritten.
	useLayoutEffect(() => {
		if (!data) return;
		const all = [...document.querySelectorAll<HTMLDetailsElement>("details.section")], dated = all.filter((s) => s.dataset.date);
		const newest = new Set((data.order === "newest-first" ? dated.slice(0, 2) : dated.slice(-2)).map((s) => s.id));
		for (const s of all) if (!opened.has(s.id)) { opened.add(s.id); if (s.dataset.open !== undefined || newest.has(s.id)) s.open = true; }
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
	return <PageCtx.Provider value={{ media: data.media, view: setViewing, sideBySide: setSide }}>
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
					<div data-comments="" />
				</article>
			</div>
		</div>
		<button className="btn fixed right-5 bottom-5 z-40 h-10 px-3 md:hidden" onClick={() => setDrawer(true)} aria-label="Open contents">☰</button>
		{drawer && <div className="fixed inset-0 z-50 md:hidden">
			<button className="absolute inset-0 bg-background/75 backdrop-blur-sm" aria-label="Close contents" onClick={() => setDrawer(false)} />
			<div className="absolute top-0 right-0 flex h-full w-80 max-w-[85vw] flex-col border-l bg-background p-5 shadow-xl"><Toc data={data} onPick={() => setDrawer(false)} /></div>
		</div>}
		{viewing && registry.has(viewing) && <Viewer id={viewing} setId={setViewing} />}
		<Comments />
		{side && <SideBySide {...side} close={() => setSide(null)} />}
	</PageCtx.Provider>;
}
