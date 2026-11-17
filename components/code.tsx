import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { fileUrl, PageCtx } from "../shell/state";

// [Agent] Verbatim text (a file, a string or a fenced block), folded to a few lines; click opens it, Copy takes all of it.
export function Code({ src, text, title, children }: { src?: string; text?: string; title?: string; children?: ReactNode }) {
	const { media } = useContext(PageCtx), box = useRef<HTMLDivElement>(null);
	const [loaded, setLoaded] = useState(""), [copied, setCopied] = useState(false), v = src ? media[src]?.v : "";
	useEffect(() => {
		if (src) fetch(fileUrl(src)).then((r) => (r.ok ? r.text() : `⏳ not there yet: ${src}`)).then(setLoaded);
	}, [src, v]);
	const copy = () => {
		navigator.clipboard.writeText(box.current?.querySelector("pre")?.textContent ?? "");
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};
	const value = src ? loaded : text;
	return <div className="code not-prose mt-5" ref={box}>
		<div className="flex items-center gap-2">{title && <h4 className="label m-0">{title}</h4>}<button className="btn ml-auto" onClick={copy}>{copied ? "Copied" : "Copy"}</button></div>
		{value !== undefined ? <pre>{value}</pre> : children}
	</div>;
}
