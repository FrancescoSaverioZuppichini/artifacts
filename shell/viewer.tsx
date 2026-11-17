import { useContext, useEffect, useState } from "react"
import { Badges } from "@/components/badge"
import { Note } from "@/components/note"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Probe } from "@/types"
import { Controls, fullScreen } from "./player"
import { cards, type Entry, fileUrl, flush, PageCtx, registry, thumbUrl, typing } from "./state"
import { Votes } from "./votes"

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
const label = "absolute top-2 rounded bg-black/70 px-1.5 text-[11px] font-semibold"

function Asset({ src, probe, className }: { src: string; probe: Probe; className: string }) {
	if (!probe.video) return <img src={thumbUrl(src, probe, true)} className={className} alt="" />
	return <video src={fileUrl(src)} className={className} muted loop playsInline autoPlay preload="auto" />
}

// [Agent] One card full screen. With `compare` the reference sits on top, clipped by a wipe, and both videos
// share one clock.
function Frame({ item }: { item: Entry }) {
	const { media } = useContext(PageCtx)
	// [Agent] The dialog portal mounts its content a render late, so the box is kept in state, not a ref.
	const [box, setBox] = useState<HTMLDivElement | null>(null)
	const [videos, setVideos] = useState<HTMLVideoElement[]>([])
	const [split, setSplit] = useState(50)
	const probe = media[item.src]
	const refSrc = item.compare ? registry.get(item.compare)?.src || item.compare : undefined
	const refProbe = refSrc ? media[refSrc] : undefined

	useEffect(
		() => setVideos([...(box?.querySelectorAll("video") ?? [])]),
		[box, item.src, refSrc, !!probe, !!refProbe],
	)

	if (!probe)
		return (
			<div className="grid h-full place-items-center text-muted-foreground">
				⏳ not there yet · {item.src}
			</div>
		)
	const fit = { aspectRatio: `${probe.w} / ${probe.h}`, width: `min(100cqw, 100cqh * ${probe.w / probe.h})` }
	return (
		<div className="flex h-full flex-col">
			<div className="grid min-h-0 flex-1 place-items-center p-2 [container-type:size]">
				<div ref={setBox} className="relative" style={fit}>
					<Asset src={item.src} probe={probe} className="absolute inset-0 size-full object-contain" />
					{refSrc && refProbe && (
						<>
							<div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
								<Asset src={refSrc} probe={refProbe} className="size-full bg-black object-contain" />
							</div>
							<i className="absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${split}%` }} />
							<input
								type="range"
								value={split}
								aria-label="Compare"
								onChange={(e) => setSplit(Number(e.target.value))}
								onPointerUp={(e) => e.currentTarget.blur()}
								className="absolute inset-0 m-0 size-full cursor-ew-resize opacity-0"
							/>
							<span className={`${label} left-2`}>Reference</span>
							<span className={`${label} right-2`}>This card</span>
						</>
					)}
				</div>
			</div>
			<Controls videos={videos} />
		</div>
	)
}

export function Viewer({ id, setId }: { id: string; setId: (id: string | null) => void }) {
	const ids = cards()
	const index = ids.indexOf(id)
	const item = registry.get(id)!

	function go(step: number) {
		flush()
		setId(ids[Math.max(0, Math.min(ids.length - 1, index + step))])
	}

	function close() {
		flush()
		setId(null)
	}

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!STEPS[e.key] || typing(e)) return
			e.preventDefault()
			go(STEPS[e.key])
		}
		addEventListener("keydown", onKey)
		return () => removeEventListener("keydown", onKey)
	}, [index])

	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			{/* [Agent] No auto-focus: a focused button or slider would swallow ←/→ and show a focus ring. */}
			<DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className={fullScreen}>
				<div className="min-h-0 flex-1 bg-black">
					<Frame key={id} item={item} />
				</div>
				<footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-sm">
					<div className="flex min-w-0 basis-full flex-wrap items-center gap-1.5">
						{item.sectionTitle && <span className="text-muted-foreground">{item.sectionTitle} /</span>}
						<Badges list={item.badges} status />
						<DialogTitle className="text-sm">{item.title}</DialogTitle>
						{item.caption && <span className="text-muted-foreground">{item.caption}</span>}
						<Badges list={item.badges} status={false} />
						<a
							href={fileUrl(item.src)}
							download={item.src.split("/").pop()}
							className="text-sky-300 underline"
						>
							⬇ original
						</a>
					</div>
					<Button aria-label="Previous" onClick={() => go(-1)}>
						←
					</Button>
					<Button aria-label="Next" onClick={() => go(1)}>
						→
					</Button>
					<Votes id={id} />
					<div className="min-w-60 flex-1 *:mt-0">
						<Note
							key={id}
							id={id}
							placeholder="Note · Ctrl/⌘+Enter saves and goes next · ←/→ move · Esc closes"
							onSubmit={() => go(1)}
						/>
					</div>
					<span className="text-muted-foreground">
						{index + 1} / {ids.length}
					</span>
					<Button onClick={close}>Close</Button>
				</footer>
			</DialogContent>
		</Dialog>
	)
}
