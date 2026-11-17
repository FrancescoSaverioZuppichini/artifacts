export type Probe = { v: string; video: boolean; w: number; h: number; dur?: number; codec?: string };
export type Item = { id?: string; src: string; title?: string; mark?: string; verdict?: string; time?: string; meta?: Record<string, string>; compare?: string };
export type Prompt = { src?: string; text?: string; title?: string };
export type Step = { id: string; title: string; when?: string; mark?: string; tags?: string[]; open?: boolean; text?: string; inputs?: Item[]; prompt?: Prompt | Prompt[]; results?: Item[] };
export type Review = { vote?: "up" | "down" | null; note?: string; updatedAt?: string; kind?: string; step?: string; stepTitle?: string; title?: string; src?: string };
