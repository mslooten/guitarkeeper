---
description: session handoff
budget_tokens: 1000
---
# STATUS — GuitarKeeper

Last updated: 2026-11-09

## Current state

- Vue 3/Vite local-first PWA for guitar collections, setup notes, and string-change history. Data and photos remain in IndexedDB on the user's device.
- Browser Back and Forward navigate between Home, Collection, Care journal, and guitar details using hash URLs in `src/App.vue`. Guitar links only resolve on a device with that local record; deleted or unavailable guitars show a not-found state.
- Collection order can be changed with drag handles or move buttons. IDs are stored separately in the IndexedDB settings store; v2 migrates existing databases without rewriting guitar records. Sorting is disabled while filtering.
- Care journal supports combined brand, gauge, guitar, and inclusive date-range filters, with ascending/descending sorts. Filters are in-memory only.
- The offline app shell and assets are configured in `vite.config.js`.
- GitHub Pages builds use relative asset URLs to support both the project subpath and a root custom domain. `public/CNAME` declares `guitarkeeper.com`; `.github/workflows/deploy.yml` deploys `dist` on pushes to `main`. DNS and the custom-domain setting in Pages still require configuration.

## Verification

- `npm run build` passed. Journal filters, sorting, empty results, and entry navigation were verified in an isolated browser session; its data was discarded.
- Verified GitHub Pages initially served the unbuilt repository root. Local and Pages builds pass with relative URLs, `dist/CNAME` is present, and the production preview renders from the root path.

## Next steps

- No outstanding task requested.