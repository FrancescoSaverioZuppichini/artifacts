// [Agent] The page.json schema. A block is any component from components/index.ts by name plus its props, so a custom component is
// usable from page.json the moment it is registered.
export type Block = { type: string; [prop: string]: unknown };
export type SectionProps = { id: string; title: string; date?: string; badges?: string[]; open?: boolean; blocks?: Block[] };
export type MediaProps = { id?: string; src: string; title?: string; caption?: string; badges?: string[]; compare?: string };
export type PageJson = { sections?: SectionProps[] };

export type Probe = { v: string; video: boolean; w: number; h: number; dur?: number; codec?: string };
// [Agent] One entry per card, section, note or text comment id in feedback.json. A comment anchors by quote plus the text around it.
// Entries from older versions may also carry step, stepTitle, set and section (then a title); they are kept as they are.
export type Feedback = {
	vote?: "up" | "down" | null; note?: string; updatedAt?: string; kind?: "media" | "section" | "note" | "comment"; section?: string; sectionTitle?: string;
	title?: string; src?: string; quote?: string; prefix?: string; suffix?: string; resolved?: boolean;
};
