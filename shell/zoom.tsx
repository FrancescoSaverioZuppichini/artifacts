import { type PointerEvent, useEffect, useRef, useState } from "react"
import type { Probe } from "@/types"
import { fileUrl, thumbUrl, typing } from "./state"

const KEYS: Record<string, number> = { "+": 1.25, "=": 1.25, "-": 0.8 }

// [Agent] `s` is CSS px per image px; x, y put the image's top-left corner in the stage, which is cw × ch.
type View = { s: number; x: number; y: number; cw: number; ch: number }

// [Agent] A still in the viewer: wheel, pinch, drag and keys zoom and pan it, and a minimap shows where you
// are whenever it overflows the stage.
export function Zoom({ src, probe }: { src: string; probe: Probe }) {
	const { w, h } = probe
	const [stage, setStage] = useState<HTMLDivElement | null>(null)
	const [v, setV] = useState<View>({ s: 0, x: 0, y: 0, cw: 0, ch: 0 })
	const last = useRef<{ x: number; y: number }>(undefined)

	// [Agent] Fit keeps the 8 px margin of the other viewer frames; zoomed, the image uses the whole stage.
	const fitOf = (v: View) => Math.min((v.cw - 16) / w, (v.ch - 16) / h)
	// [Agent] Never below fit. An axis shorter than the stage is centred; a longer one never shows a gap.
	const place = (v: View, s: number, x: number, y: number): View => {
		s = Math.max(fitOf(v), s)
		const axis = (p: number, size: number, room: number) =>
			size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, p))
		return { ...v, s, x: axis(x, w * s, v.cw), y: axis(y, h * s, v.ch) }
	}
	// [Agent] The image point under (px, py) stays under it.
	const zoomAt = (v: View, target: number, px: number, py: number) => {
		const s = Math.max(fitOf(v), Math.min(target, 8))
		return place(v, s, px - ((px - v.x) * s) / v.s, py - ((py - v.y) * s) / v.s)
	}
	// [Agent] Fitted whole, a strip over 3:1 (a full-page phone screenshot) is an unreadable sliver, so it opens
	// at its full width (or height), at most 100 %, from the top (or left).
	const home = (cw: number, ch: number) => {
		const v = { s: 0, x: 0, y: 0, cw, ch }
		return place(v, h > 3 * w ? Math.min(cw / w, 1) : w > 3 * h ? Math.min(ch / h, 1) : fitOf(v), 0, 0)
	}
	const atHome = (v: View) => {
		const o = home(v.cw, v.ch)
		return o.s === v.s && o.x === v.x && o.y === v.y
	}

	// [Agent] The note box grows while it is typed into, resizing the stage: an untouched view follows, a
	// zoomed one keeps its scale and corner.
	useEffect(() => {
		if (!stage) return
		const ro = new ResizeObserver(() => {
			const [cw, ch] = [stage.clientWidth, stage.clientHeight]
			setV((v) => (!v.cw || atHome(v) ? home(cw, ch) : place({ ...v, cw, ch }, v.s, v.x, v.y)))
		})
		ro.observe(stage)
		return () => ro.disconnect()
	}, [stage, w, h])

	// [Agent] A trackpad pinch arrives as a Ctrl + wheel. Not passive, or the browser zooms the page as well.
	useEffect(() => {
		if (!stage) return
		const onWheel = (e: WheelEvent) => {
			e.preventDefault()
			const r = stage.getBoundingClientRect()
			const k = Math.exp(-Math.max(-25, Math.min(25, e.deltaY)) / 100)
			setV((v) =>
				e.ctrlKey || e.metaKey
					? zoomAt(v, v.s * k, e.clientX - r.left, e.clientY - r.top)
					: place(v, v.s, v.x - e.deltaX, v.y - e.deltaY),
			)
		}
		stage.addEventListener("wheel", onWheel, { passive: false })
		return () => stage.removeEventListener("wheel", onWheel)
	}, [stage, w, h])

	// [Agent] Window capture runs before the dialog's Esc listener (document capture), and a prevented Esc
	// does not close it: the first Esc only undoes the zoom.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (typing(e) || e.metaKey || e.ctrlKey) return
			if (KEYS[e.key]) setV(zoomAt(v, v.s * KEYS[e.key], v.cw / 2, v.ch / 2))
			else if (e.key === "0" || (e.key === "Escape" && !atHome(v))) setV(home(v.cw, v.ch))
			else return
			e.preventDefault()
		}
		addEventListener("keydown", onKey, true)
		return () => removeEventListener("keydown", onKey, true)
	}, [v])

	const big = w * v.s > v.cw + 1 || h * v.s > v.ch + 1
	// [Agent] Short side at most 120 px; a strip may run along 80 % of the stage, like a scrollbar.
	const m = Math.min(120 / Math.min(w, h), (0.8 * (w > h ? v.cw : v.ch)) / Math.max(w, h))
	const jump = (e: PointerEvent<HTMLElement>) => {
		const r = e.currentTarget.getBoundingClientRect()
		const [ix, iy] = [(e.clientX - r.left) / m, (e.clientY - r.top) / m]
		setV((v) => place(v, v.s, v.cw / 2 - ix * v.s, v.ch / 2 - iy * v.s))
	}

	return (
		<div ref={setStage} className="relative size-full overflow-hidden select-none">
			<div
				className={`size-full touch-none ${big ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId)
					last.current = { x: e.clientX, y: e.clientY }
				}}
				onPointerMove={(e) => {
					if (!last.current) return
					const [dx, dy] = [e.clientX - last.current.x, e.clientY - last.current.y]
					last.current = { x: e.clientX, y: e.clientY }
					setV((v) => place(v, v.s, v.x + dx, v.y + dy))
				}}
				onLostPointerCapture={() => (last.current = undefined)}
				onDoubleClick={(e) => {
					const r = e.currentTarget.getBoundingClientRect()
					setV(zoomAt(v, v.s < 1 ? 1 : fitOf(v), e.clientX - r.left, e.clientY - r.top))
				}}
			>
				{/* [Agent] The 1600 px viewer thumbnail while it fits; once it overflows, the original loads on top. */}
				<div
					className="pointer-events-none absolute top-0 left-0 origin-top-left"
					style={{ width: w, height: h, transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }}
				>
					<img src={thumbUrl(src, probe, true)} className="absolute inset-0 size-full" alt="" />
					{big && <img src={fileUrl(src)} className="absolute inset-0 size-full" alt="" />}
				</div>
			</div>
			<div className="absolute right-3 bottom-3 flex items-end gap-1.5">
				<span className="rounded bg-black/70 px-1.5 text-[11px] font-semibold tabular-nums">
					{Math.round(v.s * 100)} %
				</span>
				{big && (
					<div
						className="relative cursor-pointer touch-none overflow-hidden outline outline-white/50"
						style={{ width: w * m, height: h * m }}
						onPointerDown={(e) => {
							e.currentTarget.setPointerCapture(e.pointerId)
							jump(e)
						}}
						onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && jump(e)}
					>
						<img src={thumbUrl(src, probe, true)} className="pointer-events-none size-full" alt="" />
						<i
							className="absolute border border-white shadow-[0_0_0_999px_rgb(0_0_0/0.5)]"
							style={{
								left: (Math.max(0, -v.x) / v.s) * m,
								top: (Math.max(0, -v.y) / v.s) * m,
								width: Math.min(w, v.cw / v.s) * m,
								height: Math.min(h, v.ch / v.s) * m,
							}}
						/>
					</div>
				)}
			</div>
		</div>
	)
}
