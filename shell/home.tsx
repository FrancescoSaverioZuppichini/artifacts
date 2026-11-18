import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Time } from "./time"

type Listed = {
	path: string
	title: string
	description: string
	updated: number
	waiting: number
	notes: number
}

export function Home() {
	const [list, setList] = useState<Listed[]>()

	useEffect(() => {
		fetch("/api/pages")
			.then((res) => res.json())
			.then(setList)
	}, [])

	return (
		<main className="mx-auto max-w-3xl p-6 pt-12">
			<h1 className="text-3xl font-semibold tracking-tight">artifacts</h1>
			<ul className="mt-6 divide-y">
				{list?.map((p) => (
					<li key={p.path} className="py-4">
						<a href={`/?path=${encodeURIComponent(p.path)}`} className="text-lg font-medium hover:underline">
							{p.title}
						</a>
						<p className="text-sm text-muted-foreground">{p.description}</p>
						<div className="mt-1 flex flex-wrap gap-1.5">
							<Badge className="max-w-full" title={p.path}>
								<span className="truncate">{p.path}</span>
							</Badge>
							<Badge>
								updated <Time at={p.updated} />
							</Badge>
							{p.waiting > 0 && <Badge variant="ask">❓ {p.waiting} waiting</Badge>}
							{p.notes > 0 && <Badge>💬 {p.notes}</Badge>}
						</div>
					</li>
				))}
			</ul>
			{list?.length === 0 && <p className="text-muted-foreground">No page opened yet: /?path=…/page.mdx</p>}
		</main>
	)
}
