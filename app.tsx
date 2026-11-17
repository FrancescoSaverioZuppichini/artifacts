import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { createRoot } from "react-dom/client";
import { Home } from "./shell/home";
import { Page } from "./shell/page";
import { page } from "./shell/state";

// [Agent] One video plays at a time: starting one pauses every other, except its companions on the same clock (viewer compare, side by side).
document.addEventListener("play", (e) => {
	const group = (e.target as HTMLElement).closest("dialog");
	document.querySelectorAll("video").forEach((v) => { if (v !== e.target && !v.paused && !group?.contains(v)) v.pause(); });
}, true);
// [Agent] The click that ends a drag-selection must not open a card, fold a section or fold a code block: the reader wanted the text
// (to copy it or to comment on it).
document.addEventListener("click", (e) => {
	const sel = getSelection();
	if (sel && !sel.isCollapsed && sel.containsNode(e.target as Node, true)) { e.stopPropagation(); e.preventDefault(); }
}, true);
document.addEventListener("click", (e) => (e.target as HTMLElement).closest(".prose pre, pre.fold, .fold-wrap pre")?.classList.toggle("open"));

createRoot(document.getElementById("root")!).render(page ? <Page /> : <Home />);
