import { type ComponentProps, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Feedback } from "@/types"
import { edit, flush, remove } from "./state"

// [Agent] The one look of a note: section notes, card notes and text comments. `line` folds it to one line.
// data-cmt keeps it out of the text that comments anchor to, so showing a note never shifts an anchor.
export function Comment({
	text,
	line,
	className,
	...props
}: { text: string; line?: boolean } & ComponentProps<"div">) {
	return (
		<div
			data-cmt
			title={line ? text : undefined}
			className={cn(
				"rounded-md border-l-2 border-amber-400/80 bg-amber-400/10 px-2 py-1 text-sm text-foreground",
				line ? "truncate" : "whitespace-pre-wrap",
				className,
			)}
			{...props}
		>
			💬 {text}
		</div>
	)
}

type Props = {
	id?: string
	entry: Feedback
	detached?: boolean
	onSave: (note: string) => void
	onClose?: () => void
}

// [Agent] One body for a new comment (no id yet: Save creates it) and a saved one (edit in place, resolve,
// delete). The frame around it is the caller's: a Popover on the page, a Card when detached.
export function CommentCard({ id, entry, detached, onSave, onClose }: Props) {
	const [editing, setEditing] = useState(!entry.note)
	const [text, setText] = useState(entry.note ?? "")

	function save() {
		if (!text.trim()) return
		onSave(text.trim())
		setEditing(false)
	}

	return (
		<div data-cmt className="flex flex-col gap-2 text-sm">
			<div className="line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
				{detached && (
					<Badge variant="ask" className="mr-1" title="This text is no longer on the page">
						detached
					</Badge>
				)}
				{entry.quote}
			</div>
			{editing ? (
				<Textarea
					rows={3}
					autoFocus
					placeholder="Comment…"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && save()}
				/>
			) : (
				<Comment text={entry.note!} />
			)}
			<div className="flex flex-wrap items-center gap-1">
				<Button size="xs" onClick={editing ? save : () => setEditing(true)}>
					{editing ? "Save" : "Edit"}
				</Button>
				{id && (
					<>
						<Button
							size="xs"
							onClick={() => {
								edit(id, { resolved: true })
								flush()
							}}
						>
							✓ Resolve
						</Button>
						<Button size="xs" onClick={() => remove(id)}>
							Delete
						</Button>
					</>
				)}
				{onClose && (
					<Button size="xs" className="ml-auto" onClick={onClose}>
						{id ? "Close" : "Cancel"}
					</Button>
				)}
			</div>
			{entry.updatedAt && (
				<div className="text-[11px] text-muted-foreground">{new Date(entry.updatedAt).toLocaleString()}</div>
			)}
		</div>
	)
}
