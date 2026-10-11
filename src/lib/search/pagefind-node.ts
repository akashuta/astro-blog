import type { Locale } from "~/i18n";
import { publicContent } from "~/lib/public-content/server";

export interface NodeSearchHit {
  readonly url: string;
  readonly title: string;
  readonly excerpt: string;
}

/**
 * SSR-side search for `/search.astro`. The browser-targeted Pagefind bundle
 * at `dist/client/pagefind/pagefind.js` cannot run cleanly in Node (it uses
 * `import.meta.url`, `fetch` against relative `/pagefind/` paths, and the
 * browser `WebAssembly.instantiateStreaming` shape). Rather than re-implement
 * a Node binding, we adapt the shared public article read model, which searches
 * the current localized collection and supplements the Postgres FTS index when
 * file-backed articles have missing or stale vectors.
 *
 * Trade-offs vs. the browser Pagefind path:
 *   + Same visibility and search rules as the public article tools.
 *   + Works with `astro dev` (no `dist/` required).
 *   + Works without a database index in a production preview.
 *   - Excerpts come from frontmatter `description`, not contextual matches.
 *   + Drafts, hidden, future-dated and removed posts are excluded.
 *
 * The interactive ⌘K palette still uses the Pagefind WASM bundle in the
 * browser, so JS-enabled visitors get rich excerpts. `/search` is the no-JS
 * fallback per the plan.
 *
 * `locale` selects the public read model's language; its canonical URL already
 * carries the correct locale prefix, so this adapter only makes it relative.
 */
export const searchNode = async (
  query: string,
  locale: Locale = "ru",
): Promise<readonly NodeSearchHit[]> => {
  const normalizedQuery = query.trim();
  // URL input is untrusted; the shared search contract accepts at most 200 characters.
  if (normalizedQuery.length === 0 || normalizedQuery.length > 200) return [];
  const result = await publicContent.search({
    query: normalizedQuery,
    language: locale,
    limit: 20,
  });
  return result.articles.map((article) => ({
    url: new URL(article.canonicalUrl).pathname,
    title: article.title,
    excerpt: article.description,
  }));
};
