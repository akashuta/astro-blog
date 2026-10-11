import type { CollectionEntry } from "astro:content";
import { describe, expect, it, vi } from "vitest";
import { createPublicContentAccess } from "~/lib/public-content/access";

const post = (
  id: string,
  data: Partial<CollectionEntry<"posts">["data"]> = {},
): CollectionEntry<"posts"> => ({
  id,
  collection: "posts",
  body: "# Main idea\n\nReadable **article** text.\n\n```js\nsecretCode()\n```\n\n<script>bad()</script>",
  data: {
    title: "Article about agents",
    description: "Public description",
    author: "Artyom Kashuta",
    pubDate: new Date("2026-01-01"),
    tags: ["ai"],
    draft: false,
    keywords: [],
    manuallyEdited: false,
    ...data,
  },
});
const fixture = () => {
  const posts = [
    post("one"),
    post("two", { tags: ["astro"], pubDate: new Date("2026-02-01") }),
    post("en/one", { title: "English agents" }),
    post("hidden", { tags: ["private"] }),
    post("draft", { draft: true }),
    post("future", { pubDate: new Date("2030-01-01") }),
    post("claude"),
  ];
  const searchSlugs = vi.fn().mockResolvedValue(null);
  const hiddenSlugs = vi.fn().mockResolvedValue(new Set(["hidden"]));
  const listPosts = vi.fn().mockResolvedValue(posts);
  return {
    searchSlugs,
    hiddenSlugs,
    listPosts,
    access: createPublicContentAccess({
      listPosts,
      searchSlugs,
      hiddenSlugs,
      now: () => new Date("2026-10-11").getTime(),
    }),
  };
};

describe("public content access", () => {
  it("shares published-only visibility across search, read and topics", async () => {
    const { access } = fixture();
    expect((await access.search({})).articles.map((article) => article.slug)).toEqual([
      "two",
      "one",
    ]);
    for (const slug of ["hidden", "draft", "future", "claude", "missing"])
      expect(await access.read({ slug })).toBeNull();
    expect((await access.topics({})).topics.map((topic) => topic.tag)).toEqual(["ai", "astro"]);
  });
  it("filters locale/tag before passing candidates to existing full-text search", async () => {
    const { access, searchSlugs } = fixture();
    searchSlugs.mockResolvedValue(["one", "hidden", "two"]);
    const result = await access.search({ query: "agent", language: "ru", tag: "ai" });
    expect(searchSlugs).toHaveBeenCalledWith("agent", "ru", ["one"]);
    expect(result.searchMode).toBe("full_text");
    expect(result.articles.map((article) => article.slug)).toEqual(["one"]);
  });
  it("returns EN metadata and text fallback when the EN vector has no matches", async () => {
    const { access, searchSlugs } = fixture();
    searchSlugs.mockResolvedValue([]);
    const result = await access.search({ query: "English agents", language: "en" });
    expect(result.searchMode).toBe("literal");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.canonicalUrl).toBe("https://artka.dev/en/blog/one/");
    expect(result.articles[0]?.markdownUrl).toBe("https://artka.dev/en/blog/one.md");
    expect((await access.search({ query: "English", language: "ru" })).articles).toEqual([]);
  });
  it("supplements incomplete nonempty search vectors from current prose without duplicates", async () => {
    const { access, listPosts, searchSlugs } = fixture();
    listPosts.mockResolvedValue([
      post("ranked", { title: "Database result" }),
      post("literal", { title: "Mermaid hardware" }),
      post("hidden", { title: "Mermaid hardware" }),
      post("draft", { title: "Mermaid hardware", draft: true }),
      post("en/literal", { title: "Mermaid hardware" }),
    ]);
    searchSlugs.mockResolvedValue(["ranked", "ranked", "hidden", "missing"]);
    const result = await access.search({ query: "Mermaid hardware", limit: 1 });
    expect(result.searchMode).toBe("full_text_with_literal_fallback");
    expect(result.total).toBe(2);
    expect(result.articles.map((article) => article.slug)).toEqual(["ranked"]);
    expect(result.nextOffset).toBe(1);
    const next = await access.search({ query: "Mermaid hardware", limit: 1, offset: 1 });
    expect(next.articles.map((article) => article.slug)).toEqual(["literal"]);
    expect(next.nextOffset).toBeNull();
  });
  it("returns clean prose, dates and explicit bounded continuation", async () => {
    const { access, listPosts } = fixture();
    listPosts.mockResolvedValue([
      {
        ...post("one"),
        body:
          "Readable article. ".repeat(30) +
          "\n\n```js\nsecretCode()\n```\n\n<script>bad()</script>",
      },
    ]);
    const first = await access.read({ slug: "one", maxChars: 100 });
    expect(first).toMatchObject({
      published: "2026-01-01",
      author: "Artyom Kashuta",
      format: "plain_text_prose",
      offset: 0,
      nextOffset: 100,
      truncated: true,
    });
    expect(first?.text).toHaveLength(100);
    const rest = await access.read({ slug: "one", offset: 100 });
    expect(rest?.text).not.toMatch(/secretCode|bad\(\)|<script>/);
    expect(rest?.nextOffset).toBeNull();
    expect((first?.text ?? "") + (rest?.text ?? "")).toHaveLength(first?.totalChars ?? 0);
  });
  it("paginates lists without emitting bodies or private metadata", async () => {
    const { access } = fixture();
    const first = await access.search({ limit: 1 });
    expect(first).toMatchObject({ total: 2, nextOffset: 1 });
    expect(first.articles[0]).not.toHaveProperty("body");
    expect(first.articles[0]).not.toHaveProperty("apiRevision");
    expect((await access.search({ limit: 1, offset: 1 })).nextOffset).toBeNull();
    expect((await access.topics({ limit: 1 })).nextOffset).toBe(1);
  });
  it("does not bypass configured visibility metadata when the DB fails", async () => {
    const { access, hiddenSlugs } = fixture();
    hiddenSlugs.mockRejectedValue(new Error("database unavailable"));
    await expect(access.search({})).rejects.toThrow("database unavailable");
    await expect(access.read({ slug: "one" })).rejects.toThrow("database unavailable");
  });
  it.each([
    { language: "de" },
    { query: "x".repeat(201) },
    { limit: 21 },
    { offset: -1 },
    { tag: "../admin" },
    { includeDrafts: true },
  ])("rejects invalid search arguments %j", async (args) => {
    const { access, listPosts } = fixture();
    await expect(access.search(args)).rejects.toThrow();
    expect(listPosts).not.toHaveBeenCalled();
  });
  it.each([
    { slug: "../admin" },
    { slug: "https://example.com" },
    { slug: "one", maxChars: 16001 },
  ])("rejects unsafe/oversized article reads %j", async (args) => {
    await expect(fixture().access.read(args)).rejects.toThrow();
  });
});
