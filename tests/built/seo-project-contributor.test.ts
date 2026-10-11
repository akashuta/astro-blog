import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectPages = (["projects", "en/projects"] as const).flatMap((directory) => {
  const root = join(process.cwd(), "dist/client", directory);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      route: `/${directory}/${entry.name}/`,
      file: join(root, entry.name, "index.html"),
    }));
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

describe("project attribution in built JSON-LD", () => {
  it("covers a project in each locale", () => {
    expect(projectPages.some(({ route }) => route.startsWith("/projects/"))).toBe(true);
    expect(projectPages.some(({ route }) => route.startsWith("/en/projects/"))).toBe(true);
  });

  // Schema.org author, creator and contributor identify people or organizations.
  // A visible role label ("Solo: design, backend, ...") is not an identity.
  // Check the emitted graph so a layout or builder regression cannot pass merely
  // because the TypeScript types still accept the input.
  it.each(projectPages)("$route identifies actors instead of role descriptions", ({ file }) => {
    const html = readFileSync(file, "utf8");
    const block = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
    expect(block).toBeDefined();
    const parsed: unknown = JSON.parse(block!);
    expect(isRecord(parsed)).toBe(true);
    const graph = isRecord(parsed) && Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [];
    const nodes = graph.filter(isRecord);
    const work = nodes.find((node) => node["@type"] === "CreativeWork");
    expect(work).toBeDefined();
    const byId = new Map(nodes.map((node) => [node["@id"], node]));

    for (const property of ["author", "creator", "contributor"] as const) {
      const value = work?.[property];
      if (property === "contributor" && value === undefined) continue;
      const actors = Array.isArray(value) ? value : [value];
      expect(actors, property).not.toHaveLength(0);
      for (const actor of actors) {
        expect(isRecord(actor), `${property} must identify a person or organization`).toBe(true);
        const resolved = isRecord(actor)
          ? actor["@type"] === undefined
            ? byId.get(actor["@id"])
            : actor
          : undefined;
        expect(resolved?.["@type"], property).toMatch(/^(Person|Organization)$/);
        expect(resolved?.["name"], property).toEqual(expect.any(String));
        expect(String(resolved?.["name"] ?? "").trim(), property).not.toBe("");
      }
    }
  });
});
