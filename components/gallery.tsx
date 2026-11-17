import type { ReactNode } from "react"
import type { MediaProps } from "@/types"
import { Media } from "./media"

type GalleryProps = { title?: string; items?: MediaProps[]; children?: ReactNode }

export function Gallery({ title, items, children }: GalleryProps) {
	return (
		<section className="not-prose mt-5">
			{title && <h4 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h4>}
			<div className="flex flex-wrap items-stretch gap-3">
				{items?.map((item) => (
					<Media key={item.id ?? item.src} {...item} />
				))}
				{children}
			</div>
		</section>
	)
}
