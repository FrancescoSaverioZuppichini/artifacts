import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import { createRoot } from "react-dom/client"
import { Home } from "@/shell/home"
import { Page } from "@/shell/page"
import { page } from "@/shell/state"

// [Agent] The click that ends a drag-selection must not open a card, fold a section or fold a code block: the
// reader wanted the text (to copy it or to comment on it).
document.addEventListener(
	"click",
	(e) => {
		const selection = getSelection()
		if (selection && !selection.isCollapsed && selection.containsNode(e.target as Node, true)) {
			e.stopPropagation()
			e.preventDefault()
		}
	},
	true,
)

// [Agent] Code blocks are folded by the `.prose pre` rule in styles.css; a click toggles them open.
document.addEventListener("click", (e) => {
	;(e.target as HTMLElement).closest(".prose pre")?.classList.toggle("open")
})

createRoot(document.getElementById("root")!).render(page ? <Page /> : <Home />)
