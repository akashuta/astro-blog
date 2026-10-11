import { describe, expect, inject, it } from "vitest";
import { fetchWithTimeout } from "../support/production-server";

const origin = inject("siteOrigin");

describe("root language preference cache variance", () => {
  it.each([
    [undefined, 200],
    ["lang-pref=ru", 200],
    ["lang-pref=en", 302],
  ] as const)("varies the root response on Cookie for %s", async (cookie, status) => {
    const headers: Record<string, string> = { Accept: "text/html" };
    if (cookie) headers.Cookie = cookie;
    const response = await fetchWithTimeout(`${origin}/`, { headers, redirect: "manual" });
    await response.body?.cancel();
    expect(response.status).toBe(status);
    const vary = response.headers
      .get("Vary")
      ?.toLowerCase()
      .split(",")
      .map((token) => token.trim());
    expect(vary).toContain("cookie");
    expect(vary?.filter((token) => token === "cookie")).toHaveLength(1);
    if (status === 200) expect(vary).toContain("accept");
    else expect(new URL(response.headers.get("Location")!, origin).pathname).toBe("/en/");
  });

  it("keeps a direct article link independent of the language cookie", async () => {
    const response = await fetchWithTimeout(`${origin}/blog/mermaid-svg-playwright-build-time/`, {
      headers: { Cookie: "lang-pref=en" },
      redirect: "manual",
    });
    await response.body?.cancel();
    expect(response.status).toBe(200);
    expect(response.headers.get("Vary")?.toLowerCase() ?? "").not.toMatch(/\bcookie\b/);
  });
});
