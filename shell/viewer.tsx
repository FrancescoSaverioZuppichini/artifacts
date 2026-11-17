import { useContext, useEffect, useRef, useState } from "react";
import { Badges } from "../components/badge";
import { Note } from "../components/note";
import type { Probe } from "../types";
import { Controls, useModal } from "./player";
import { cards, type Entry, fileUrl, flush, PageCtx, registry, store, stored, thumbUrl, typing } from "./state";
import { Votes } from "./votes";

// [Agent] One card full screen. With `compare` the reference sits on top, clipped by a wipe, and both videos share one clock.
function Frame({ it }: { it: Entry }) {
	const { media } = useContext(PageCtx), box = useRef<HTMLDivElement>(null);
	const [videos, setVideos] = useState<HTMLVideoElement[]>([]), [split, setSplit] = useState(50);
	const p = media[it.src], refSrc = it.compare ? registry.get(it.compare)?.src || it.compare : undefined, rp = refSrc ? media[refSrc] : undefined;
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
					<b className="overlay absolute top-2 right-2 rounded bg-black/70 px-1.5 text-[11px]">This card</b>
				</>}
			</div>
		</div>
		<Controls videos={videos} />
	</div>;
}

export function Viewer({ id, setId }: { id: string; setId: (id: string | null) => void }) {
	const ids = cards(), i = ids.indexOf(id), it = registry.get(id)!;
	const [hidden, setHidden] = useState(() => stored("artifacts.hide-overlays") === "1");
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
	const hide = () => { setHidden(!hidden); store("artifacts.hide-overlays", hidden ? "0" : "1"); };
	return <dialog {...modal} className={`m-0 h-dvh max-h-none w-screen max-w-none bg-background p-0 text-foreground open:flex open:flex-col${hidden ? " hide-ov" : ""}`}>
		<div className="min-h-0 flex-1 bg-black"><Frame key={id} it={it} /></div>
		<footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-sm">
			<div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5">
				{it.sectionTitle && <span className="text-muted-foreground">{it.sectionTitle} /</span>}
				<Badges list={it.badges} status /><b>{it.title}</b>
				{it.caption && <span className="text-muted-foreground">{it.caption}</span>}
				<Badges list={it.badges} status={false} />
				<a href={fileUrl(it.src)} download={it.src.split("/").pop()} className="text-sky-300 underline">⬇ original</a>
			</div>
			<button className="btn" onClick={() => go(-1)} aria-label="Previous">←</button><button className="btn" onClick={() => go(1)} aria-label="Next">→</button>
			<Votes id={id} />
			<div className="min-w-60 flex-1"><Note key={id} id={id} placeholder="Note · Ctrl/⌘+Enter saves and goes next · ←/→ move · Esc closes" onSubmit={() => go(1)} /></div>
			<span className="text-muted-foreground">{i + 1} / {ids.length}</span>
			<button className="btn" onClick={hide}>{hidden ? "Show overlays" : "Hide overlays"}</button>
			<button className="btn" onClick={close}>Close</button>
		</footer>
	</dialog>;
}
