# Google Indexing Recovery Runbook

Owner: site owner / DNS, proxy, deployment, and Google Search Console administrators
Repository prerequisite: merge and deploy the reviewed SEO changes after CI passes
Status: owner-gated; external mutations in this runbook are **not completed by the PR**

Record the operator, UTC timestamp, deployed commit, command output, and Search Console screenshots or export links alongside every completed checkbox. Stop if a redirect takes more than one hop, changes the intended path/query, points away from `https://artka.dev`, uses anything except `301` for GET/HEAD canonicalization, or uses anything except method-preserving `307`/`308` for slashless non-idempotent traffic.

Astro middleware supplies a defense-in-depth host redirect and security headers for on-demand routes. The standalone adapter serves prerendered files before that middleware, so sitewide host normalization and static-response security headers remain edge responsibilities. Verify file-like slash variants against the deployed commit rather than assuming the adapter's behavior: on 2026-10-11 the RU feed, sitemap and digest variants redirected correctly, while `/en/rss.xml/` and `/en/feed.json/` returned `404`.

The Claude Code course, its project page and the duplicate draft post were removed deliberately. Their URLs must remain `410 Gone`; they are not indexing candidates and must not be restored or redirected to surviving content. `/privacy/` and `/en/privacy/` are current published pages and return `200`. Search Console exclusions include historical URLs: compare current indexable HTML separately before interpreting its counts as defects.

## 1. DNS, TLS, and edge canonicalization

- [ ] At the DNS/proxy provider, confirm `www.artka.dev` resolves only to the intended production edge. Remove stale records only after the owner verifies their purpose.
- [ ] Provision and activate a certificate whose Subject Alternative Names include `www.artka.dev`. This must be valid before relying on an HTTPS redirect; an application response cannot repair a failed TLS handshake.
- [ ] Configure both HTTP and HTTPS `www` traffic as one permanent hop to the apex, preserving the complete request URI:

  ```text
  https://www.artka.dev/$request_uri -> https://artka.dev/$request_uri (301)
  http://www.artka.dev/$request_uri  -> https://artka.dev/$request_uri (301)
  ```

- [ ] If security headers are intended across the entire site, configure the edge to attach the production policy to prerendered responses: `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and the intended report-only CSP. Keep the values aligned with `src/middleware.ts` for on-demand responses.

- [ ] Verify certificate and redirect behavior from outside the provider network:

  ```bash
  curl -sS -I 'https://www.artka.dev/about/?x=1'
  curl -sS -I 'http://www.artka.dev/about/?x=1'
  ```

  Expected for both: `301` and exactly `Location: https://artka.dev/about/?x=1`. The HTTPS command must complete without certificate warnings.

- [ ] Configure the edge to use `307` or `308` when a slashless non-idempotent request needs its canonical slash. Do not use `301`/`302`, which may change the method or discard the body.
- [ ] Configure the edge to collapse a slashless legacy alias directly to its final canonical rather than first adding a slash.
- [ ] Verify direct permanent GET/HEAD redirects from file-like slash variants to the unslashed identity, including `/llms-full.txt/`, both locale RSS and JSON feeds, `/sitemap-index.xml/`, and locale sitemap variants. Correct any remaining edge rules after the reviewed application changes are deployed.

## 2. Deploy the verified application

- [ ] Confirm CI was green on the commit selected for release: job `checks` (`pnpm lint`, `pnpm typecheck`, `pnpm translate:check`, unit tests) and job `build` (Playwright Chromium headless shell, `pnpm verify:seo-build` — which forces an Astro content-cache refresh — then `pnpm test:built`, which includes the production smoke and SEO utility-route suites).
- [ ] Deploy that exact commit through the normal production pipeline. Record the commit SHA and deployment identifier.
- [ ] Confirm the deployment is healthy before changing Search Console submissions. Roll back through the deployment platform if public `200` pages or canonical redirects regress.

## 3. Live HTTP verification

Run these checks against production after caches have refreshed. `curl -I` sends `HEAD`, which follows the same normalization policy as `GET`; use `curl -sS -D - -o /dev/null` as a GET cross-check when a proxy treats HEAD differently.

