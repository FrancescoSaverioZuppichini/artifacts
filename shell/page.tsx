import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import * as runtime from "react/jsx-runtime"
import { ErrorBoundary } from "react-error-boundary"
import { components } from "@/components"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Feedback, PageJson, Probe } from "@/types"
import { Comments } from "./comments"
import { SideBySide } from "./side-by-side"
import { load, path, picks, registry, saves, setOpen, useStore } from "./state"
import { jump, openAround, sections, Toc } from "./toc"
import { Viewer } from "./viewer"

type PageData = {
	title: string
	description: string
	order: string
	code: string
	data: PageJson
	media: Record<string, Probe | null>
	errors: string[]
}
type Content = React.ComponentType<{ components: typeof components; data: PageJson }>

const layout = [
	"mx-auto grid w-full max-w-[1600px] p-4 pt-8 xl:p-6 xl:pt-10",
	"md:grid-cols-[270px_minmax(0,1100px)] md:justify-center md:gap-8",
].join(" ")
const drawer =
	"inset-y-0 right-0 left-auto flex h-full w-80 max-w-[85vw] translate-x-0 translate-y-0 flex-col p-5"
const prose = [
	"prose prose-sm max-w-none prose-invert sm:prose-base",
	"prose-code:before:content-none prose-code:after:content-none",
].join(" ")
const seen = new Set<string>()
let first = true

function Banner({ errors }: { errors: string[] }) {
	return (
		<div className="not-prose my-4 rounded-md border border-red-500/60 bg-red-950/60 p-3 text-sm">
			<b>This page has a problem; the last good version is shown.</b>
			<ul className="mt-1 list-disc pl-5 font-mono text-xs whitespace-pre-wrap">
				{errors.map((error) => (
					<li key={error}>{error}</li>
				))}
			</ul>
		</div>
	)
}

// [Agent] Sections open once, the first time they appear: those marked `open` and the newest two dated ones
// (by page order; `order: newest-first` flips it). After that the reader's folding is never touched.
function openNew(order: string) {
	const all = sections().map((el) => registry.get(el.id)!)
	const dated = all.filter((s) => s.date)
	const newest = order === "newest-first" ? dated.slice(0, 2) : dated.slice(-2)
	const fresh = all.filter((s) => !seen.has(s.id))
	for (const s of fresh) seen.add(s.id)
	setOpen(
		fresh.filter((s) => s.open || newest.includes(s)).map((s) => s.id),
		true,
	)
}

function jumpToLink() {
	for (const id of picks) {
		const card = document.getElementById(id)
		if (card) openAround(card)
	}
	const target =
		new URLSearchParams(location.search).get("section") ||
		decodeURIComponent(location.hash.slice(1)) ||
		[...picks].find((id) => document.getElementById(id))
	if (target) jump(target)
}

export function Page() {
	const [data, setData] = useState<PageData>()
	const [error, setError] = useState<string>()
	const [contents, setContents] = useState(false)
	const Content = useMemo(() => data && (new Function(data.code)(runtime).default as Content), [data?.code])

	// [Agent] The server sends an ETag with no-cache, so the browser revalidates every poll and the server
	// answers an empty 304 unless something changed; the same ETag means nothing to do. Hidden tabs skip.
	useEffect(() => {
		let etag: string | null = null
		let shown = ""
		const poll = async () => {
			if (document.hidden && etag) return
			try {
				const savesAtSend = saves
				const res = await fetch(`/api/page?path=${encodeURIComponent(path)}`)
				if (!res.ok) throw Error((await res.json()).error)
				if (res.headers.get("etag") === etag) return
				const { feedback, ...next }: PageData & { feedback: Record<string, Feedback> } = await res.json()
				if (!load(feedback, savesAtSend)) return
				etag = res.headers.get("etag")
				// [Agent] A note saved anywhere changes the payload; re-render the page only if the page itself did.
				if (JSON.stringify(next) === shown) return
				shown = JSON.stringify(next)
				useStore.setState({ media: next.media })
				setData(next)
			} catch (e) {
				useStore.setState({ status: (e as Error).message })
				setError((e as Error).message)
			}
		}
		const onHash = () => jump(decodeURIComponent(location.hash.slice(1)))
		poll()
		const timer = setInterval(poll, 5000)
		document.addEventListener("visibilitychange", poll)
		addEventListener("hashchange", onHash)
		return () => {
			clearInterval(timer)
			document.removeEventListener("visibilitychange", poll)
			removeEventListener("hashchange", onHash)
		}
	}, [])

	useLayoutEffect(() => {
		if (!data) return
		document.title = data.title
		openNew(data.order)
		if (first) jumpToLink()
		first = false
	}, [data])

	// [Agent] A wrong path must say so, not spin: the poll's 404 lands here before any data exists.
	if (!data || !Content) {
		return (
			<p className="p-8 text-muted-foreground">
				{error ? `${error}. ` : `Loading ${path}…`}
				{error && (
					<a className="underline" href="/">
						All pages
					</a>
				)}
			</p>
		)
	}

	return (
		<>
			<div className={layout}>
				<aside className="sticky top-6 hidden h-[calc(100vh-3rem)] md:flex">
					<Toc data={data} />
				</aside>
				<article className="min-w-0">
					<header className="mb-6">
						<h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{data.title}</h1>
						{data.description && <p className="mt-3 text-lg text-muted-foreground">{data.description}</p>}
					</header>
					{data.errors.length > 0 && <Banner errors={data.errors} />}
					<div className={prose}>
						{/* [Agent] A component that throws would blank the page; show the error, retry on new data. */}
						<ErrorBoundary
							resetKeys={[data]}
							fallbackRender={({ error }) => (
								<Banner errors={[`page.mdx failed to render: ${(error as Error).message}`]} />
							)}
						>
							<Content components={components} data={data.data} />
						</ErrorBoundary>
					</div>
					<div data-comments="" />
				</article>
			</div>
			<Button
				size="icon-lg"
				className="fixed right-5 bottom-5 z-40 md:hidden"
				aria-label="Open contents"
				onClick={() => setContents(true)}
			>
				☰
			</Button>
			<Dialog open={contents} onOpenChange={setContents}>
				<DialogContent className={drawer}>
					<DialogTitle className="sr-only">Contents</DialogTitle>
					<Toc data={data} onPick={() => setContents(false)} />
				</DialogContent>
			</Dialog>
			<Viewer />
			<Comments />
			<SideBySide />
		</>
	)
}
