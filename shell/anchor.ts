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

// [Agent] A selection boundary can sit on an element (triple click) or inside a skipped node, so count the
// kept text that lies before it.
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

export function quoteOf(scope: Element, range: Range): Quote | null {
	const { nodes, full } = texts(scope)
	let start = offset(nodes, range.startContainer, range.startOffset)
	let end = offset(nodes, range.endContainer, range.endOffset)
	while (start < end && /\s/.test(full[start])) start++
	while (end > start && /\s/.test(full[end - 1])) end--
	if (start >= end) return null
	return {
		quote: full.slice(start, end),
		prefix: full.slice(Math.max(0, start - CONTEXT), start),
		suffix: full.slice(end, end + CONTEXT),
	}
}

// [Agent] How many characters around position `at` match the saved prefix and suffix.
function closeness(full: string, at: number, entry: Feedback) {
	const quote = entry.quote!
	const prefix = entry.prefix ?? ""
	const suffix = entry.suffix ?? ""
	let before = 0
	let after = 0
	while (before < prefix.length && full[at - 1 - before] === prefix[prefix.length - 1 - before]) before++
	while (after < suffix.length && full[at + quote.length + after] === suffix[after]) after++
	return before + after
}

// [Agent] Text-quote anchoring: the quote must still be there word for word; when it appears more than once,
// the occurrence whose surroundings match the saved prefix and suffix best wins. So a re-render or an edit
// around the quote keeps the comment in place.
export function anchor(scope: Element, entry: Feedback) {
	const { nodes, full } = texts(scope)
	const quote = entry.quote!
	let best = -1
	let bestScore = -1
	for (let i = full.indexOf(quote); i >= 0; i = full.indexOf(quote, i + 1)) {
		const score = closeness(full, i, entry)
		if (score > bestScore) {
			bestScore = score
			best = i
		}
	}
	if (best < 0) return

	const range = document.createRange()
	let total = 0
	let started = false
	for (const node of nodes) {
		const end = total + node.length
		// [Agent] A start on a node boundary belongs to the next node, or the range would also cover whatever
		// skipped text sits between.
		if (!started && best < end) {
			range.setStart(node, best - total)
			started = true
		}
		if (started && best + quote.length <= end) {
			range.setEnd(node, best + quote.length - total)
			return range
		}
		total = end
	}
}