- [ ] Apex and slash normalization:

  ```bash
  curl -sS -I 'https://artka.dev/'
  curl -sS -I 'https://artka.dev/blog'
  curl -sS -I 'https://artka.dev/blog/'
  curl -sS -I 'https://artka.dev/en/'
  curl -sS -I 'https://artka.dev/en/blog/'
  ```

  Expected: home and slash-suffixed pages return `200`; `/blog` returns one `301` with `Location: /blog/` (or the equivalent absolute apex URL).

- [ ] Deliberately removed lesson addresses:

  ```bash
  curl -sS -I 'https://artka.dev/blog/02-context-and-cache'
  curl -sS -I 'https://artka.dev/blog/02-context-and-cache/'
  ```

  Expected: the slashed URL returns `410` with `X-Robots-Tag: noindex` and no `Location`; the slashless URL may normalize once before the `410`. The course target also returns `410`. On 2026-10-11 three historical slashed aliases (`/blog/02-context-and-cache/`, `/blog/06-mcp/`, `/en/blog/06-mcp/`) returned `301` to a removed course URL, while their query variants answered direct `410`. This observed response inconsistency does not establish which serving or cache layer supplied the redirect. Establish its origin, then correct obsolete redirect rules or cached responses while retaining the application removal policy. Do not restore the course or request indexing for either address.

- [ ] Method-preserving non-GET slash normalization:

  ```bash
  curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' --data '{' 'https://artka.dev/api/check'
  curl -sS -L --max-redirs 1 -D - -o /dev/null -H 'Content-Type: application/json' --data-binary '{' 'https://artka.dev/api/check'
  curl -sS -D - -o /dev/null -H 'Content-Type: application/json' --data-binary '{' 'https://artka.dev/api/check/'
  curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' --data '{' 'https://artka.dev/api/auth/sign-in/email/'
  curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' --data '{' 'https://artka.dev/api/auth/sign-in/social/'
  curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' --data '{' 'https://artka.dev/api/auth/sign-out/'
  ```

  Expected: the first slashless `/api/check` request returns `307` or `308` to `/api/check/`. The followed probe shows that the same POST body reaches the canonical handler and finishes with deterministic `400` for the intentionally invalid JSON; the direct canonical probe does the same. Canonical auth POST paths may return validation/auth errors, but must not return slash-normalization `301`, `302`, `307`, or `308` and must not expose a normalization `Location` header.

- [ ] Utility and file-like routes:

  ```bash
  curl -sS -I 'https://artka.dev/search/'
  curl -sS -I 'https://artka.dev/en/search/'
  curl -sS -I 'https://artka.dev/llms-full.txt'
  curl -sS -I 'https://artka.dev/robots.txt'
  curl -sS -I 'https://artka.dev/sitemap-index.xml'
  curl -sS -I 'https://artka.dev/sitemap-ru.xml'
  curl -sS -I 'https://artka.dev/sitemap-en.xml'
  ```

  Expected: every route returns `200` without a slash redirect. Search pages render `noindex,follow`; `/llms-full.txt` returns `X-Robots-Tag: noindex`; sitemap responses are XML and list apex HTTPS canonical URLs.

- [ ] File-like slash variants at the edge, using both HEAD and GET:

  ```bash
  curl -sS -I 'https://artka.dev/llms-full.txt/'
  curl -sS -D - -o /dev/null 'https://artka.dev/llms-full.txt/'
  curl -sS -I 'https://artka.dev/rss.xml/'
  curl -sS -D - -o /dev/null 'https://artka.dev/rss.xml/'
  curl -sS -I 'https://artka.dev/en/rss.xml/'
  curl -sS -D - -o /dev/null 'https://artka.dev/en/rss.xml/'
  curl -sS -I 'https://artka.dev/feed.json/'
  curl -sS -D - -o /dev/null 'https://artka.dev/feed.json/'
  curl -sS -I 'https://artka.dev/en/feed.json/'
  curl -sS -D - -o /dev/null 'https://artka.dev/en/feed.json/'
  curl -sS -I 'https://artka.dev/sitemap-index.xml/'
  curl -sS -D - -o /dev/null 'https://artka.dev/sitemap-index.xml/'
  curl -sS -I 'https://artka.dev/sitemap-ru.xml/'
  curl -sS -D - -o /dev/null 'https://artka.dev/sitemap-ru.xml/'
  ```

  Expected: each command returns one `301` directly to the corresponding unslashed apex HTTPS URL. No internal producer emits these variants. Record the actual deployed response chain; a duplicate `200`, an error, or an extra hop needs investigation rather than assuming an older adapter result still applies.

