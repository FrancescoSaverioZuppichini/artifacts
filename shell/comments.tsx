import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Card } from "@/components/ui/card"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { Feedback } from "@/types"
import { anchor, type Quote, quoteOf, SKIP } from "./anchor"
import { CommentCard } from "./comment"
import { edit, flush, registry, useStore } from "./state"

type Draft = Quote & { section: string; sectionTitle?: string; range: Range }

const openComments = (feedback: Record<string, Feedback>) =>
	Object.entries(feedback).filter(([, r]) => r?.kind === "comment" && !r.resolved)
const inUi = (e: Event) => !!(e.target as Element).closest?.("[data-cmt]")

function getDraft(): Draft | undefined {
	const selection = getSelection()
	const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
	const node = range?.startContainer
	const start = node instanceof Element ? node : node?.parentElement
	const section = start?.closest<HTMLElement>("article [data-section]")
	if (!range || range.collapsed || !section || start!.closest(SKIP) || !section.contains(range.endContainer))
		return
	const quote = quoteOf(section, range)
	const sectionTitle = registry.get(section.id)?.title
	return quote ? { ...quote, section: section.id, sectionTitle, range: range.cloneRange() } : undefined
}

// [Agent] Finds every open comment's quote in its section and paints them all with the CSS Custom Highlight
// API, so the React-rendered page is never split into marks and a re-render cannot break them.
function anchorAll() {
	const ranges = new Map<string, Range>()
	for (const [id, entry] of openComments(useStore.getState().feedback)) {
		const scope = entry.section && document.getElementById(entry.section)
		const range = scope && anchor(scope, entry)
		if (range) ranges.set(id, range)
	}
	CSS.highlights.set("comment", new Highlight(...ranges.values()))
	return ranges
}

function hit(ranges: Map<string, Range>, e: MouseEvent) {
	if (!(e.target as Element).closest?.("article")) return
	for (const [id, range] of ranges) {
		for (const r of range.getClientRects()) {
			if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)
				return id
		}
	}
}

// [Agent] Comments on selected text. Every DOM change re-anchors all of them; one whose quote is gone shows as
// detached in its section. Hover shows a comment, a click pins it, a selection opens a new one.
export function Comments() {
	const feedback = useStore((s) => s.feedback)
	const [ranges, setRanges] = useState<Map<string, Range>>()
	const [draft, setDraft] = useState<Draft>()
	const [hover, setHover] = useState<string>()
	const [pinned, setPinned] = useState<string>()
	const box = useRef<HTMLDivElement>(null)
	const live = useRef(ranges)
	live.current = ranges
	const shownId = draft ? undefined : (pinned ?? hover)
	const shown = shownId ? feedback[shownId] : undefined
	const target = draft?.range ?? (shown && shownId ? ranges?.get(shownId) : undefined)
	// [Agent] A draft with text survives a click elsewhere, Esc and a new selection; an empty one closes.
	const typed = () => !!box.current?.querySelector("textarea")?.value.trim()
	// [Agent] The popover may still measure its anchor while it closes, so keep the last range, and open it
	// under the quote's last line, not its whole bounding box.
	const last = useRef<Range>(undefined)
	if (target) last.current = target
	const virtualRef = useMemo(() => {
		const rect = () => [...last.current!.getClientRects()].at(-1) ?? last.current!.getBoundingClientRect()
		return { current: { getBoundingClientRect: rect } }
	}, [target])

	useLayoutEffect(() => setRanges(anchorAll()), [feedback])
	useEffect(() => {
		CSS.highlights.set("comment-active", target ? new Highlight(target) : new Highlight())
	}, [target])

	useEffect(() => {
		const frames = [0, 0]
		const later = (slot: number, run: () => void) => {
			cancelAnimationFrame(frames[slot])
			frames[slot] = requestAnimationFrame(run)
		}
		const watch = new MutationObserver(() => later(0, () => setRanges(anchorAll())))
		watch.observe(document.querySelector("article")!, { childList: true, subtree: true, characterData: true })
		let leave: Timer
		const move = (e: MouseEvent) =>
			later(1, () => {
				const id = inUi(e) ? undefined : hit(live.current!, e)
				clearTimeout(leave)
				if (id) setHover(id)
				else if (!inUi(e)) leave = setTimeout(() => setHover(undefined), 300)
			})
		const pick = (e: Event) => {
			if (inUi(e) || (e instanceof KeyboardEvent && e.key !== "Shift")) return
			setTimeout(() => {
				const next = getDraft()
				if (next && !typed()) setDraft(next)
			})
		}
		// [Agent] Capture phase, so a click on highlighted text inside a card caption pins the comment instead of
		// opening the viewer.
		const click = (e: MouseEvent) => {
			if (inUi(e)) return
			const id = getSelection()?.isCollapsed ? hit(live.current!, e) : undefined
			if (id) {
				e.stopPropagation()
				e.preventDefault()
			}
			setPinned(id)
		}
		document.addEventListener("pointerup", pick)
		document.addEventListener("keyup", pick)
		document.addEventListener("mousemove", move)
		document.addEventListener("click", click, true)
		return () => {
			watch.disconnect()
			frames.forEach(cancelAnimationFrame)
			document.removeEventListener("pointerup", pick)
			document.removeEventListener("keyup", pick)
			document.removeEventListener("mousemove", move)
			document.removeEventListener("click", click, true)
		}
	}, [])

	function dismiss() {
		setDraft(undefined)
		setPinned(undefined)
		setHover(undefined)
	}

	function create(note: string) {
		const { range, ...rest } = draft!
		edit(`c-${Math.random().toString(36).slice(2, 8)}`, { kind: "comment", ...rest, note, resolved: false })
		flush()
		setDraft(undefined)
	}

	const body = draft ? (
		<CommentCard
			key={`${draft.section}:${draft.prefix}${draft.quote}`}
			entry={{ quote: draft.quote }}
			onCreate={create}
			onClose={() => setDraft(undefined)}
		/>
	) : (
		shown && <CommentCard key={`${shownId}:${shown.note}`} id={shownId} entry={shown} onClose={dismiss} />
	)

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
					onClickCapture={() => shown && setPinned(shownId)}
					className="w-80 p-2.5"
				>
					{body}
				</PopoverContent>
			</Popover>
			{ranges &&
				openComments(feedback)
					.filter(([id]) => !ranges.has(id))
					.map(([id, entry]) => {
						const slot =
							document.querySelector(`[data-comments="${CSS.escape(entry.section ?? "")}"]`) ??
							document.querySelector('[data-comments=""]')!
						const card = (
							<Card className="not-prose mt-3 w-80 max-w-full gap-0 rounded-md p-2.5 shadow-none">
								<CommentCard key={entry.note} id={id} entry={entry} detached />
							</Card>
						)
						return createPortal(card, slot, id)
					})}
		</>
	)
}
