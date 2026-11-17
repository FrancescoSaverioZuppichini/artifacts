import { useEffect, useLayoutEffect, useState } from "react"
import { Badges } from "@/components/badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Comment } from "./comment"
import { cards, countNotes, registry, setOpen, useStore } from "./state"

const SIZES = { S: "140px", M: "200px", L: "300px" }

export const sections = () => [...document.querySelectorAll<HTMLElement>("[data-section]")]

export function openAround(el: Element) {
	const around = []
	for (let s = el.closest("[data-section]"); s; s = s.parentElement?.closest("[data-section]") ?? null) {
		around.push(s.id)
	}
	setOpen(around, true)
}

// [Agent] A link target can be a section or a card: open every section around it, ring a card, and scroll once
// React has shown the opened content (a folded section has no layout to scroll to).
export function jump(id: string) {
	const el = document.getElementById(id)
	if (!el) return
	openAround(el)
	if (el.dataset.card) el.dataset.picked = ""
	history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(id)}`)
	requestAnimationFrame(() => el.scrollIntoView({ block: el.dataset.card ? "center" : "start" }))
}

// [Agent] Scroll-spy: the last section whose top has passed the edge, or the last one at the very bottom.
function getActive(ids: string[]) {
	const atBottom = document.documentElement.scrollHeight - scrollY - innerHeight < 2
	const passed = ids.filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? 0) <= 80)
	return (atBottom ? ids.at(-1) : passed.at(-1)) ?? ids[0]
}

// [Agent] The sidebar: review progress, the S/M/L card size, and the contents. Sections and cards are read from
// the rendered page, not page.json, so the ones written by hand in the MDX count too.
export function Toc({ data, onPick }: { data: unknown; onPick?: () => void }) {
	const feedback = useStore((s) => s.feedback)
	const status = useStore((s) => s.status)
	const [ids, setIds] = useState<string[]>([])
	const [cardIds, setCardIds] = useState<string[]>([])
	const [active, setActive] = useState<string>()
	const [size, setSize] = useState(() => localStorage.getItem("artifacts.card-h") ?? SIZES.M)
	const reviewed = cardIds.filter((id) => feedback[id]?.vote || feedback[id]?.note?.trim()).length

	useLayoutEffect(() => {
		setIds(sections().map((el) => el.id))
		setCardIds(cards())
	}, [data])

	useEffect(() => {
		document.documentElement.style.setProperty("--card-h", size)
		localStorage.setItem("artifacts.card-h", size)
	}, [size])

	useEffect(() => {
		let frame = 0
		const spy = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => setActive(getActive(ids)))
		}
		addEventListener("scroll", spy, { passive: true })
		addEventListener("resize", spy)
		spy()
		return () => {
			removeEventListener("scroll", spy)
			removeEventListener("resize", spy)
		}
	}, [ids])

	useEffect(() => {
		document.querySelector(`[data-toc="${CSS.escape(active ?? "")}"]`)?.scrollIntoView({ block: "nearest" })
	}, [active])

	return (
		<nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 text-sm">
			<a href="/" className="text-xs text-muted-foreground hover:text-foreground">
				← all pages
			</a>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				{reviewed} / {cardIds.length} reviewed <span>{status}</span>
				<span className="ml-auto flex gap-1">
					{Object.entries(SIZES).map(([label, height]) => (
						<Button
							key={label}
							size="xs"
							variant={size === height ? "secondary" : "outline"}
							aria-pressed={size === height}
							onClick={() => setSize(height)}
						>
							{label}
						</Button>
					))}
				</span>
			</div>
			<div className="-mb-2 flex items-center gap-1.5">
				<span className="font-medium">Contents</span>
				<Button size="xs" className="ml-auto" onClick={() => setOpen(ids, true)}>
					Expand all
				</Button>
				<Button size="xs" onClick={() => setOpen(ids, false)}>
					Collapse all
				</Button>
			</div>
			<ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1 pr-3 [scrollbar-width:thin]">
				{ids.map((id) => {
					const { date, title, badges } = registry.get(id) ?? {}
					const note = feedback[id]?.note?.trim()
					const notes = countNotes(feedback, id)
					return (
						<li key={id}>
							<a
								href={`#${id}`}
								data-toc={id}
								aria-current={active === id ? "location" : undefined}
								onClick={(e) => {
									e.preventDefault()
									jump(id)
									onPick?.()
								}}
								className={cn(
									"block rounded-md px-2 py-1 leading-snug text-muted-foreground transition-colors",
									"hover:bg-muted hover:text-foreground",
									"aria-[current=location]:bg-muted aria-[current=location]:text-foreground",
								)}
							>
								{date && <span className="block text-[11px] opacity-70">{date}</span>}
								<span className="line-clamp-2">{title}</span>
								<span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
									<Badges list={badges} status />
									{notes > 0 && <Badge>💬 {notes}</Badge>}
								</span>
								{note && <Comment text={note} line className="mt-1 py-0.5 text-xs" />}
							</a>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
