import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

function ScrollArea({
	className,
	children,
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
	return (
		<ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
			<ScrollAreaPrimitive.Viewport
				data-slot="scroll-area-viewport"
				className="size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollAreaPrimitive.ScrollAreaScrollbar
				data-slot="scroll-area-scrollbar"
				orientation="vertical"
				className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px transition-colors select-none"
			>
				<ScrollAreaPrimitive.ScrollAreaThumb
					data-slot="scroll-area-thumb"
					className="relative flex-1 rounded-full bg-border"
				/>
			</ScrollAreaPrimitive.ScrollAreaScrollbar>
		</ScrollAreaPrimitive.Root>
	)
}

export { ScrollArea }
