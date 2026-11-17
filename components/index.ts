import { Badge } from "./badge";
import { Code } from "./code";
import { Gallery } from "./gallery";
import { Markdown } from "./markdown";
import { Media } from "./media";
import { Note } from "./note";
import { Section } from "./section";

// [Agent] The one registry: every name here is a tag in page.mdx and a block `type` in page.json.
export const components = { Badge, Code, Gallery, Markdown, Media, Note, Section };
