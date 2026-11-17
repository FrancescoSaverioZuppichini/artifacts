import { format, formatDistanceToNow } from "date-fns"

// [Agent] Every date the app shows: relative, with the exact time on hover.
export function Time({ at }: { at: string | number }) {
	return (
		<time dateTime={new Date(at).toISOString()} title={format(at, "PPpp")}>
			{formatDistanceToNow(at, { addSuffix: true })}
		</time>
	)
}
