import type { CollectionEntry } from "astro:content";
import { extractArticleBody } from "~/lib/seo/article-body";
import { getTagDict, resolveTagLabel } from "~/lib/content/tags";
import { postUrl, postMarkdownUrl } from "~/lib/agents/llms";
import { canonicalUrl } from "~/lib/seo/url-policy";
import { isGonePath } from "~/lib/seo/gone";
import {
  searchArticlesInput,
  readArticleInput,
  listTopicsInput,
  type ArticleMetadata,
  type PublicLanguage,
} from "./contracts";

export interface PublicContentDependencies {
  readonly listPosts: (language: PublicLanguage) => Promise<readonly CollectionEntry<"posts">[]>;
  /** null means metadata is unconfigured; a configured but unavailable DB must reject. */
  readonly hiddenSlugs: () => Promise<ReadonlySet<string> | null>;
  readonly searchSlugs: (
    query: string,
    language: PublicLanguage,
    slugs: readonly string[],
  ) => Promise<readonly string[] | null>;
  readonly now?: () => number;
}

const bareSlug = (id: string): string => id.replace(/^en\//, "");
const flatten = (text: string, max: number): string =>
  text.replace(/\s+/g, " ").trim().slice(0, max);
const metadata = (post: CollectionEntry<"posts">, language: PublicLanguage): ArticleMetadata => ({
  slug: bareSlug(post.id),
  language,
  title: flatten(post.data.title, 200),
  description: flatten(post.data.description, 500),
  author: flatten(post.data.author, 200),
  published: post.data.pubDate.toISOString().slice(0, 10),
  updated: post.data.updatedDate?.toISOString().slice(0, 10) ?? null,
  tags: post.data.tags.slice(0, 20).map((tag: string) => flatten(tag, 160)),
  canonicalUrl: postUrl(language, bareSlug(post.id)),
  markdownUrl: postMarkdownUrl(language, bareSlug(post.id)),
});
const textOf = (post: CollectionEntry<"posts">): string =>
  extractArticleBody(post.body ?? "", Number.POSITIVE_INFINITY).text;

/** Shared public read model. No browser, transport, auth or publishing state in its API. */
export const createPublicContentAccess = (deps: PublicContentDependencies) => {
  const load = async (language: PublicLanguage) => {
    const [posts, hidden] = await Promise.all([deps.listPosts(language), deps.hiddenSlugs()]);
    const now = deps.now?.() ?? Date.now();
    return posts
      .filter(
        (post) =>
          !post.data.draft &&
          post.data.pubDate.getTime() <= now &&
          (language === "en" ? post.id.startsWith("en/") : !post.id.startsWith("en/")) &&
          !hidden?.has(bareSlug(post.id)) &&
          !isGonePath(new URL(postUrl(language, bareSlug(post.id))).pathname),
      )
      .sort(
        (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id),
      );
  };

  const search = async (args: unknown) => {
    const input = searchArticlesInput.parse(args);
    const posts = (await load(input.language)).filter(
      (post) => !input.tag || post.data.tags.includes(input.tag),
    );
    const ranked = input.query
      ? await deps.searchSlugs(
          input.query,
          input.language,
          posts.map((post) => bareSlug(post.id)),
        )
      : null;
    // File-backed vectors can be absent or lag behind current prose. Keep ranked hits
    // first, then supplement from the same published/visible candidate set.
    const rankedPosts = [...new Set(ranked ?? [])].flatMap((slug) => {
      const post = posts.find((post) => bareSlug(post.id) === slug);
      return post ? [post] : [];
    });
    const rankedIds = new Set(rankedPosts.map((post) => post.id));
    const terms = input.query.toLocaleLowerCase(input.language).split(/\s+/).filter(Boolean);
    const literalPosts = posts.filter((post) => {
      if (rankedIds.has(post.id)) return false;
      const text =
        `${post.data.title} ${post.data.description} ${post.data.tags.join(" ")} ${textOf(post)}`.toLocaleLowerCase(
          input.language,
        );
      return terms.every((term) => text.includes(term));
    });
    const matches = [...rankedPosts, ...literalPosts];
    const selected = matches.slice(input.offset, input.offset + input.limit);
    return {
      language: input.language,
      searchMode: !input.query
        ? "latest"
        : rankedPosts.length === 0
          ? "literal"
          : literalPosts.length > 0
            ? "full_text_with_literal_fallback"
            : "full_text",
      total: matches.length,
      articles: selected.map((post) => metadata(post, input.language)),
      nextOffset:
        input.offset + selected.length < matches.length ? input.offset + selected.length : null,
    };
  };

  const read = async (args: unknown) => {
    const input = readArticleInput.parse(args);
    const post = (await load(input.language)).find((post) => bareSlug(post.id) === input.slug);
    if (!post) return null;
    const text = textOf(post);
    const chunk = text.slice(input.offset, input.offset + input.maxChars);
    return {
      ...metadata(post, input.language),
      text: chunk,
      format: "plain_text_prose",
      totalChars: text.length,
      offset: input.offset,
      truncated: input.offset > 0 || chunk.length < text.length,
      nextOffset: input.offset + chunk.length < text.length ? input.offset + chunk.length : null,
    };
  };

  const topics = async (args: unknown) => {
    const input = listTopicsInput.parse(args);
    const posts = await load(input.language);
    const dict = getTagDict(input.language);
    const tags = [...new Set(posts.flatMap((post) => post.data.tags))].sort();
    const selected = tags.slice(input.offset, input.offset + input.limit);
    return {
      language: input.language,
      total: tags.length,
      topics: selected.map((tag) => ({
        tag: flatten(tag, 160),
        label: flatten(resolveTagLabel(tag, input.language, dict), 200),
        count: posts.filter((post) => post.data.tags.includes(tag)).length,
        canonicalUrl: canonicalUrl(`${input.language === "en" ? "/en" : ""}/tags/${tag}/`),
      })),
      nextOffset:
        input.offset + selected.length < tags.length ? input.offset + selected.length : null,
    };
  };

  return { search, read, topics };
};
