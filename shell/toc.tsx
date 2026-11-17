import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Badge } from "@/components/badge"
import { Badge as Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Comment } from "./comment"
import { cards, countNotes, review, setOpen, status, useVersion } from "./state"

const SIZES = { S: "140px", M: "200px", L: "300px" }

// [Agent] Storage throws in some private windows; a lost preference is fine, a crashed page is not.
function stored(key: string, value?: string) {
	try {
		if (value === undefined) return localStorage.getItem(key)
		localStorage.setItem(key, value)
	} catch {}
	return null
}

export const sections = () => [...document.querySelectorAll<HTMLElement>("[data-section]")]

export function openAround(el: Element) {
	for (let s = el.closest("[data-section]"); s; s = s.parentElement?.closest("[data-section]") ?? null) {
		setOpen(s.id, true)
	}
}

// [Agent] A link target can be a section or a card: open every section around it, ring a card, and scroll
// once React has shown the opened content (a folded section has no layout to scroll to).
export function jump(id: string) {
	const el = document.getElementById(id)
	if (!el) return
	openAround(el)
	if (el.dataset.card) el.dataset.picked = ""
	history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(id)}`)
	requestAnimationFrame(() => el.scrollIntoView({ block: el.dataset.card ? "center" : "start" }))
}

// [Agent] Read from the rendered sections, not from page.json, so sections written by hand in the MDX are
// listed too.
function listItems() {
	return sections().map((el) => {
		const cards = [...el.querySelectorAll<HTMLElement>("[data-card]")].map((card) => card.dataset.card!)
		return {
			id: el.id,
			date: el.dataset.date!,
			title: el.dataset.title!,
			badges: JSON.parse(el.dataset.badges!) as string[],
			note: review(el.id)?.note?.trim() ?? "",
			notes: countNotes(el.id, [el.id, ...cards]),
		}
	})
}

// [Agent] Scroll-spy: the active entry is the last section whose top has passed the edge, or the last one
// when the page is scrolled to the bottom.
function getActive(ids: string[]) {
	const tops = ids.map((id) => ({
		id,
		top: document.getElementById(id)?.getBoundingClientRect().top ?? Infinity,
	}))
	const atBottom = document.documentElement.scrollHeight - scrollY - innerHeight < 2
	const passed = atBottom ? tops.at(-1) : tops.filter((t) => t.top <= 80).at(-1)
	return passed?.id ?? tops[0]?.id ?? ""
}

// [Agent] The sidebar: review progress, the S/M/L card size, and the contents.
export function Toc({ data, onPick }: { data: unknown; onPick?: () => void }) {
	const version = useVersion()
	const [items, setItems] = useState<ReturnType<typeof listItems>>([])
	const [ids, setIds] = useState<string[]>([])
	const [active, setActive] = useState("")
	const [size, setSize] = useState(() => stored("artifacts.card-h") ?? SIZES.M)
	const list = useRef<HTMLUListElement>(null)
	const reviewed = ids.filter((id) => review(id)?.vote || review(id)?.note?.trim()).length

	useLayoutEffect(() => {
		const next = listItems()
		if (JSON.stringify(next) !== JSON.stringify(items)) setItems(next)
		if (cards().join() !== ids.join()) setIds(cards())
	}, [data, version])

	useEffect(() => {
		document.documentElement.style.setProperty("--card-h", size)
		stored("artifacts.card-h", size)
	}, [size])

	useEffect(() => {
		let frame = 0
		const spy = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => setActive(getActive(items.map((item) => item.id))))
		}
		addEventListener("scroll", spy, { passive: true })
		addEventListener("resize", spy)
		spy()
		return () => {
			removeEventListener("scroll", spy)
			removeEventListener("resize", spy)
		}
	}, [items])

	useEffect(() => {
		list.current?.querySelector(`[data-toc="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" })
	}, [active])

	return (
		<nav className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 text-sm">
			<a href="/" className="text-xs text-muted-foreground hover:text-foreground">
				← all pages
			</a>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				{reviewed} / {ids.length} reviewed <span>{status}</span>
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
				<Button size="xs" className="ml-auto" onClick={() => sections().forEach((s) => setOpen(s.id, true))}>
					Expand all
				</Button>
				<Button size="xs" onClick={() => sections().forEach((s) => setOpen(s.id, false))}>
					Collapse all
				</Button>
			</div>
			{/* [Agent] Radix wraps the list in a display:table div that grows with its widest line; block keeps
			    the notes truncated to the sidebar width. */}
			<ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
				<ul ref={list} className="space-y-0.5 p-1 pr-3">
					{items.map((item) => (
						<li key={item.id}>
							<a
								href={`#${item.id}`}
								data-toc={item.id}
								aria-current={active === item.id ? "location" : undefined}
								onClick={(e) => {
									e.preventDefault()
									jump(item.id)
									onPick?.()
								}}
								className={cn(
									"block rounded-md px-2 py-1 leading-snug text-muted-foreground transition-colors",
									"hover:bg-muted hover:text-foreground",
									active === item.id && "bg-muted text-foreground",
								)}
							>
								{item.date && <span className="block text-[11px] opacity-70">{item.date}</span>}
								<span className="line-clamp-2">{item.title}</span>
								{(item.badges.length > 0 || item.notes > 0) && (
									<span className="mt-0.5 flex flex-wrap gap-1">
										{item.badges.map((text) => (
											<Badge key={text}>{text}</Badge>
										))}
										{item.notes > 0 && <Chip>💬 {item.notes}</Chip>}
									</span>
								)}
								{item.note && <Comment text={item.note} line className="mt-1 py-0.5 text-xs" />}
							</a>
						</li>
					))}
				</ul>
			</ScrollArea>
		</nav>
	)
}
