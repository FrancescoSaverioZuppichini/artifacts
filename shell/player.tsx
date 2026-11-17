import { useEffect, useRef, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import { typing } from "./state"

const FPS = 24

// [Agent] Turns the shadcn DialogContent into a full-screen stage (viewer and side by side).
export const fullScreen = [
	"inset-0 flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0",
	"translate-x-0 translate-y-0 sm:max-w-none",
].join(" ")
export const select = buttonVariants({ variant: "outline", size: "sm" })

// [Agent] The first video is the clock: the others are snapped to it whenever they drift, and all restart at
// the shortest duration so columns stay frame-aligned across loops. Only the clock ever gets sound, so the
// same track never plays twice out of sync.
export function Controls({ videos, keys }: { videos: HTMLVideoElement[]; keys?: boolean }) {
	const [playing, setPlaying] = useState(false)
	const [muted, setMuted] = useState(true)
	const seek = useRef<HTMLInputElement>(null)
	const clock = videos[0]
	const duration = () => Math.min(...videos.map((v) => v.duration || Infinity))

	function step(frames: number) {
		const time = Math.max(0, clock.currentTime + frames / FPS)
		for (const v of videos) {
			v.pause()
			v.currentTime = time
		}
	}

	// [Agent] Read paused once: after the clock's play() it is already false, and the followers would be paused
	// instead of started.
	function toggle() {
		const start = clock.paused
		for (const v of videos) start ? v.play().catch(() => {}) : v.pause()
	}

	useEffect(() => {
		if (!clock) return
		for (const v of videos) v.muted = v !== clock || muted
		let frame = 0
		const show = () => {
			if (seek.current) seek.current.value = String((clock.currentTime / duration()) * 1000)
		}
		const tick = () => {
			if (clock.currentTime >= duration() - 0.03) for (const v of videos) v.currentTime = 0
			for (const v of videos) {
				if (v !== clock && Math.abs(v.currentTime - clock.currentTime) > 0.08)
					v.currentTime = clock.currentTime
			}
			show()
			frame = requestAnimationFrame(tick)
		}
		const onPlay = () => {
			setPlaying(true)
			cancelAnimationFrame(frame)
			tick()
		}
		const onPause = () => {
			setPlaying(false)
			cancelAnimationFrame(frame)
		}
		clock.addEventListener("play", onPlay)
		clock.addEventListener("pause", onPause)
		clock.addEventListener("seeked", show)
		if (!clock.paused) onPlay()
		return () => {
			cancelAnimationFrame(frame)
			clock.removeEventListener("play", onPlay)
			clock.removeEventListener("pause", onPause)
			clock.removeEventListener("seeked", show)
		}
	}, [videos])

	useEffect(() => {
		if (!keys) return
		const onKey = (e: KeyboardEvent) => {
			if (typing(e)) return
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") step(e.key === "ArrowLeft" ? -1 : 1)
			else if (e.key === " ") toggle()
			else return
			e.preventDefault()
		}
		addEventListener("keydown", onKey)
		return () => removeEventListener("keydown", onKey)
	}, [videos, keys])

	if (!clock) return null
	return (
		<div className="flex items-center gap-2 border-t bg-popover px-3 py-2">
			<Button onClick={toggle}>{playing ? "Pause" : "Play"}</Button>
			<input
				ref={seek}
				type="range"
				max={1000}
				defaultValue={0}
				className="min-w-0 flex-1"
				onInput={(e) => {
					const time = (Number(e.currentTarget.value) / 1000) * duration()
					for (const v of videos) v.currentTime = time
				}}
				onPointerUp={(e) => e.currentTarget.blur()}
			/>
			<select
				className={select}
				onChange={(e) => videos.forEach((v) => (v.playbackRate = Number(e.target.value)))}
			>
				{[1, 0.5, 0.25].map((rate) => (
					<option key={rate} value={rate}>
						{rate}×
					</option>
				))}
			</select>
			<Button title="One frame back" onClick={() => step(-1)}>
				◀ frame
			</Button>
			<Button title="One frame forward" onClick={() => step(1)}>
				frame ▶
			</Button>
			<Button
				title="Sound"
				onClick={() => {
					clock.muted = !clock.muted
					setMuted(clock.muted)
				}}
			>
				{muted ? "🔇" : "🔊"}
			</Button>
		</div>
	)
}
