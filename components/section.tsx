import { ChevronRight } from "lucide-react"
import { type ReactNode, useContext, useLayoutEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Comment } from "@/shell/comment"
import {
	countNotes,
	PageCtx,
	registry,
	SectionCtx,
	setOpen,
	useOpen,
	useReview,
	useVersion,
} from "@/shell/state"
import type { SectionProps } from "@/types"
import { Badges, tone } from "./badge"
import { components } from "./index"
import { Note } from "./note"

const chevron = "text-muted-foreground transition-transform group-data-[state=open]/section:rotate-90"

// [Agent] Its own subscriber, so a keystroke in a note re-renders this chip and not every card of the
// section.
function NoteCount({ section }: { section: string }) {
	useVersion()
	const ids = [...registry.values()].filter((entry) => entry.section === section).map((entry) => entry.id)
	const count = countNotes(section, [section, ...ids])
	return count > 0 && <Badge>💬 {count}</Badge>
}

// [Agent] A foldable chapter. Folded content stays mounted (forceMount, hidden by CSS) so the contents, the
// viewer, ←/→ and comment anchoring see every card. The contents is read from these data-* attributes, so
// sections written by hand in the MDX are listed too.
export function Section({
	id,
	title,
	date,
	badges,
	open,
	blocks,
	children,
}: SectionProps & { children?: ReactNode }) {
	const { sideBySide } = useContext(PageCtx)
	const isOpen = useOpen(id)
	const note = useReview(id)?.note?.trim()
	const ref = useRef<HTMLDivElement>(null)
	const [videos, setVideos] = useState(0)
	registry.set(id, { id, src: "", kind: "section", title })

	useLayoutEffect(() => setVideos(ref.current!.querySelectorAll("[data-video]").length))

	function playAll(e: React.MouseEvent) {
		e.stopPropagation()
		const cards = ref.current!.querySelectorAll<HTMLElement>("[data-card][data-video]")
		sideBySide({ ids: [...cards].map((card) => card.dataset.card!), title })
	}

	// [Agent] The note shown under the title is a preview; a click opens the section and its note box to edit
	// it.
	function editNote(e: React.MouseEvent) {
		e.stopPropagation()
		setOpen(id, true)
		requestAnimationFrame(() => {
			const box = ref.current!.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"]`)
			box?.scrollIntoView({ block: "center" })
			box?.focus()
		})
	}

	return (
		<SectionCtx.Provider value={{ id, title }}>
			<Collapsible
				ref={ref}
				id={id}
				open={isOpen}
				onOpenChange={(next) => setOpen(id, next)}
				data-section=""
				data-date={date ?? ""}
				data-title={title}
				data-badges={JSON.stringify(badges?.filter(tone) ?? [])}
				data-open={open ? "" : undefined}
				className="group/section scroll-mt-6 border-b py-3"
			>
				{/* [Agent] The whole header folds on click; the chevron is the keyboard-reachable trigger. */}
				<div
					className="not-prose flex cursor-pointer gap-2 rounded-md p-1 hover:bg-muted/50"
					onClick={() => setOpen(id, !isOpen)}
				>
					<CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
						<Button variant="ghost" size="icon-xs" aria-label={isOpen ? "Fold" : "Unfold"}>
							<ChevronRight className={chevron} />
						</Button>
					</CollapsibleTrigger>
					<div className="min-w-0 flex-1">
						{date && <div className="text-xs text-muted-foreground">{date}</div>}
						<div className="flex flex-wrap items-center gap-1.5">
							<h2 className="text-lg font-semibold tracking-tight text-balance">{title}</h2>
							<Badges list={badges} status />
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-1 empty:hidden">
							<Badges list={badges} status={false} />
							{videos > 1 && (
								<Button size="xs" onClick={playAll}>
									▶ Side by side · {videos} videos
								</Button>
							)}
							<NoteCount section={id} />
						</div>
						{note && <Comment text={note} line={!isOpen} className="mt-2 cursor-text" onClick={editNote} />}
					</div>
				</div>
				<CollapsibleContent forceMount className="pl-8 data-[state=closed]:hidden">
					{blocks?.map(({ type, ...props }, i) => {
						const Block = components[type as keyof typeof components] as React.ComponentType<any>
						if (Block) return <Block key={i} {...props} />
						return (
							<p key={i} className="text-red-300">
								Unknown block type “{type}”: register it in components/index.ts
							</p>
						)
					})}
					{children}
					<div data-comments={id} />
					<Note id={id} placeholder="Note on this section…" />
				</CollapsibleContent>
			</Collapsible>
		</SectionCtx.Provider>
	)
}
