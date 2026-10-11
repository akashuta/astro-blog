# Browser WebMCP on artka.dev

WebMCP is a progressive enhancement on public pages using `document.modelContext.registerTool`.
This is a browser API, **not a remote MCP endpoint**. An agent must visit the site in a compatible
browser that exposes the API. Ordinary browsing, search, and booking links work without it.
No origin-trial token or browser flag is installed/configured by this change.

API verified on 2026-10-11 against Chrome's [overview](https://developer.chrome.com/docs/ai/webmcp)
(updated October 7) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).
Registrations use an AbortSignal, not an obsolete navigator API or unregisterTool.
Tools remain same-origin; no cross-origin `exposedTo` or iframe delegation is added.

## Tools

| Tool | Capability | Arguments |
| --- | --- | --- |
| `search_articles` | Published article metadata and canonical URLs; empty query lists newest articles | `query`, `language`, `tag`, `limit`, `offset` |
| `read_article` | Clean prose, title, author, publication/revision dates, tags, canonical HTML and original Markdown URLs | bare `slug`, `language`, `maxChars`, `offset` |
| `list_topics` | Actual published topics, localized labels, counts, archive URLs | `language`, `limit`, `offset` |
| `get_meeting_booking_link` | Verified public Cal.com link plus localized site booking page | `language` |

Language defaults to the current page (RU or EN); an explicit language overrides it. No translation
is generated. Missing, draft, future-dated, removed or hidden articles are unavailable to all three
content tools. Metadata is clipped; lists return at most 20 entries (default 8) with `nextOffset`.
Queries are capped at 200 characters, text chunks at 16,000 (default 8,000). Read `nextOffset`
continues the text. `truncated` and `totalChars` make partial results explicit. Clean text reuses the
existing SEO prose extractor: HTML, fenced examples, inline code and diagrams are omitted. Follow
`markdownUrl` for original code examples; cite `canonicalUrl`.

The common read model in `src/lib/public-content/access.ts` takes explicit data dependencies. Its
server adapter reuses the public Markdown collection, editorial visibility metadata, localized tag
dictionary and existing Postgres search. Candidate slugs are filtered by publication, language and
tag **before** the full-text limit. Empty full-text results (including older file-backed EN content
with no English vector), or an unconfigured preview DB, use literal AND matching on prose/title/tags;
`searchMode` states `full_text`, `literal` or `latest`. Literal mode has no stemming or advanced query
syntax. A configured DB failure returns 503, rather than bypassing hidden content.

The browser adapter calls same-origin, read-only GET routes under `/api/public/articles/{search,read,topics}/`.
Inputs are validated on both sides, unknown/duplicate parameters rejected, credentials omitted by the
client. Responses have `no-store` and `noindex`; no private admin DTOs, publishing APIs, calendars or
credentials are exposed. Failures return bounded generic error codes and server errors are logged.
The public data routes are JSON HTTP, not MCP protocol or an MCP transport. A future read-only remote
MCP adapter can call the same read model after separately defining transport, access and rate limits.

## Meeting handoff

The existing “Назначить встречу” / “Book a meeting” action leads to `/contact/#book` or
`/en/contact/#book`. That page has a click-to-load Cal.com embed and a plain fallback link. The
booking tool derives its scheduler URL from the same `calPublicUrl` configuration.

`https://cal.com/kashuta` was verified in the user's Mac Chrome browser on 2026-10-11: the public
Artyom Kashuta profile offered “30 min meeting” and “1 hour”. These are observations, not an
availability promise. No slot was selected and no test booking/invitation was sent.

The tool **only returns links**. `status: "booking_link"`, `bookingCreated: false` and localized
instructions explicitly require the visitor to choose meeting type/time, enter details, and confirm
in Cal.com. The existing contact page also says the author confirms the meeting; returning the
link promises neither a reservation nor that later approval. It does not automatically open a tab or load the embed. No scheduler requests are made
merely by registering/executing the tool; the existing click-to-load privacy behavior remains intact.
No safe availability API exists in this integration, so none is added: no calendar reads, API keys,
new privileged public endpoints, permission changes or claims that a reservation was created.

## Lifecycle and verification

The tiny bootstrap feature-detects `document.modelContext.registerTool` before dynamically importing
the tool/validation module. Unsupported browsers make no content requests. Registrations are aborted
before Astro swaps and on pagehide; page-load and bfcache restoration register against the current
page language. Partial registration failures abort owned tools and warn without breaking the page.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify:seo-build`, `pnpm test:built`, and
`pnpm test:db` (Docker). Unit tests cover filtering, limits, validation, errors, cancellation and
booking handoff. Built browser tests exercise the actual bundled adapter with a documented-API test
double, including RU/EN navigation, re-registration and unsupported fallback. A separate native
browser test enables WebMCP in an isolated Chromium context and uses `document.modelContext.getTools`
and `executeTool` for RU/EN search, read, topics, booking links and navigation; it skips only if the
installed browser lacks the document API. Chrome 153/154 test consumers pass JSON text arguments;
Chrome 155+ takes objects. This does not change application callbacks or use the legacy navigator API.
Native execution passed locally on Chromium 153.0.8010.12. The user's regular Mac Chrome had no
`document.modelContext`, and ordinary search and RU/EN navigation were verified there. No browser
profile settings were changed. These checks do not certify compatibility with every browser agent.
