---
description: session handoff
budget_tokens: 1000
---
# STATUS — GuitarKeeper

Last updated: 2026-11-16

## Current state

- Vue 3/Vite local-first PWA for guitar collections, setup notes, and string-change history. Data and photos remain in IndexedDB on the user's device.
- Browser Back and Forward navigate between Home, Collection, Care journal, and guitar details using hash URLs in `src/App.vue`. Guitar links only resolve on a device with that local record; deleted or unavailable guitars show a not-found state.
- Collection order can be changed with drag handles or move buttons. IDs are stored separately in the IndexedDB settings store; v2 migrates existing databases without rewriting guitar records. Sorting is disabled while filtering.
- Care journal supports combined brand, gauge, guitar, and inclusive date-range filters, with ascending/descending sorts. Filters are in-memory only.
- Home and Collection offer local JSON backup and restore, including photos and collection order. Import validates first and atomically replaces the local collection after explicit confirmation; backup files are not encrypted.
- The offline app shell and assets are configured in `vite.config.js`.
- GitHub Pages builds use relative asset URLs to support both the project subpath and a root custom domain. `public/CNAME` declares `guitarkeeper.com`; `.github/workflows/deploy.yml` deploys `dist` on pushes to `main`. DNS and the custom-domain setting in Pages still require configuration.
- Pages workflow now uses Node 24 LTS with checkout/setup-node v7, upload-pages-artifact v5, and deploy-pages v5.

## Verification

- `npm test` and `npm run build` passed for backup support. An isolated local browser verified restore, order, download content, and malformed-file rejection; test data used a separate origin.
- Collection overview cards use a four-column layout on wide screens and compact square photos on mobile; `npm run build` passed after the styling update.
- `npm run build` passed. Journal filters, sorting, empty results, and entry navigation were verified in an isolated browser session; its data was discarded.
- Verified GitHub Pages initially served the unbuilt repository root. Local and Pages builds pass with relative URLs, `dist/CNAME` is present, and the production preview renders from the root path.
- Production build and workflow-version checks pass after Node 24 LTS upgrade; workflow change remains local until pushed.

## Next steps

- No outstanding task requested.