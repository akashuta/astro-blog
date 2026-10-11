import { z } from "zod";

const language = z.enum(["ru", "en"]).default("ru");
const slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const page = {
  limit: z.number().int().min(1).max(20).default(8),
  offset: z.number().int().min(0).max(10_000).default(0),
};

export const searchArticlesInput = z.strictObject({
  query: z.string().trim().max(200).default(""),
  language,
  tag: slug.optional(),
  ...page,
});
export const readArticleInput = z.strictObject({
  slug,
  language,
  offset: z.number().int().min(0).max(1_000_000).default(0),
  maxChars: z.number().int().min(100).max(16_000).default(8_000),
});
export const listTopicsInput = z.strictObject({ language, ...page });
export const meetingBookingLinkInput = z.strictObject({ language });

export const contentInputs = {
  search: searchArticlesInput,
  read: readArticleInput,
  topics: listTopicsInput,
} as const;
export type ContentOperation = keyof typeof contentInputs;
export type PublicLanguage = z.infer<typeof language>;

export interface ArticleMetadata {
  readonly slug: string;
  readonly language: PublicLanguage;
  readonly title: string;
  readonly description: string;
  readonly author: string;
  readonly published: string;
  readonly updated: string | null;
  readonly tags: readonly string[];
  readonly canonicalUrl: string;
  readonly markdownUrl: string;
}
