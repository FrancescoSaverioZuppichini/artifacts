import { Badge as Chip } from "@/components/ui/badge"

const TONES = { "✅": "ok", "❌": "bad", "★": "star", "❓": "ask" } as const

// [Agent] A badge that starts with ✅ ❌ ★ or ❓ is a status: coloured, and shown next to titles and in the
// contents. Any other text is a plain chip.
export const tone = (text: string) => TONES[[...text][0] as keyof typeof TONES]

export function Badge({ children }: { children: string }) {
	return <Chip variant={tone(children)}>{children}</Chip>
}

// [Agent] Status badges go next to a title, plain ones on their own row, so a list is drawn in two calls.
export function Badges({ list = [], status }: { list?: string[]; status: boolean }) {
	return list.filter((text) => !!tone(text) === status).map((text) => <Badge key={text}>{text}</Badge>)
}
