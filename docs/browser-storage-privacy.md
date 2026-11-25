# Browser storage privacy

## Browser storage privacy

This app uses browser local storage to remember the following data on this site:

| Storage key | Data and purpose |
| --- | --- |
| `userProfile_<publicKey>` | Wallet address in the key, and profile fields such as display name, email, bio, website, location and avatar in the value. This restores the profile in the same browser. |
| Profile preference keys | Settings for notifications, appearance, language and other profile controls. These settings are shared across wallets in the same browser. |
| `rwa_price_alerts` | Asset identifiers, target prices, alert direction and status. This restores price alerts. The key is shared across wallets in the same browser. |
| `rwa-watchlist_<address>` and `rwa-watchlist_guest` | Favorites, categories and notifications. These restore a wallet's watchlist or the guest watchlist. |
| `analytics_anon_id` | A browser identifier used to associate analytics events. Created only after you enable purchase analytics. Disabling analytics removes the ID. |

Scripts running on this site's origin can read or modify these values. A wallet-specific key groups entries by wallet address and provides no access control. Stored profile and alert data should be treated as untrusted when read. Under **Data Management** in the wallet profile, use **Clear local data**
to remove the current wallet's profile and watchlist, shared profile
preferences and price alerts, and the analytics ID and consent. Wallet
disconnect performs the same cleanup. Other wallets' saved profiles and
watchlists remain available to those wallets in this browser.
