import { describe, expect, inject, it } from "vitest";
import { fetchWithTimeout } from "../support/production-server";

const origin = inject("siteOrigin");

describe("public utility file canonicalization", () => {
  it.each(["/en/rss.xml", "/en/feed.json", "/robots.txt", "/webmcp.json"])(
    "redirects a slash variant of %s while preserving its query",
    async (path) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetchWithTimeout(`${origin}${path}/?source=reader`, {
          method,
          redirect: "manual",
        });
        await response.body?.cancel();
        expect(response.status, `${method} ${path}/`).toBe(301);
        expect(new URL(response.headers.get("location")!, origin).pathname).toBe(path);
        expect(new URL(response.headers.get("location")!, origin).search).toBe("?source=reader");
      }
      const canonical = await fetchWithTimeout(`${origin}${path}?source=reader`, {
        redirect: "manual",
      });
      await canonical.body?.cancel();
      expect(canonical.status).toBe(200);
    },
  );

  it("keeps an unknown file slash path as a real 404", async () => {
    const response = await fetchWithTimeout(`${origin}/__missing-utility__.xml/`, {
      redirect: "manual",
    });
    await response.body?.cancel();
    expect(response.status).toBe(404);
    expect(response.headers.has("location")).toBe(false);
  });
});
