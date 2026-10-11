import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT = join(process.cwd(), "dist/client");
const ORIGIN = "https://artka.dev";

describe("author-card navigation on built articles", () => {
  it.each(["ru", "en"] as const)("%s avatars reach an existing profile target", (locale) => {
    const prefix = locale === "en" ? "/en" : "";
    const blog = join(CLIENT, `${prefix}/blog`);
    const posts = readdirSync(blog, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(blog, entry.name, "index.html")))
      .map((entry) => join(blog, entry.name, "index.html"));
    expect(posts.length, `no ${locale} articles were built`).toBeGreaterThan(0);

    for (const file of posts) {
      const html = readFileSync(file, "utf8");
      const avatar = [...html.matchAll(/<a\b[^>]*>/g)].find(([tag]) =>
        /\bclass="[^"]*\bauthor-card__avatar-link\b/.test(tag),
      )?.[0];
      const href = avatar ? /\bhref="([^"]+)"/.exec(avatar)?.[1] : undefined;
      expect(href, `${file} author avatar has no destination`).toBeDefined();
      const target = new URL(href!, ORIGIN);
      expect(target.origin, file).toBe(ORIGIN);
      expect(target.pathname, file).toBe(`${prefix}/about/`);

      const profile = join(CLIENT, target.pathname, "index.html");
      expect(existsSync(profile), `${file} links to an unbuilt profile`).toBe(true);
      if (target.hash) {
        const profileHtml = readFileSync(profile, "utf8");
        const ids = [
          ...profileHtml.matchAll(/<[a-z][^>]*\bid="([^"]*)"/gi),
          ...profileHtml.matchAll(/<a\b[^>]*\bname="([^"]*)"/gi),
        ].map((match) => match[1]);
        expect(ids, `${file} links to missing profile fragment ${target.hash}`).toContain(
          decodeURIComponent(target.hash.slice(1)),
        );
      }
    }
  });
});
