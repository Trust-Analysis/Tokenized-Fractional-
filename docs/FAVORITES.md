# Favorites: anonymous vs. connected wallet

Favorites (the watchlist shown on `FavoritesPage`) live only in the browser's
`localStorage`; there is no backend copy. The store is
`frontend/src/store/useFavoritesStore.js`. `App.jsx` calls
`setActiveWallet(publicKey)` whenever the connected wallet changes.

| Situation | Storage key | Behaviour |
| --- | --- | --- |
| No wallet connected | `rwa-watchlist_guest` | Favoriting works; the list persists across reloads. |
| Guest → connect wallet | `rwa-watchlist_<address>` | The guest list is **merged** into the wallet's saved list. On a duplicate asset the wallet's saved entry wins (keeps its categories, `addedAt` and alert baseline). Guest-only assets are appended, and guest custom categories are merged by id. The guest key is then **cleared**. |
| Disconnect | `rwa-watchlist_guest` | The wallet's list stays saved under its own key. The UI shows the (now empty) guest list. |
| Switch wallet A → B | `rwa-watchlist_<B>` | No merge. B's saved list is loaded. |

Clearing the guest list after the merge means an anonymous list is adopted by
exactly one wallet, so on a shared device the next person's wallet does not
inherit it.

Because nothing is synced server-side, favorites do not follow a wallet to
another browser or device.

Tests: `frontend/src/test/FavoritesSync.test.jsx`.
