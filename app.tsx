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
// [Agent] Selecting text to copy it out of a folded block must not collapse the block.
document.addEventListener("click", (e) => {
	const pre = (e.target as HTMLElement).closest<HTMLElement>(".prose pre, pre.fold, .fold-wrap pre");
	if (pre && getSelection()?.isCollapsed) pre.classList.toggle("open");
});

createRoot(document.getElementById("root")!).render(page ? <Page /> : <Home />);
