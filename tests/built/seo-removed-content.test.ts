import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, inject, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { isGonePath } from "~/lib/seo/gone";
import { CANONICAL_ORIGIN } from "~/lib/seo/url-policy";
import { fetchWithTimeout } from "../support/production-server";

const CLIENT = join(process.cwd(), "dist/client");
const origin = inject("siteOrigin");
const REMOVED = "/courses/claude-code-guide/06-mcp/";

const decodeXml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

const removedUrl = (value: string, base: string): boolean => {
  try {
    const url = new URL(decodeXml(value), base);
    return (
      (url.hostname === "artka.dev" || url.hostname === "www.artka.dev") && isGonePath(url.pathname)
    );
  } catch {
    // Non-URL content (for example a meta description) has no removal identity.
    return false;
  }
};

const schemaIssues = (value: unknown, base: string): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => schemaIssues(item, base));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (key === "@type") {
      return [item].flat().filter((type) => type === "Course" || type === "LearningResource");
    }
    if (typeof item === "string") return removedUrl(item, base) ? [item] : [];
    return schemaIssues(item, base);
  });
};

// Examine actual URL attributes and executable JSON-LD. A historical URL in
// prose or an escaped code example is not an active link or page identity.
const htmlIssues = (html: string, base: string): readonly string[] => {
  const attributes = [...html.matchAll(/<[a-z][^>]*>/gi)].flatMap(([tag]) =>
    [...tag.matchAll(/\b(?:href|src|action|content)\s*=\s*(["'])(.*?)\1/gi)].map(
      ([, , value]) => value ?? "",
    ),
  );
  const schemas = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].flatMap(([, body]) => schemaIssues(JSON.parse(body ?? "null"), base));
  return [...attributes.filter((value) => removedUrl(value, base)), ...schemas];
};

const xmlIssues = (xml: string): readonly string[] => {
  const urls = [...xml.matchAll(/<(?:loc|link|guid)(?:\s[^>]*)?>([^<]+)<\//gi)].map(
    ([, value]) => value ?? "",
  );
  const contentIssues = [
    ...xml.matchAll(/<content:encoded>([\s\S]*?)<\/content:encoded>/gi),
  ].flatMap(([, value = ""]) => {
    const html = value.startsWith("<![CDATA[")
      ? value.slice("<![CDATA[".length, -"]]>".length)
      : decodeXml(value);
    return htmlIssues(html, CANONICAL_ORIGIN);
  });
  return [
    ...urls.filter((value) => removedUrl(value, CANONICAL_ORIGIN)),
    ...htmlIssues(xml, CANONICAL_ORIGIN),
    ...contentIssues,
  ];
};

const jsonFeedIssues = (text: string): readonly string[] => {
  const feed = JSON.parse(text) as {
    home_page_url: string;
    feed_url: string;
    items: readonly { id: string; url: string; image?: string; content_html?: string }[];
  };
  const urls = [
    feed.home_page_url,
    feed.feed_url,
    ...feed.items.flatMap((item) => [item.id, item.url, item.image ?? ""]),
  ];
  return [
    ...urls.filter((value) => removedUrl(value, CANONICAL_ORIGIN)),
    ...feed.items.flatMap((item) => htmlIssues(item.content_html ?? "", item.url)),
  ];
};

const markdownIssues = (text: string): readonly string[] => {
  const issues: string[] = [];
  visit(unified().use(remarkParse).parse(text), (node) => {
    if ("url" in node && typeof node.url === "string" && removedUrl(node.url, CANONICAL_ORIGIN)) {
      issues.push(node.url);
    }
    if (node.type === "html") issues.push(...htmlIssues(node.value, CANONICAL_ORIGIN));
    if (node.type === "text") {
      for (const [, url = ""] of node.value.matchAll(/^(?:URL|Markdown):\s*(\S+)/gm)) {
        if (removedUrl(url, CANONICAL_ORIGIN)) issues.push(url);
      }
    }
  });
  return issues;
};

const htmlFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? htmlFiles(path)
      : entry.isFile() && entry.name.endsWith(".html")
        ? [path]
        : [];
  });

const builtText = async (path: string): Promise<string> => {
  const response = await fetchWithTimeout(`${origin}${path}`);
  const text = await response.text();
  expect(response.status, path).toBe(200);
  return text;
};

describe("removed content cannot return to built discovery", () => {
  it("rejects active links, metadata, schema, sitemap alternates and feed entries", () => {
    expect(htmlIssues(`<a href="${REMOVED}">Lesson</a>`, CANONICAL_ORIGIN)).toContain(REMOVED);
    expect(htmlIssues(`<meta property="og:url" content="${REMOVED}">`, CANONICAL_ORIGIN)).toContain(
      REMOVED,
    );
    expect(
      htmlIssues(
        '<script type="application/ld+json">{"@type":"Course"}</script>',
        CANONICAL_ORIGIN,
      ),
    ).toContain("Course");
    expect(
      xmlIssues(
        `<url><loc>https://artka.dev${REMOVED}</loc><xhtml:link href="${REMOVED}" /></url>`,
      ),
    ).toContain(REMOVED);
    expect(
      jsonFeedIssues(
        JSON.stringify({
          home_page_url: CANONICAL_ORIGIN,
          feed_url: `${CANONICAL_ORIGIN}/feed.json`,
          items: [{ id: `${CANONICAL_ORIGIN}${REMOVED}`, url: `${CANONICAL_ORIGIN}${REMOVED}` }],
        }),
      ),
    ).toContain(`${CANONICAL_ORIGIN}${REMOVED}`);
    expect(markdownIssues(`[Lesson](${REMOVED})`)).toContain(REMOVED);
    expect(htmlIssues('<a href="06-mcp/">Lesson</a>', `${CANONICAL_ORIGIN}/blog/`)).toContain(
      "06-mcp/",
    );
  });

  it("allows historical prose and escaped or fenced examples", () => {
    expect(
      htmlIssues(
        `<p>The old address was ${REMOVED}.</p><pre><code>&lt;a href="${REMOVED}"&gt;</code></pre>`,
        CANONICAL_ORIGIN,
      ),
    ).toEqual([]);
    expect(
      markdownIssues(
        `Historical address: \`${REMOVED}\`\n\n\`\`\`text\n${REMOVED}\nURL: https://artka.dev${REMOVED}\n\`\`\``,
      ),
    ).toEqual([]);
  });

  it("checks every static HTML page, including a route that could bypass middleware", () => {
    const files = htmlFiles(CLIENT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const path = `/${relative(CLIENT, file)
        .split("\\")
        .join("/")
        .replace(/index\.html$/, "")}`;
      expect(isGonePath(path), `removed route was prerendered: ${path}`).toBe(false);
      expect(
        htmlIssues(readFileSync(file, "utf8"), new URL(path, CANONICAL_ORIGIN).href),
        path,
      ).toEqual([]);
    }
  });

  it("checks served sitemap pages, feeds and agent discovery against the removal policy", async () => {
    const sitemaps = await Promise.all(["/sitemap-ru.xml", "/sitemap-en.xml"].map(builtText));
    for (const xml of sitemaps) expect(xmlIssues(xml)).toEqual([]);
    const paths = [
      ...new Set(
        sitemaps.flatMap((xml) =>
          [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url = ""]) => new URL(url).pathname),
        ),
      ),
    ];
    expect(paths.length).toBeGreaterThan(0);
    // The sitemap includes SSR home and blog indexes as well as static pages.
    for (const path of paths)
      expect(htmlIssues(await builtText(path), `${CANONICAL_ORIGIN}${path}`), path).toEqual([]);
    for (const path of ["/sitemap-index.xml", "/rss.xml", "/en/rss.xml"])
      expect(xmlIssues(await builtText(path)), path).toEqual([]);
    for (const path of ["/feed.json", "/en/feed.json"])
      expect(jsonFeedIssues(await builtText(path)), path).toEqual([]);
    for (const path of ["/llms.txt", "/llms-full.txt"])
      expect(markdownIssues(await builtText(path)), path).toEqual([]);
  });
});
