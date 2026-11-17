import { useContext } from "react";
import { edit, registry, SectionCtx, useReview } from "../shell/state";

export function Note({ id, placeholder = "Note…", onSubmit }: { id: string; placeholder?: string; onSubmit?: () => void }) {
	const r = useReview(id), section = useContext(SectionCtx);
	if (!registry.has(id)) registry.set(id, { id, src: "", kind: "note", section: section?.id, sectionTitle: section?.title, title: placeholder });
	return <textarea className="note not-prose" rows={2} placeholder={placeholder} value={r?.note ?? ""} onChange={(e) => edit(id, { note: e.target.value })}
		onKeyDown={(e) => { if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} />;
}
