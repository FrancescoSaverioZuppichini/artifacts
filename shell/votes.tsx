import { Button } from "@/components/ui/button"
import { edit, useReview } from "./state"

const VOTES = [
	{ value: "up", label: "👍", pressed: "border border-green-600 bg-green-950 hover:bg-green-950" },
	{ value: "down", label: "👎", pressed: "border border-red-500 bg-red-950 hover:bg-red-950" },
] as const

export function Votes({ id }: { id: string }) {
	const vote = useReview(id)?.vote
	return VOTES.map(({ value, label, pressed }) => (
		<Button
			key={value}
			size="xs"
			variant={vote === value ? "secondary" : "outline"}
			className={vote === value ? pressed : undefined}
			aria-pressed={vote === value}
			onClick={(e) => {
				e.stopPropagation()
				edit(id, { vote: vote === value ? null : value })
			}}
		>
			{label}
		</Button>
	))
}
