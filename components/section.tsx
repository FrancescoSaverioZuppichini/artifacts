import { type ReactNode, useContext, useLayoutEffect, useRef, useState } from "react";
import { noteCount, PageCtx, registry, SectionCtx, useVersion } from "../shell/state";
import type { SectionProps } from "../types";
import { Badges, tone } from "./badge";
import { components } from "./index";
import { Note } from "./note";

// [Agent] A foldable chapter: native <details>, so a folded section costs nothing to lay out. The TOC is read from these elements, so
// sections written by hand in the MDX are listed too.
export function Section({ id, title, date, badges, open, blocks, children }: SectionProps & { children?: ReactNode }) {
	const { sideBySide } = useContext(PageCtx), ref = useRef<HTMLDetailsElement>(null), [videos, setVideos] = useState(0);
	registry.set(id, { id, src: "", kind: "section", title });
	useLayoutEffect(() => { const n = ref.current!.querySelectorAll("[data-video]").length; if (n !== videos) setVideos(n); });
	const playAll = (e: React.MouseEvent) => {
		e.preventDefault();
		sideBySide({ ids: [...ref.current!.querySelectorAll<HTMLElement>("[data-card][data-video]")].map((c) => c.dataset.card!), title });
	};
	return <SectionCtx.Provider value={{ id, title }}>
		<details ref={ref} id={id} className="section scroll-mt-6 border-b py-3" data-date={date ?? ""} data-title={title}
			data-badges={JSON.stringify(badges?.filter(tone) ?? [])} data-open={open ? "" : undefined}>
			<summary className="not-prose flex gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
				<span className="chev mt-1 h-4 w-4 shrink-0 self-start text-center text-xs leading-4 text-muted-foreground">▶</span>
				<div className="min-w-0 flex-1">
					{date && <div className="text-xs text-muted-foreground">{date}</div>}
					<div className="flex flex-wrap items-center gap-1.5"><h2 className="m-0 text-lg font-semibold tracking-tight text-balance">{title}</h2><Badges list={badges} status /></div>
					<div className="mt-1 flex flex-wrap items-center gap-1">
						<Badges list={badges} status={false} />
						{videos > 1 && <button className="btn h-6 min-h-0 text-xs" onClick={playAll}>▶ Side by side · {videos} videos</button>}
						<NoteCount id={id} />
					</div>
				</div>
			</summary>
			<div className="pt-2 pl-5">
				{blocks?.map(({ type, ...props }, i) => {
					const Block = components[type as keyof typeof components] as React.ComponentType<any> | undefined;
					return Block ? <Block key={i} {...props} /> : <p key={i} className="text-red-300">Unknown block type “{type}”: register it in components/index.ts</p>;
				})}
				{children}
				<div data-comments={id} />
				<div className="mt-5"><Note id={id} placeholder="Note on this section…" /></div>
			</div>
		</details>
	</SectionCtx.Provider>;
}

// [Agent] Its own subscriber, so a keystroke in a note re-renders this chip and not every card of the section.
function NoteCount({ id }: { id: string }) {
	useVersion();
	const n = noteCount(id, [id, ...[...registry.values()].filter((x) => x.section === id).map((x) => x.id)]);
	return n ? <span className="chip">💬 {n}</span> : null;
}
