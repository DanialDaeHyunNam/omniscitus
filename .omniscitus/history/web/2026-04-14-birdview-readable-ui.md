# Birdview non-dev readability pass

**Domain**: web
**Status**: closed
**Created**: 2026-04-14
**Last updated**: 2026-04-14

## Intent

The Tests tab was built dev-first. Non-devs opening the dashboard to
review what the project does bounced off the JSON dumps and tight
dev-y layout. Readability pass across Tests + Blueprint + Constellation.

## What landed

- **Tests — side-by-side Input → Expected** (#57, `de7f93d`) —
  `.case-io` grid renders Input and Expected as two columns with a →
  arrow between them. Stacks with a rotated arrow under 720px.
- **Tests — JSON syntax highlight** — `highlightJson()` replaces raw
  `JSON.stringify` dumps. Keys / strings / numbers / booleans / null
  get distinct colors, structure is indented, empty objects render as
  `{}` instead of blank.
- **Tests — schema-strategy renders as type pill** (#62, `46b5728`) —
  non-serializable return types (`ReactNode[]`, streams, event handlers)
  used to show `{"value": "ReactNode[]"}`. Now a clean `TYPE ReactNode[]`
  pill, plus opt-in `describe:` and `example:` fields in meta.yaml for
  semantic context. (#63, `6b9fb16`) Empty-state hint teaches the
  convention when only the type is declared.
- **meta.yaml parser fixes** (#63) — `coerceScalar()` handles numbers,
  booleans, null, empty `[]`/`{}`. `readBlockScalar()` handles `|` and
  `>` block literals so multi-line `describe:` / `example:` work.
- **Blueprint + Constellation filters** (#59, `bb15164`) — date tabs
  (All time / Last 7d, default 7d) + author chips (click to hide).
  On constellation the filters live inside the left Blueprints panel
  above the header.
- **Per-page purpose hints** (#64, `cffafed`) — short paragraph under
  each page title explaining what it shows and which commands feed it.
- **Demo banner saga** (#60, #61, #64) — banner originally `position: fixed`
  covered controls on narrow viewports. Switched to in-flow → turned
  out to be invisible on constellation (body `overflow:hidden`). Back
  to fixed banner + nudge rules for fixed-layout pages. Final form
  sticks.

## Decisions worth remembering

- **The Tests tab optimizes for reading, not writing.** Add / Remove
  actions are secondary — the primary affordance is "can a PM glance
  and understand?"
- **Don't extend meta.yaml schema lightly.** `describe:` and `example:`
  were added because `strategy: schema` returned too-thin cards;
  anything else should meet a similar bar.
- **Author filter is exclusion-based, not inclusion-based.** Click to
  hide matches the mental model of "get this noise out of my view"
  better than "show me only these".

## Pending

None. `/omniscitus-update` skipping `skipped_canonical` entries
automatically is tracked in `devops/2026-04-14-plugin-update-apply.md`.
