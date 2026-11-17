import { marked } from "marked";
import { useMemo } from "react";

// [Agent] Prose for page.json, where MDX is not parsed. In page.mdx plain Markdown does the same job.
export function Markdown({ text }: { text: string }) {
	const html = useMemo(() => marked.parse(text, { async: false }) as string, [text]);
	return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