- [ ] Current privacy pages:

  ```bash
  curl -sS -I 'https://artka.dev/privacy/'
  curl -sS -I 'https://artka.dev/en/privacy/'
  ```

  Expected: `200`, self-referencing canonical and matching locale alternates. These pages appear in the current sitemaps; do not delete them to satisfy an obsolete removal check.

- [ ] Inspect representative page source for one canonical, matching Open Graph URL, language-correct hreflang links, and the expected robots directive:

  ```bash
  curl -sS 'https://artka.dev/blog/json-ld-graph-astro/'
  curl -sS 'https://artka.dev/en/blog/json-ld-graph-astro/'
  curl -sS 'https://artka.dev/tags/astro/'
  curl -sS 'https://artka.dev/projects/astro-blog/'
  ```

- [ ] Compare response security headers on one prerendered page and one on-demand route:

  ```bash
  curl -sS -I 'https://artka.dev/about/'
  curl -sS -I 'https://artka.dev/llms-full.txt'
  ```

  If sitewide headers are part of the deployment policy, both responses must expose the approved `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and report-only CSP values. A passing application smoke test alone does not prove headers on edge-served static files.

## 4. Search Console sitemap handoff

These are owner-approved Search Console mutations; do not perform them from a PR workflow.

- [ ] In the verified `https://artka.dev/` property, submit `https://artka.dev/sitemap-index.xml`.
- [ ] Confirm Search Console fetches the index successfully and discovers the RU and EN child sitemaps.
- [ ] Remove the obsolete `https://artka.dev/sitemap.xml` submission. Do not remove the new index or its child sitemaps.
- [ ] Save the submission timestamp and the discovered/submitted URL counts.

## 5. Representative URL inspection and validation

- [ ] Use URL Inspection on this small canonical sample; confirm the inspected URL, user-declared canonical, and rendered canonical agree, then request indexing where the UI permits:

  - Home: `https://artka.dev/`
  - RU post: `https://artka.dev/blog/json-ld-graph-astro/`
  - EN post: `https://artka.dev/en/blog/json-ld-graph-astro/`
  - Author: `https://artka.dev/about/`
  - Project: `https://artka.dev/projects/astro-blog/`

- [ ] Separate historical removed URLs from current indexable URLs in the affected Search Console buckets before starting any validation. A deliberate `410`, a `noindex` utility, or a tag archive absent from the sitemap is an expected exclusion.
- [ ] Start validation only for verified repaired defects, then record each validation start date and affected-page count. Do not request indexing for removed course URLs, Markdown twins, `noindex` tags/search/login, or deliberate 404s.

## 6. Track recovery for 4–8 weeks

- [ ] Once per week for at least four and up to eight weeks, record:

  | Week/date | Indexed pages | Not found | Redirect | Alternate canonical | Google-selected canonical | Sitemap discovered/indexed | Notes |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
  | Baseline |  |  |  |  |  |  |  |
  | Week 1 |  |  |  |  |  |  |  |
  | Week 2 |  |  |  |  |  |  |  |
  | Week 3 |  |  |  |  |  |  |  |
  | Week 4 |  |  |  |  |  |  |  |
  | Weeks 5–8, if still changing |  |  |  |  |  |  |  |

- [ ] Investigate new regressions against the live curl checks and deployed SHA before changing source, redirects, DNS, or Search Console again.
- [ ] Close the recovery only after live signals remain stable and Search Console trends are recorded. Deployment does not promise immediate indexing; Google recrawl and canonical selection are observed outcomes.
