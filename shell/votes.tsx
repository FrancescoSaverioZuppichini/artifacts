import { edit, useReview } from "./state";

export function Votes({ id }: { id: string }) {
	const r = useReview(id);
	const vote = (v: "up" | "down") => (e: React.MouseEvent) => { e.stopPropagation(); edit(id, { vote: r?.vote === v ? null : v }); };
	return <>
		<button className="btn vote" data-vote="up" aria-pressed={r?.vote === "up"} onClick={vote("up")}>👍</button>
		<button className="btn vote" data-vote="down" aria-pressed={r?.vote === "down"} onClick={vote("down")}>👎</button>
	</>;
}
