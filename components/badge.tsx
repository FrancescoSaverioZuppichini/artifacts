const TONES: Record<string, string> = { "✅": "badge-ok", "❌": "badge-bad", "★": "badge-star", "❓": "badge-ask" };
// [Agent] A badge that starts with ✅ ❌ ★ or ❓ is a status: coloured, and shown next to titles and in the TOC. Any other text is a plain chip.
export const tone = (text: string) => TONES[[...text][0]];

export function Badge({ children }: { children: string }) {
	return <span className={tone(children) ? `badge ${tone(children)}` : "chip"}>{children}</span>;
}

export function Badges({ list = [], status }: { list?: string[]; status: boolean }) {
	return <>{list.filter((b) => !!tone(b) === status).map((b) => <Badge key={b}>{b}</Badge>)}</>;
}
