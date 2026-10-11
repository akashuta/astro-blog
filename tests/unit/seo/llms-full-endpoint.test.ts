import type { APIContext } from "astro";
import { describe, expect, it } from "vitest";
import { GET, prerender } from "../../../src/pages/llms-full.txt";
import { buildLlmsFull, LLMS_FULL_BUDGET_BYTES, type LlmsInput } from "~/lib/agents/llms";

const post = (locale: "ru" | "en", slug: string, words: number): LlmsInput["ruPosts"][number] => ({
  slug,
  title: `${locale} ${slug}`,
  description: `Description of ${slug}`,
  pubDate: new Date("2026-05-01T00:00:00.000Z"),
  updatedDate: new Date("2026-06-01T00:00:00.000Z"),
  tags: ["seo"],
  body: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
});

const small: LlmsInput = {
  ruPosts: [post("ru", "a", 200)],
  enPosts: [post("en", "a", 200)],
};

describe("buildLlmsFull", () => {
  it("inlines full bodies of both locales when under budget and says so", () => {
    const out = buildLlmsFull(small);
    expect(out.mode).toBe("full");
    expect(out.bytes).toBeLessThanOrEqual(LLMS_FULL_BUDGET_BYTES);
    expect(out.text).toContain(
      "full Markdown bodies of every Russian post and every English translation",
    );
    expect(out.text).toContain("URL: https://artka.dev/blog/a/");
    expect(out.text).toContain("Markdown: https://artka.dev/blog/a.md");
    expect(out.text).toContain("Published: 2026-05-01");
    expect(out.text).toContain("Updated: 2026-06-01");
    expect(out.text).toContain("URL: https://artka.dev/en/blog/a/");
    expect(out.text).toContain("word199");
    expect(out.text).toContain("X-Robots-Tag: noindex");
  });

  it("falls back to EN excerpts (RU stays full) when the budget would be exceeded", () => {
    const out = buildLlmsFull(
      { ...small, ruPosts: [post("ru", "a", 3_000)], enPosts: [post("en", "a", 3_000)] },
      40 * 1024,
    );
    expect(out.mode).toBe("en-excerpts");
    expect(out.text).toContain("80-word excerpts of the English translations");
    // RU body complete, EN trimmed to an excerpt.
    expect(out.text).toContain("word2999");
    expect(out.text.split("word2999")).toHaveLength(2);
    expect(out.text).toMatch(/Excerpt: word0 word1/);
  });

  it("keeps a growing RU corpus within budget while retaining every article and twin URL", () => {
    const input: LlmsInput = {
      ruPosts: [post("ru", "large", 30_000), post("ru", "second", 200)],
      enPosts: [post("en", "large", 30_000), post("en", "second", 200)],
    };
    const out = buildLlmsFull(input);
    expect(out.bytes).toBeLessThanOrEqual(LLMS_FULL_BUDGET_BYTES);
    expect(out.bytes).toBe(Buffer.byteLength(out.text, "utf8"));
    expect(out.mode).toBe("excerpts");
    expect(out.text).toContain("80-word excerpts of both languages");
    expect(out.text).not.toContain("word29999");
    for (const prefix of ["", "/en"]) {
      for (const slug of ["large", "second"]) {
        expect(out.text).toContain(`URL: https://artka.dev${prefix}/blog/${slug}/`);
        expect(out.text).toContain(`Markdown: https://artka.dev${prefix}/blog/${slug}.md`);
      }
    }
  });

  it("falls back to an explicit URL index when even one multibyte excerpt is too large", () => {
    const oversized = { ...post("ru", "unicode", 1), body: "контекст".repeat(30_000) };
    const out = buildLlmsFull({ ruPosts: [oversized], enPosts: [oversized] }, 4 * 1024);
    expect(out.bytes).toBeLessThanOrEqual(4 * 1024);
    expect(out.mode).toBe("index");
    expect(out.text).toContain("article URLs only; bodies and excerpts are omitted");
    expect(out.text).toContain("Markdown: https://artka.dev/blog/unicode.md");
    expect(out.text).toContain("Markdown: https://artka.dev/en/blog/unicode.md");
    expect(out.text).not.toContain("контекст");
  });

  it("fails clearly when the budget cannot hold every article pointer", () => {
    expect(() => buildLlmsFull(small, 100)).toThrow(/too small to list every article/);
  });
});

describe("llms-full.txt endpoint", () => {
  it("renders the digest as runtime plain text from shared content", async () => {
    const response = await GET({} as APIContext);
    const body = await response.text();

    expect(prerender).toBe(false);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(["full", "en-excerpts", "excerpts", "index"]).toContain(
      response.headers.get("X-Llms-Full-Mode"),
    );
    expect(body).toContain("# artka.dev — full LLM digest");
    expect(body).toContain("## Author");
    expect(body).toContain("# Posts (Russian — source of truth)");
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(LLMS_FULL_BUDGET_BYTES);
  });
});
