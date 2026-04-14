# Launch prep — thesis reframe + SEO + analytics

**Participants**: claude, dan

## Summary

End of 2026-04-14. Flipped omniscitus from "feature parade" positioning
to **"Model changes. Records compound."** as the durable thesis.
Updated landing and README to match, added basic SEO/OG infrastructure,
shipped the Vercel Analytics wiring, posted the launch thread on X,
and prepared the Threads (KR) follow-up.

## Context

- **Background**: earlier in the day a cold honest self-evaluation
  surfaced that the existing hero ("10 Skills · Team-Ready · Living
  memory") read as feature parade and overhype. The stronger, more
  defensible positioning is that *records* are the invariant AI-prod
  devs actually need — tooling (editor, model, skill set) keeps
  churning, records compound.
- **Requirements**: launch content that holds up to a year of scrutiny;
  landing that doesn't promise aspirational features; SEO so the
  domain isn't dead-on-arrival; analytics so we know what's working.
- **Decisions**:
  - Hero and all marketing copy rewritten around the "records compound"
    thesis. Removed "10 Skills" / "Team-Ready" / "living memory" language.
  - X thread structured as a *journey* (CLAUDE.md → `.claude/` structure
    → member system → skills + role shift → omniscitus) rather than a
    feature list, so readers self-diagnose their own layer.
  - OG image generated via headless Chrome from an HTML template
    (no Figma dependency, re-generable from the repo).
  - Vercel framework explicitly pinned to `null` in `vercel.json` to
    stop the Analytics UI from auto-detecting Next.js.
  - v0.9 public-launch deferred. Created an open release-gate unit
    listing the execution debt (history search, real participants,
    scale testing, test runner, etc.) that needs to close before a
    real public launch.
- **Constraints**: honesty — no claims the tool can't back. Especially:
  stop calling the snapshot demo "live", stop saying "living memory"
  when units are append-only snapshots.

## Timeline

### 2026-04-14 — thesis reframe

**Focus**: kill feature parade, lead with invariant
- Hero title: "The maintenance layer your codebase deserves" → **"Model changes. Records compound."**
- Subtitle: "living memory of every file..." → "The record layer for AI-driven production. A Claude Code plugin that auto-tracks files, sessions, tests, and team decisions."
- Hero badges: `10 Skills · Auto Blueprints · Team-Ready · Birdview` → `Auto Blueprints · Topic History · Birdview` (removed feature-counting and aspirational claims)
- README top: same reframe. Added Latin etymology ("the one who knows all — aspirational name for a humble goal") as italic subline under title.
- Landing "Why This Exists" section: section title changed to **"Model changes. Tools change. Records compound."**, subtitle aligned with thesis.
- Philosophy quote rewritten to "when you delegate more to AI, the bottleneck moves from writing to remembering" (replaces "living world model" language).

### 2026-04-14 — SEO + analytics

**Focus**: basic SEO infrastructure
- `<title>` + `<meta name="description">` rewritten to thesis wording
- `<meta name="keywords">` added
- Open Graph tags: og:type, og:url, og:title, og:description, og:image, og:image:width/height, og:site_name
- Twitter Card: summary_large_image variant
- JSON-LD SoftwareApplication schema with MIT license, author, codeRepository
- `<link rel="canonical">` pointing at apex
- `/robots.txt` allowing all except `birdview-demo/data/`, sitemap reference
- `/sitemap.xml` covering landing + all 4 birdview-demo pages
- `/og-image.png` (1200×630) generated via headless Chrome from `/docs/og-template.html`
- Vercel Analytics + Speed Insights scripts added (static-HTML variant, no npm install)
- `vercel.json`: `framework: null`, `cleanUrls: true`, `trailingSlash: false`, cache headers for og-image / favicons / robots.txt / sitemap.xml

### 2026-04-14 — launch content

**Focus**: X thread + Threads (KR) draft
- Journey-style X thread (7 posts): CLAUDE.md → `.claude/` structure + session summaries → member system → multi-domain + role shift → omniscitus + etymology. Closing: "Model changes. Records compound." + @AnthropicAI + #ClaudeCode.
- Threads (KR) 4-post version with slightly warmer first-person tone.
- Image strategy guidance: thesis typography card for post 1, birdview 4-pane composite for post 6, constellation GIF optional for post 7.
- Posted on X. Threads pending.

**Learned**:
- "Stop shipping feature parades" is easier to say than do — the first marketing-draft I wrote also had 10 Skills / Team-Ready energy. It took a cold self-review round to force the thesis out.
- The journey structure converts doubters because readers recognize their own step. "Feature parade" copy doesn't let them locate themselves.
- Honest positioning doesn't weaken the pitch — it strengthens it. v0.8 labeled honestly as "works, dogfooded in production, 0.9 public launch gated on tracked items" reads as confident, not apologetic.

## Pending

- Enable Vercel Analytics in dashboard (user-side toggle; script already live)
- Enable Speed Insights in dashboard
- Submit sitemap to Google Search Console
- Threads (KR) post
- 0.9 release gate items (tracked in `devops/2026-04-14-0.9-release-gate.md`)
- Post-launch: refresh the X thread card by re-sharing the URL (old X post card is cached without og-image)

## Notes

Related units:
- `devops/2026-04-14-0.9-release-gate.md` — execution debt to clear before a public 0.9 launch
- `web/2026-04-14-file-viewer-and-participants.md` — feature work shipped same day
- `web/2026-04-14-birdview-readable-ui.md` — first-half readability work

Key decision preserved for posterity: **records are the invariant, tools
aren't**. Any future feature debate on this project should be able to
answer "does this make records more useful?" — if not, it belongs in a
different product.
