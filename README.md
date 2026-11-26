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

- Moves Explore, Chat, Calls, Grok and X Money out of the sidebar into the **More** menu.
- Adds **Settings and privacy** to the sidebar.
- Adds a heart link to your likes, which fills in while you're on that page.
- Shows only the search box in the right sidebar.

### Grok, ads and upsells

- Hides Grok buttons, including the profile header's "Profile Summary".
- Hides Grok image generation in the composer.
- Hides the floating Grok and chat drawers.
- Hides promoted posts.
- Hides other X Money buttons, such as the one next to **Edit profile**.
- Hides the "You aren't verified yet" box on your profile.

### Behavior

- Opens a profile's Media tab on Photos instead of Videos.
- Adds the rate-limit reset time to "Something went wrong" errors.
- Strips share tracking params from copied and shared links, and from the address bar when you open one.

## Development

### Live reload in Violentmonkey

GitHub caches the raw script for 5 minutes and Violentmonkey checks for updates daily, so test local edits by tracking the file instead:

1. From the repo root, run `npx http-server -c-1 -a localhost -p 8765` (`-c-1` disables caching).
2. Open http://localhost:8765/twitter-annoyances.user.js.
3. On the installer page, tick **Reload tab**, click **Track external edits**, and leave the tab open.
4. Disable the GitHub-installed copy so only one runs.

Each save is reinstalled and x.com reloads. See [Violentmonkey's guide](https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/).

### Firefox content mode

On Firefox, logged-in x.com's CSP blocks page injection, so Violentmonkey runs the script as an isolated content script (`@inject-into auto`). Chromium injects into the page. Code that patches x.com's own objects must work in both: use the `pageWindow`, `toPage`, `pageObject` and `firePopstate` helpers at the top of the script, and call x.com's functions with `Reflect.apply`. Test those changes in Firefox, since Playwright can't reproduce content mode.

### Firefox with Violentmonkey

`dev/firefox.mjs` drives stock Firefox with the real Violentmonkey, so it reproduces content mode. It keeps a persistent profile in `.dev/`.

```sh
npm install --prefix dev
node dev/firefox.mjs start      # launch Firefox and the script server
node dev/firefox.mjs install    # install the script into Violentmonkey, tracking edits
node dev/firefox.mjs run <file> # run <file>'s default export: async ({ browser, page }) => result
node dev/firefox.mjs stop
```

Log in to x.com once in the window `start` opens. Leave Violentmonkey's installer tab open; closing it stops tracking.

### Playwright

`dev/load.js` injects the userscript at document-start with the Playwright MCP server. Close the browser first (`browser_close`), since init scripts can't be removed, then run it with `browser_run_code_unsafe` and `filename: "dev/load.js"`.

`.mcp.json` adds a `playwright-firefox` server that drives Playwright's Firefox build with a persistent profile in `.playwright-mcp/firefox-profile`. Install the browser once with `npx playwright@1.66.0-alpha-2026-11-09 install firefox` (the Playwright version `@playwright/mcp@0.0.85` uses), then log in to x.com in the window it opens. It injects the script straight into the page, so it still doesn't reproduce Violentmonkey's content mode.
