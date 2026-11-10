# GuitarKeeper

A local-first, installable Vue app for keeping a guitar collection, setup notes, and string-change history together.

In Collection, drag a guitar's handle to arrange it, or use the move buttons. The order is saved on this device. Clear any search before reordering.

## Getting started

Use Node.js 20.19+ or 22.12+ and npm. Install dependencies with `npm install`, then start the development server with `npm run dev`. Build for production with `npm run build` and serve that build locally with `npm run preview`.

## Your data

Guitars, photos, setup details, and string history are stored in IndexedDB in the browser on this device. They are not synced or sent to a server. Clearing browser or site data, changing browsers or devices, or uninstalling the app may remove access to the collection. There is currently no cloud backup, account, export, or paid plan.

## Installing and offline use

Visit the production app over HTTPS (or localhost), then use the browser's install option or the in-app install button when available. On iOS/iPadOS, use Share → Add to Home Screen. After the first successful online visit, the app shell is cached for offline use. Browser storage and installation behavior vary by browser.
