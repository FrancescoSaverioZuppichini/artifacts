import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Card } from "@/components/ui/card"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { anchor, type Quote, quoteOf, SKIP } from "./anchor"
import { CommentCard } from "./comment"
import { comments, edit, flush, useVersion } from "./state"

type Draft = Quote & { section: string; sectionTitle?: string; range: Range }

const inUi = (e: Event) => !!(e.target as Element).closest?.("[data-cmt]")

function getDraft(): Draft | null {
	const selection = getSelection()
	const range = selection?.rangeCount ? selection.getRangeAt(0) : null
	if (!range || range.collapsed) return null
	const node = range.startContainer
	const start = node instanceof Element ? node : node.parentElement
	const section = start?.closest<HTMLElement>("article [data-section]")
	if (!section || start!.closest(SKIP) || !section.contains(range.endContainer)) return null
	const quote = quoteOf(section, range)
	return (
		quote && { ...quote, section: section.id, sectionTitle: section.dataset.title, range: range.cloneRange() }
	)
}

function saveNote(id: string) {
	return (note: string) => {
		edit(id, { note })
		flush()
	}
}

// [Agent] Comments on selected text. Highlights use the CSS Custom Highlight API, so the React-rendered page
// is never split into marks and a re-render cannot break them; every DOM change re-anchors all comments, and
// one whose quote is gone shows as detached in its section.
export function Comments() {
	const version = useVersion()
	const ranges = useRef(new Map<string, Range>())
	const leave = useRef<Timer>(undefined)
	const [anchored, setAnchored] = useState<string>()
	const [draft, setDraft] = useState<Draft | null>(null)
	const [hover, setHover] = useState<string | null>(null)
	const [pinned, setPinned] = useState<string | null>(null)

	const list = comments()
	const shownId = draft ? null : (pinned ?? hover)
	const shown = shownId ? ranges.current.get(shownId) : undefined
	const shownEntry = shown && list.find(([id]) => id === shownId)?.[1]
	const target = draft?.range ?? (shownEntry ? shown : undefined)
	const box = useRef<HTMLDivElement>(null)
	// [Agent] A draft with text survives a click elsewhere, Esc and a new selection; an empty one closes.
	const typed = () => !!box.current?.querySelector("textarea")?.value.trim()
	// [Agent] The popover may still measure its anchor while it closes, so keep the last range it pointed at,
	// and open it under the quote's last line, not its whole bounding box.
	const lastTarget = useRef<Range>(undefined)
	if (target) lastTarget.current = target
	const virtualRef = useMemo(() => {
		const rect = () =>
			[...lastTarget.current!.getClientRects()].at(-1) ?? lastTarget.current!.getBoundingClientRect()
		return { current: { getBoundingClientRect: rect } }
	}, [target])

	function paintActive() {
		const range = draft?.range ?? (shownId ? ranges.current.get(shownId) : undefined)
		CSS.highlights.set("comment-active", range ? new Highlight(range) : new Highlight())
	}

	// [Agent] Kept in a ref so the MutationObserver, set up once, always runs the latest closure.
	const reanchor = useRef(() => {})
	reanchor.current = () => {
		const next = new Map<string, Range>()
		for (const [id, entry] of comments()) {
			const scope = entry.section && document.getElementById(entry.section)
			const range = scope && entry.quote ? anchor(scope, entry) : undefined
			if (range) next.set(id, range)
		}
		ranges.current = next
		CSS.highlights.set("comment", new Highlight(...next.values()))
		paintActive()
		setAnchored([...next.keys()].join())
	}

	useLayoutEffect(() => reanchor.current(), [version])
	useEffect(paintActive, [draft, shownId])

	useEffect(() => {
		let frame = 0
		const watch = new MutationObserver(() => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => reanchor.current())
		})
		watch.observe(document.querySelector("article")!, { childList: true, subtree: true, characterData: true })
		return () => {
			watch.disconnect()
			cancelAnimationFrame(frame)
		}
	}, [])

	useEffect(() => {
		const hit = (e: MouseEvent) => {
			if (!(e.target as Element).closest?.("article")) return
			for (const [id, range] of ranges.current) {
				for (const box of range.getClientRects()) {
					const inside = e.clientX >= box.left && e.clientX <= box.right
					if (inside && e.clientY >= box.top && e.clientY <= box.bottom) return id
				}
			}
		}
		// [Agent] Selecting text opens the comment form straight away, on the selection's last line.
		const pick = (e: Event) => {
			if (inUi(e) || (e instanceof KeyboardEvent && e.key !== "Shift")) return
			setTimeout(() => {
				const next = getDraft()
				if (next && !typed()) setDraft(next)
			})
		}
		let frame = 0
		const move = (e: MouseEvent) => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const id = inUi(e) ? undefined : hit(e)
				clearTimeout(leave.current)
				if (id) setHover(id)
				else if (!inUi(e)) leave.current = setTimeout(() => setHover(null), 300)
			})
		}
		// [Agent] Capture phase, so a click on highlighted text inside a card caption pins the comment instead of
		// opening the viewer.
		const click = (e: MouseEvent) => {
			if (inUi(e)) return
			const id = getSelection()?.isCollapsed ? hit(e) : undefined
			if (id) {
				e.stopPropagation()
				e.preventDefault()
			}
			setPinned(id ?? null)
		}
		document.addEventListener("pointerup", pick)
		document.addEventListener("keyup", pick)
		document.addEventListener("mousemove", move)
		document.addEventListener("click", click, true)
		return () => {
			document.removeEventListener("pointerup", pick)
			document.removeEventListener("keyup", pick)
			document.removeEventListener("mousemove", move)
			document.removeEventListener("click", click, true)
		}
	}, [])

	function dismiss() {
		setDraft(null)
		setPinned(null)
		setHover(null)
	}

	function create(note: string) {
		const { range, ...rest } = draft!
		edit(`c-${Math.random().toString(36).slice(2, 8)}`, { kind: "comment", ...rest, note, resolved: false })
		flush()
		setDraft(null)
	}

	let body: ReactNode = null
	if (draft) {
		const key = `${draft.section}:${draft.prefix}${draft.quote}`
		body = (
			<CommentCard key={key} entry={{ quote: draft.quote }} onSave={create} onClose={() => setDraft(null)} />
		)
	} else if (shownId && shownEntry) {
		const key = `${shownId}:${shownEntry.note}`
		body = (
			<CommentCard key={key} id={shownId} entry={shownEntry} onSave={saveNote(shownId)} onClose={dismiss} />
		)
	}

	const detached = anchored === undefined ? [] : list.filter(([id]) => !ranges.current.has(id))
	return (
		<>
			<Popover open={!!target && !!body} onOpenChange={(open) => open || dismiss()}>
				<PopoverAnchor virtualRef={virtualRef} />
				{/* [Agent] No auto-focus from the popover, so hovering a highlight never steals the caret; a draft's
				    textarea focuses itself. */}
				<PopoverContent
					ref={box}
					data-cmt
					side="bottom"
					align="start"
					sideOffset={6}
					onOpenAutoFocus={(e) => e.preventDefault()}
					onInteractOutside={(e) => typed() && e.preventDefault()}
					onEscapeKeyDown={(e) => typed() && e.preventDefault()}
					onClickCapture={() => shownEntry && !draft && setPinned(shownId)}
					className="w-80 p-2.5"
				>
					{body}
				</PopoverContent>
			</Popover>
			{detached.map(([id, entry]) => {
				const slot =
					document.querySelector(`[data-comments="${CSS.escape(entry.section ?? "")}"]`) ??
					document.querySelector('[data-comments=""]')
				const card = (
					<Card className="not-prose mt-3 w-80 max-w-full gap-0 rounded-md p-2.5 shadow-none">
						<CommentCard key={entry.note} id={id} entry={entry} detached onSave={saveNote(id)} />
					</Card>
				)
				return slot && createPortal(card, slot, id)
			})}
		</>
	)
}
