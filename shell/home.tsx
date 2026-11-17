import { useEffect, useState } from "react";

type Listed = { name: string; title: string; description: string; updated: number; waiting: number; notes: number };

export function Home() {
	const [list, setList] = useState<Listed[]>();
	useEffect(() => { fetch("/api/pages").then((r) => r.json()).then(setList); }, []);
	return <main className="mx-auto max-w-3xl p-6 pt-12">
		<h1 className="text-3xl font-semibold tracking-tight">artifacts</h1>
		<ul className="mt-6 divide-y">{list?.map((p) => <li key={p.name} className="py-4">
			<a href={`/${encodeURIComponent(p.name)}`} className="text-lg font-medium hover:underline">{p.title}</a>
			<p className="text-sm text-muted-foreground">{p.description}</p>
			<div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
				<span className="chip">/{p.name}</span><span className="chip">updated {new Date(p.updated).toLocaleString()}</span>
				{p.waiting > 0 && <span className="badge badge-ask">❓ {p.waiting} waiting</span>}
				{p.notes > 0 && <span className="chip">💬 {p.notes}</span>}
			</div>
		</li>)}</ul>
		{list?.length === 0 && <p className="text-muted-foreground">No page.mdx found under the roots.</p>}
	</main>;
}
