import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Controls, fullScreen, select } from "./player"
import { type Entry, fileUrl, registry, useStore } from "./state"

const label = (item: Entry) => (item.title ?? item.id).slice(0, 40)

// [Agent] Every video of one section in a full-screen row on one clock, so versions of the same clip can be
// audited frame against frame. Unticking hides a column; the sound pick decides the clock, while the on-screen
// order stays the section's.
function Row({ ids, title }: { ids: string[]; title: string }) {
	const items = ids.map((id) => registry.get(id)!)
	const [shown, setShown] = useState(ids)
	const [voice, setVoice] = useState(ids[0])
	const [videos, setVideos] = useState<HTMLVideoElement[]>([])
	// [Agent] The dialog portal mounts its content a render late, so the row is kept in state, not a ref.
	const [row, setRow] = useState<HTMLDivElement | null>(null)
	const columns = items.filter((item) => shown.includes(item.id))

	useEffect(() => {
		const all = [...(row?.querySelectorAll("video") ?? [])]
		const clock = all[columns.findIndex((item) => item.id === voice)] ?? all[0]
		setVideos(clock ? [clock, ...all.filter((v) => v !== clock)] : [])
	}, [row, shown, voice])

	function tick(id: string) {
		const next = shown.includes(id) ? shown.filter((other) => other !== id) : [...shown, id]
		if (!next.length) return
		setShown(next)
		if (!next.includes(voice)) setVoice(next[0])
	}

	return (
		<Dialog open onOpenChange={(open) => open || useStore.setState({ side: null })}>
			<DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className={`${fullScreen} bg-black`}>
				<header className="flex flex-wrap items-center gap-3 bg-popover px-4 py-2 text-sm">
					<DialogTitle className="max-w-[40ch] truncate text-sm">{title}</DialogTitle>
					<span className="flex flex-wrap gap-3 text-muted-foreground">
						{items.map((item) => (
							<label key={item.id} className="cursor-pointer whitespace-nowrap" title={item.title}>
								<input type="checkbox" checked={shown.includes(item.id)} onChange={() => tick(item.id)} />{" "}
								{label(item)}
							</label>
						))}
					</span>
					<label>
						Sound:{" "}
						<select className={select} value={voice} onChange={(e) => setVoice(e.target.value)}>
							{columns.map((item) => (
								<option key={item.id} value={item.id}>
									{label(item)}
								</option>
							))}
						</select>
					</label>
					<Button className="ml-auto" onClick={() => useStore.setState({ side: null })}>
						Close (Esc)
					</Button>
				</header>
				<div ref={setRow} className="flex min-h-0 flex-1 gap-1">
					{columns.map((item) => (
						<figure key={item.id} className="flex min-w-0 flex-1 flex-col">
							<figcaption
								className="truncate bg-popover px-1.5 py-1 text-[13px] font-semibold"
								title={item.title}
							>
								{item.title}
							</figcaption>
							<video
								src={fileUrl(item.src!)}
								loop
								muted
								playsInline
								preload="auto"
								className="min-h-0 w-full flex-1 bg-black object-contain"
							/>
						</figure>
					))}
				</div>
				<Controls videos={videos} keys />
			</DialogContent>
		</Dialog>
	)
}

export function SideBySide() {
	const side = useStore((s) => s.side)
	return side && <Row {...side} />
}
