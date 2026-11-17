import { useContext } from "react";
import { picks, PageCtx, registry, SectionCtx, thumbUrl, useReview } from "../shell/state";
import { Votes } from "../shell/votes";
import type { MediaProps } from "../types";
import { Badges, tone } from "./badge";

// [Agent] A poster-only card: the grid never loads a video, it plays in the viewer. Fixed height, width from the probed aspect ratio, so
// nothing moves when thumbnails land; a file that is not there yet is a ⏳ card that fills in by itself.
export function Media(props: MediaProps) {
	const { media, view } = useContext(PageCtx), section = useContext(SectionCtx);
	const id = props.id ?? props.src, p = media[props.src], r = useReview(id);
	registry.set(id, { ...props, id, kind: "media", section: section?.id, sectionTitle: section?.title });
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
			<div className="flex flex-wrap items-baseline gap-1"><Badges list={props.badges} status /><b className="line-clamp-2 font-medium" title={props.title}>{props.title ?? props.src.split("/").pop()}</b></div>
			{props.caption && <div className="line-clamp-2 text-muted-foreground" title={props.caption}>{props.caption}</div>}
			{props.badges?.some((b) => !tone(b)) && <div className="flex flex-wrap gap-1"><Badges list={props.badges} status={false} /></div>}
			<div className="mt-auto flex items-center gap-1 pt-1"><Votes id={id} />{note && <span className="truncate text-muted-foreground italic" title={r?.note}>💬 {note}</span>}</div>
		</figcaption>
	</figure>;
}
