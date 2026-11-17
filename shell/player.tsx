import { useEffect, useRef, useState } from "react";
import { typing } from "./state";

const FPS = 24;

// [Agent] The first video is the clock: the others are snapped to it whenever they drift, and all restart at the shortest duration so
// columns stay frame-aligned across loops. Only the clock ever gets sound, so the same track never plays twice out of sync.
export function Controls({ videos, keys }: { videos: HTMLVideoElement[]; keys?: boolean }) {
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
		<button className="btn" title="Sound" onClick={() => { clock.muted = !clock.muted; setMuted(clock.muted); }}>{muted ? "🔇" : "🔊"}</button>
	</div>;
}

export function useModal(onClose: () => void) {
	const ref = useRef<HTMLDialogElement>(null), latest = useRef(onClose);
	latest.current = onClose;
	const close = () => { ref.current?.querySelectorAll("video").forEach((v) => v.pause()); latest.current(); };
	// [Agent] showModal focuses the first button, which then swallows arrow keys and shows a focus ring; focus the dialog itself.
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
