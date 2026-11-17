import { Component, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import * as runtime from "react/jsx-runtime"
import { components } from "@/components"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { Feedback, PageJson, Probe } from "@/types"
import { Comments } from "./comments"
import { SideBySide } from "./side-by-side"
import { fail, load, PageCtx, page, params, picks, registry, type Show, savesDone, setOpen } from "./state"
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
	feedback: Record<string, Feedback>
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

// [Agent] A component that throws while rendering would blank the whole page; show the error instead and
// retry on the next data.
class Guard extends Component<{ children: ReactNode; data: unknown }, { error?: string }> {
	state: { error?: string } = {}
	static getDerivedStateFromError = (e: Error) => ({ error: e.message })
	componentDidUpdate(prev: { data: unknown }) {
		if (this.state.error && prev.data !== this.props.data) this.setState({ error: undefined })
	}
	render() {
		if (!this.state.error) return this.props.children
		return <Banner errors={[`page.mdx failed to render: ${this.state.error}`]} />
	}
}

// [Agent] Sections are opened once, the first time they appear: those marked `open` and the newest two dated
// ones (by page order; frontmatter `order: newest-first` flips it). After that the reader's folding is never
// touched, even when page.json is rewritten.
function openNew(order: string) {
	const all = sections()
	const dated = all.filter((s) => s.dataset.date)
	const newest = order === "newest-first" ? dated.slice(0, 2) : dated.slice(-2)
	for (const s of all.filter((s) => !seen.has(s.id))) {
		seen.add(s.id)
		if (s.dataset.open !== undefined || newest.includes(s)) setOpen(s.id, true)
	}
}

function jumpToLink() {
	for (const id of picks) {
		const card = document.getElementById(id)
		if (card) openAround(card)
	}
	const target = params.get("section") ?? decodeURIComponent(location.hash.slice(1))
	const pick = [...picks].find((id) => document.getElementById(id))
	if (target || pick) jump(target || pick!)
}

export function Page() {
	const [data, setData] = useState<PageData>()
	const [error, setError] = useState<string>()
	const [viewing, setViewing] = useState<string | null>(null)
	const [side, setSide] = useState<Show | null>(null)
	const [contents, setContents] = useState(false)
	const first = useRef(true)
	const Content = useMemo(
		() => (data?.code ? (new Function(data.code)({ ...runtime }).default as Content) : null),
		[data?.code],
	)

	// [Agent] One request every 5 s; the server answers 304 unless page.mdx, page.json, a media file or
	// feedback.json changed. Hidden tabs skip.
	useEffect(() => {
		let etag = ""
		const poll = async () => {
			if (document.hidden && etag) return
			try {
				const saves = savesDone()
				const headers: HeadersInit = etag ? { "If-None-Match": etag } : {}
				const res = await fetch(`/api/page/${encodeURIComponent(page)}`, { headers })
				if (res.status === 304) return
				if (!res.ok) throw Error((await res.json()).error)
				const next: PageData = await res.json()
				if (!load(next.feedback, saves)) return
				etag = res.headers.get("etag") ?? ""
				setData(next)
			} catch (e) {
				fail((e as Error).message)
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
		openNew(data.order)
		if (!first.current) return
		first.current = false
		document.title = data.title
		jumpToLink()
	}, [data])

	// [Agent] A wrong page name must say so, not spin: the poll's 404 lands here before any data exists.
	if (!data) {
		return (
			<p className="p-8 text-muted-foreground">
				{error ? `Page “${page}” not found (${error}). ` : `Loading ${page}…`}
				{error && (
					<a className="underline" href="/">
						All pages
					</a>
				)}
			</p>
		)
	}

	return (
		<PageCtx.Provider value={{ media: data.media, view: setViewing, sideBySide: setSide }}>
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
						<Guard key={data.code} data={data.data}>
							{Content && <Content components={components} data={data.data} />}
						</Guard>
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
			{viewing && registry.has(viewing) && <Viewer id={viewing} setId={setViewing} />}
			<Comments />
			{side && <SideBySide {...side} close={() => setSide(null)} />}
		</PageCtx.Provider>
	)
}
