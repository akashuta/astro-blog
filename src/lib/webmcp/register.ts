import { z } from "zod";
import {
  contentInputs,
  meetingBookingLinkInput,
  type PublicLanguage,
} from "~/lib/public-content/contracts";
import { getMeetingBookingLink } from "./booking";

export interface WebMCPTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
    readonly consequentialHint: boolean;
  };
  readonly execute: (args: unknown, options?: { readonly signal?: AbortSignal }) => Promise<string>;
}
export interface ModelContext {
  readonly registerTool: (
    tool: WebMCPTool,
    options: { readonly signal: AbortSignal },
  ) => Promise<unknown>;
}
export type WebMCPDocument = Document & { readonly modelContext?: ModelContext };

const withLanguage = (args: unknown, language: PublicLanguage): unknown =>
  typeof args === "object" && args !== null && !Array.isArray(args) ? { language, ...args } : args;

const inputSchemaFor = (schema: z.ZodType, language: PublicLanguage): Record<string, unknown> => {
  const jsonSchema = z.toJSONSchema(schema, { io: "input" });
  return {
    ...jsonSchema,
    properties: {
      ...jsonSchema.properties,
      language: { type: "string", enum: ["ru", "en"], default: language },
    },
  };
};

const toolDefinitions = {
  search: {
    name: "search_articles",
    description:
      "Search public published artka.dev articles by query, language (ru/en) and tag slug. Empty query lists newest articles. Returns bounded metadata and canonical URLs; nextOffset paginates. searchMode identifies full-text or literal matching.",
  },
  read: {
    name: "read_article",
    description:
      "Read clean prose of a public published artka.dev article by bare slug and language. Returns canonical URL, author, dates, tags and a bounded text chunk. Code/markup are omitted; markdownUrl links to original examples. Use nextOffset for more text.",
  },
  topics: {
    name: "list_topics",
    description:
      "List topics actually covered by public published artka.dev articles, with localized labels, tag slugs, counts and canonical archive URLs. nextOffset paginates.",
  },
} as const;

export const createWebMCPTools = (
  language: PublicLanguage,
  fetcher: typeof fetch = fetch,
): readonly WebMCPTool[] => {
  const articles = (Object.keys(contentInputs) as (keyof typeof contentInputs)[]).map(
    (operation): WebMCPTool => {
      const schema = contentInputs[operation];
      return {
        ...toolDefinitions[operation],
        inputSchema: inputSchemaFor(schema, language),
        annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
        execute: async (args, options) => {
          const input = schema.parse(withLanguage(args, language));
          options?.signal?.throwIfAborted();
          const query = new URLSearchParams(
            Object.entries(input).map(([key, value]) => [key, String(value)]),
          );
          const response = await fetcher(`/api/public/articles/${operation}/?${query}`, {
            credentials: "omit",
            signal: options?.signal ?? null,
          });
          if (!response.ok) {
            return JSON.stringify({
              error:
                response.status === 404
                  ? "article_not_found"
                  : response.status === 400
                    ? "invalid_arguments"
                    : "content_unavailable",
            });
          }
          return JSON.stringify(await response.json());
        },
      };
    },
  );
  return [
    ...articles,
    {
      name: "get_meeting_booking_link",
      description:
        "Get Artyom Kashuta's public Cal.com booking link and localized artka.dev booking page. Returns links only: no availability lookup, no slot reservation and no meeting is created. The visitor chooses a time and confirms in the scheduler.",
      inputSchema: inputSchemaFor(meetingBookingLinkInput, language),
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
      execute: async (args, options) => {
        options?.signal?.throwIfAborted();
        return JSON.stringify(getMeetingBookingLink(withLanguage(args, language)));
      },
    },
  ];
};

/** Abort owns only our registrations. No clear-all operation or cross-origin exposure. */
export const registerWebMCPTools = async (
  doc: WebMCPDocument,
  controller: AbortController,
): Promise<void> => {
  if (typeof doc.modelContext?.registerTool !== "function") return;
  const language = doc.documentElement.lang === "en" ? "en" : "ru";
  try {
    for (const tool of createWebMCPTools(language)) {
      if (controller.signal.aborted) return;
      await doc.modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    console.warn("[webmcp] Tool registration unavailable", error);
  }
};
