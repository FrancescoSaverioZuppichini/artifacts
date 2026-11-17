import { type ReactNode, useContext, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { fileUrl, PageCtx } from "@/shell/state"

type CodeProps = { src?: string; text?: string; title?: string; children?: ReactNode }

// [Agent] Verbatim text (a file, a string or a fenced block). The `.prose pre` rule in styles.css folds it to
// a few lines and a click opens it; Copy always takes all of it.
export function Code({ src, text, title, children }: CodeProps) {
	const { media } = useContext(PageCtx)
	const box = useRef<HTMLDivElement>(null)
	const [loaded, setLoaded] = useState("")
	const [copied, setCopied] = useState(false)
	const version = src ? media[src]?.v : ""

	useEffect(() => {
		if (!src) return
		fetch(fileUrl(src))
			.then((res) => (res.ok ? res.text() : `⏳ not there yet: ${src}`))
			.then(setLoaded)
	}, [src, version])

	function copy() {
		navigator.clipboard.writeText(box.current?.querySelector("pre")?.textContent ?? "")
		setCopied(true)
		setTimeout(() => setCopied(false), 1200)
	}

	const value = src ? loaded : text
	return (
		<div ref={box} className="not-prose mt-5">
			<div className="flex items-center gap-2">
				{title && <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>}
				<Button variant="outline" size="xs" className="ml-auto" onClick={copy}>
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			{value === undefined ? (
				children
			) : (
				<pre className="mt-1 rounded-md border bg-muted p-3 font-mono text-[12.5px] leading-relaxed">
					{value}
				</pre>
			)}
		</div>
	)
}
