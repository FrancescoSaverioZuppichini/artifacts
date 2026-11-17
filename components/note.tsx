import { useContext } from "react"
import { Textarea } from "@/components/ui/textarea"
import { edit, registry, SectionCtx, useReview } from "@/shell/state"

type NoteProps = { id: string; placeholder?: string; onSubmit?: () => void }

export function Note({ id, placeholder = "Note…", onSubmit }: NoteProps) {
	const note = useReview(id)?.note
	const section = useContext(SectionCtx)
	if (!registry.has(id)) {
		registry.set(id, {
			id,
			src: "",
			kind: "note",
			section: section?.id,
			sectionTitle: section?.title,
			title: placeholder,
		})
	}
	return (
		<Textarea
			data-note={id}
			className="not-prose mt-5 min-h-14 bg-muted"
			rows={2}
			placeholder={placeholder}
			value={note ?? ""}
			onChange={(e) => edit(id, { note: e.target.value })}
			onKeyDown={(e) => {
				if (!onSubmit || e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
				e.preventDefault()
				onSubmit()
			}}
		/>
	)
}
