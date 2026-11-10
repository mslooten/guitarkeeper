# GuitarKeeper project notes

- Vue 3 and Vite application; use `npm run build` to validate production builds.
- Guitar data and photos are stored locally in IndexedDB via `src/storage.js`; do not introduce a server or synchronization without an explicit request.
- The Vite PWA configuration provides an installable offline app shell. Keep app assets local and include new offline asset types in the precache.
- Users can lose local data if browser storage is cleared; be transparent about persistence limitations.