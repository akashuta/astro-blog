import { listMarkdownPosts } from "~/lib/agents/documents";
import { listAllMeta, searchPostsMeta } from "~/lib/db/repo/posts-meta";
import { createPublicContentAccess } from "./access";

export const publicContent = createPublicContentAccess({
  listPosts: listMarkdownPosts,
  hiddenSlugs: async () =>
    process.env.DATABASE_URL
      ? new Set(
          (await listAllMeta()).filter((post) => post.hiddenFromList).map((post) => post.slug),
        )
      : null,
  searchSlugs: async (query, language, slugs) =>
    process.env.DATABASE_URL
      ? (await searchPostsMeta(query, slugs.length, language, slugs)).map((hit) => hit.slug)
      : null,
});
