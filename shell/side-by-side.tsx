import { useEffect, useRef, useState } from "react";
import { Controls, useModal } from "./player";
import { fileUrl, registry, type Show } from "./state";

// [Agent] Every video of one section in a full-screen row on one clock, so versions of the same clip can be audited frame against frame.
// Unticking a column hides it; the sound pick decides the clock, while the on-screen order stays the section's.
export function SideBySide({ ids, title, close }: Show & { close: () => void }) {
	const items = ids.map((id) => registry.get(id)!).filter(Boolean);
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
	const label = (it: (typeof items)[number]) => (it.title ?? it.id).slice(0, 40);
	return <dialog {...modal} className="m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-foreground open:flex open:flex-col">
		<header className="flex flex-wrap items-center gap-3 bg-popover px-4 py-2 text-sm">
			<b className="max-w-[40ch] truncate">{title}</b>
			<span className="flex flex-wrap gap-3 text-muted-foreground">{items.map((it) => <label key={it.id} className="cursor-pointer whitespace-nowrap" title={it.title}><input type="checkbox" checked={shown.has(it.id)} onChange={() => tick(it.id)} /> {label(it)}</label>)}</span>
			<label>Sound: <select className="btn" value={voice} onChange={(e) => setVoice(e.target.value)}>{pick.map((it) => <option key={it.id} value={it.id}>{label(it)}</option>)}</select></label>
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
