import type { Feedback } from "@/types"

export type Quote = { quote: string; prefix: string; suffix: string }

const CONTEXT = 30
export const SKIP = "textarea, input, button, [data-cmt]"

// [Agent] The text a comment can anchor to: every text node of a section except form controls and the comment
// UI itself, so a detached card or a note being typed never shifts the offsets.
function texts(scope: Element) {
	const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	})
	const nodes: Text[] = []
	while (walk.nextNode()) nodes.push(walk.currentNode as Text)
	return { nodes, full: nodes.map((node) => node.data).join("") }
}

// [Agent] A selection boundary can sit on an element (triple click) or inside a skipped node, so count the kept
// text that lies before it.
function offset(nodes: Text[], container: Node, at: number) {
	const point = document.createRange()
	point.setStart(container, at)
	let total = 0
	for (const node of nodes) {
		if (node === container) return total + at
		if (point.comparePoint(node, 0) >= 0) return total
		total += node.length
	}
	return total
}

// [Agent] The node and offset of a text position; a start on a node boundary belongs to the next node, or the
// range would also cover whatever skipped text sits between.
function locate(nodes: Text[], at: number, end: boolean): [Text, number] {
	let total = 0
	for (const node of nodes) {
		if (at < total + node.length || (end && at === total + node.length)) return [node, at - total]
		total += node.length
	}
	return [nodes.at(-1)!, nodes.at(-1)!.length]
}

export function quoteOf(scope: Element, range: Range): Quote | null {
	const { nodes, full } = texts(scope)
	let start = offset(nodes, range.startContainer, range.startOffset)
	let end = offset(nodes, range.endContainer, range.endOffset)
	while (start < end && /\s/.test(full[start])) start++
	while (end > start && /\s/.test(full[end - 1])) end--
	if (start >= end) return null
	const prefix = full.slice(Math.max(0, start - CONTEXT), start)
	return { quote: full.slice(start, end), prefix, suffix: full.slice(end, end + CONTEXT) }
}

// [Agent] Text-quote anchoring: the quote must still be there word for word; when it appears more than once,
// the occurrence whose surroundings match the saved prefix and suffix best wins.
export function anchor(scope: Element, { quote = "", prefix = "", suffix = "" }: Feedback) {
	const { nodes, full } = texts(scope)
	const score = (at: number) => {
		let before = 0
		let after = 0
		while (before < prefix.length && full[at - 1 - before] === prefix[prefix.length - 1 - before]) before++
		while (after < suffix.length && full[at + quote.length + after] === suffix[after]) after++
		return before + after
	}
	let best = -1
	for (let i = full.indexOf(quote); quote && i >= 0; i = full.indexOf(quote, i + 1)) {
		if (best < 0 || score(i) > score(best)) best = i
	}
	if (best < 0) return
	const range = document.createRange()
	range.setStart(...locate(nodes, best, false))
	range.setEnd(...locate(nodes, best + quote.length, true))
	return range
}
