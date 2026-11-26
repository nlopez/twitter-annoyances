# twitter-annoyances

A userscript and a uBlock Origin filter list that fix assorted x.com annoyances.

## Install

### Userscript

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`twitter-annoyances.user.js`](https://raw.githubusercontent.com/nlopez/twitter-annoyances/main/twitter-annoyances.user.js) and confirm the install.

The manager checks this URL for updates. Updates are picked up when `@version` changes.

### uBlock Origin filter list

1. Open the uBlock Origin dashboard and go to **Filter lists**.
2. Under **Import…**, paste the URL below and click **Apply changes**:

   ```
   https://raw.githubusercontent.com/nlopez/twitter-annoyances/main/ublock-filters.txt
   ```

The list removes the `s`, `t` and `a` tracking params X adds to shared links, before the request is sent. It needs full uBlock Origin; uBO Lite can't import custom lists.

## What the userscript does

### Navigation

- Moves Explore, Chat, Calls and Grok out of the sidebar into the **More** menu.
- Adds **Settings and privacy** to the sidebar.
- Adds a heart link to your likes, which fills in while you're on that page.
- Shows only the search box in the right sidebar.

### Grok, ads and upsells

- Hides Grok buttons, including the profile header's "Profile Summary".
- Hides Grok image generation in the composer.
- Hides the floating Grok and chat drawers.
- Hides promoted posts.
- Hides the "You aren't verified yet" box on your profile.

### Behavior

- Opens a profile's Media tab on Photos instead of Videos.
- Adds the rate-limit reset time to "Something went wrong" errors.
- Strips share tracking params from copied and shared links, and from the address bar when you open one.

## Development

`dev/load.js` injects the userscript at document-start with the Playwright MCP server. Close the browser first (`browser_close`), since init scripts can't be removed, then run it with `browser_run_code_unsafe` and `filename: "dev/load.js"`.
