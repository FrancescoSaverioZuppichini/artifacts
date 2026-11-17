import type { ReactNode } from "react";
import type { MediaProps } from "../types";
import { Media } from "./media";

export function Gallery({ title, items, children }: { title?: string; items?: MediaProps[]; children?: ReactNode }) {
	return <section className="not-prose mt-5">
		{title && <h4 className="label">{title}</h4>}
		<div className="flex flex-wrap items-stretch gap-3">{items?.map((it) => <Media key={it.id ?? it.src} {...it} />)}{children}</div>
	</section>;
}
