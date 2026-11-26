// ==UserScript==
// @name         Twitter Annoyances
// @namespace    https://github.com/nlopez/twitter-annoyances
// @version      0.1.4
// @description  Fixes assorted x.com annoyances
// @homepageURL  https://github.com/nlopez/twitter-annoyances
// @downloadURL  https://raw.githubusercontent.com/nlopez/twitter-annoyances/main/twitter-annoyances.user.js
// @updateURL    https://raw.githubusercontent.com/nlopez/twitter-annoyances/main/twitter-annoyances.user.js
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        none
// @inject-into  auto
// ==/UserScript==

(() => {
  'use strict';

  // On Firefox, x.com's CSP blocks page injection, so Violentmonkey runs this
  // in an isolated content script. There, x.com's own objects are reached
  // through wrappedJSObject, and functions and objects handed to x.com must
  // be exported into its scope. In the page itself these are no-ops.
  // Call x.com's functions with Reflect.apply, not fn.apply/fn.call: those
  // are x.com's own methods and can't read this script's argument arrays.
  const pageWindow =
    window.wrappedJSObject ?? (typeof unsafeWindow === 'object' ? unsafeWindow.wrappedJSObject : undefined) ?? window;
  const isolated = pageWindow !== window;
  const toPage = (fn) => (isolated ? exportFunction(fn, pageWindow) : fn);
  const toPageObject = (obj) => (isolated ? cloneInto(obj, pageWindow) : obj);
  const pageObject = (obj) => obj?.wrappedJSObject ?? obj;

  // Make x.com's router re-read the address bar.
  // The event init is built from x.com's own Object so x.com can read it.
  const firePopstate = () => {
    const init = new pageWindow.Object();
    init.state = pageWindow.history.state;
    pageWindow.dispatchEvent(new pageWindow.PopStateEvent('popstate', init));
  };

  // Navigate inside x.com's single-page app without a full reload.
  const spaNavigate = (path) => {
    history.pushState({}, '', path);
    firePopstate();
  };

  // Let cmd/ctrl/shift/middle clicks fall through to the real href.
  const onPlainClick = (el, handler) => {
    el.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
  };

  // x.com toggles hover classes from JS, so cloned elements never get them.
  // Learn the classes by hovering a hidden native element with the same markup
  // and diffing its class lists (on it and its first child); the class names
  // depend on the theme, so they can't be hardcoded.
  const learnedHover = new WeakMap();
  const learnHoverClasses = (proxy) => {
    if (learnedHover.has(proxy)) return learnedHover.get(proxy);
    const targets = (el) => [el, el.firstElementChild];
    const before = targets(proxy).map((el) => new Set(el?.classList));
    const promise = new Promise((resolve) => {
      const finish = (result) => {
        obs.disconnect();
        clearTimeout(timer);
        proxy.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        resolve(result);
      };
      const obs = new MutationObserver(() => {
        const added = targets(proxy).map((el, i) => [...(el?.classList ?? [])].filter((c) => !before[i].has(c)));
        if (added.some((a) => a.length)) finish(added);
      });
      obs.observe(proxy, { attributes: true, subtree: true, attributeFilter: ['class'] });
      const timer = setTimeout(() => finish(null), 1000);
      proxy.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    learnedHover.set(proxy, promise);
    return promise;
  };

  const mirrorHover = (clone, getProxy) => {
    let hovered = false;
    let classes = null;
    const apply = () => {
      if (!classes) return;
      [clone, clone.firstElementChild].forEach((el, i) => {
        for (const c of classes[i]) el?.classList.toggle(c, hovered);
      });
    };
    clone.addEventListener('mouseenter', () => {
      hovered = true;
      if (classes) return apply();
      const proxy = getProxy();
      if (proxy) learnHoverClasses(proxy).then((c) => { classes = c; apply(); });
    });
    clone.addEventListener('mouseleave', () => {
      hovered = false;
      apply();
    });
  };

  const NAV = 'header nav[role="navigation"]';

  // Add a nav link built from a copy of the Profile link so it matches the
  // native items. Rebuilt when the nav switches between icon-only and labeled
  // layouts, when the label changes, or when it ends up out of place.
  const ensureNavItem = ({ testid, href, iconPath, label, after }) => {
    const profile = document.querySelector(`${NAV} > [data-testid="AppTabBar_Profile_Link"]`);
    if (!profile) return;
    const existing = profile.parentElement.querySelector(`[data-testid="${testid}"]`);
    let anchor = after(profile);
    // An anchor relative to Profile can resolve to this item itself.
    if (anchor === existing) anchor = existing.previousElementSibling;
    if (
      existing &&
      existing.previousElementSibling === anchor &&
      !!existing.textContent.trim() === !!profile.textContent.trim() &&
      existing.getAttribute('aria-label') === label
    ) return;
    existing?.remove();

    const a = profile.cloneNode(true);
    a.setAttribute('href', href);
    a.setAttribute('aria-label', label);
    a.dataset.testid = testid;
    a.querySelector('svg > g').innerHTML = `<path d="${iconPath}"></path>`;
    const text = a.querySelector('span');
    if (text) text.textContent = label;
    mirrorHover(a, () => document.querySelector(`${NAV} > a[href="/explore"]`));
    onPlainClick(a, () => spaNavigate(href));
    anchor.after(a);
  };
  const MENU_SETTINGS = '[data-testid="Dropdown"] a[data-testid="settings"]';

  // Left-nav items to move into the "More" menu.
  const MOVED_TO_MENU = ['/explore', '/i/chat', '/i/calls', '/i/grok'];

  // Some localized labels only exist on particular pages (e.g. "Settings and
  // privacy" while the More menu is open), so remember them for nav items.
  const storage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch {}
    },
  };
  const labelKey = (name) => `twitter-annoyances:label:${name}`;
  const rememberLabel = (name, text) => {
    if (text && text !== storage.get(labelKey(name))) storage.set(labelKey(name), text);
  };
  const learnedLabel = (name, fallback) => storage.get(labelKey(name)) || fallback;

  const GEAR_PATH =
    'M10.54 1.75h2.92l1.57 2.36c.11.17.32.25.53.21l2.53-.59 2.17 2.17-.58 2.54c-.05.2.04.41.21.53l2.36 1.57v2.92l-2.36 1.57c-.17.12-.26.33-.21.53l.58 2.54-2.17 2.17-2.53-.59c-.21-.04-.42.04-.53.21l-1.57 2.36h-2.92l-1.58-2.36c-.11-.17-.32-.25-.52-.21l-2.54.59-2.17-2.17.58-2.54c.05-.2-.03-.41-.21-.53l-2.35-1.57v-2.92L4.1 8.97c.18-.12.26-.33.21-.53L3.73 5.9 5.9 3.73l2.54.59c.2.04.41-.04.52-.21l1.58-2.36zm1.07 2l-.98 1.47C10.05 6.08 9 6.5 7.99 6.27l-1.46-.34-.6.6.33 1.46c.24 1.01-.18 2.07-1.05 2.64l-1.46.98v.78l1.46.98c.87.57 1.29 1.63 1.05 2.64l-.33 1.46.6.6 1.46-.34c1.01-.23 2.06.19 2.64 1.05l.98 1.47h.78l.97-1.47c.58-.86 1.63-1.28 2.65-1.05l1.45.34.61-.6-.34-1.46c-.23-1.01.18-2.07 1.05-2.64l1.47-.98v-.78l-1.47-.98c-.87-.57-1.28-1.63-1.05-2.64l.34-1.46-.61-.6-1.45.34c-1.02.23-2.07-.19-2.65-1.05l-.97-1.47h-.78zM12 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5c.82 0 1.5-.67 1.5-1.5s-.68-1.5-1.5-1.5zM8.5 12c0-1.93 1.56-3.5 3.5-3.5 1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5c-1.94 0-3.5-1.57-3.5-3.5z';

  const HEART_PATH =
    'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z';

  const HEART_FILLED_PATH =
    'M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z';

  const BOOKMARK_OUTLINE_PATH =
    'M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z';

  // The label element only exists in the nav's wide layout.
  const navLabel = (link) => link?.querySelector('div[dir]');

  const setAttr = (el, name, value) => {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  };

  // On /i/history/likes x.com marks History as the active nav item. Show the
  // heart as active instead: filled icon and bold label on the heart, outline
  // icon and normal label on History. Originals are kept in data attributes.
  const updateLikesActiveState = () => {
    const historyLink = document.querySelector(`${NAV} > a[href="/i/history"]`);
    const heart = document.querySelector(`${NAV} > [data-testid="ta-nav-likes"]`);
    const profile = document.querySelector(`${NAV} > [data-testid="AppTabBar_Profile_Link"]`);
    if (!heart || !profile) return;
    const onLikes = location.pathname === '/i/history/likes';
    const historyPath = historyLink?.querySelector('path');
    const historyLabel = navLabel(historyLink);

    if (onLikes && historyLink) {
      if (!historyLink.hasAttribute('data-ta-orig-d')) {
        historyLink.setAttribute('data-ta-orig-d', historyPath?.getAttribute('d') ?? '');
        historyLink.setAttribute('data-ta-orig-label', historyLabel?.className ?? '');
      }
      setAttr(historyPath, 'd', BOOKMARK_OUTLINE_PATH);
      setAttr(historyLabel, 'class', navLabel(profile)?.className);
    } else if (historyLink?.hasAttribute('data-ta-orig-d')) {
      // Within /i/history x.com still thinks History is active and won't
      // redraw it, so restore it; elsewhere x.com has already redrawn it.
      if (location.pathname.startsWith('/i/history')) {
        setAttr(historyPath, 'd', historyLink.getAttribute('data-ta-orig-d'));
        setAttr(historyLabel, 'class', historyLink.getAttribute('data-ta-orig-label'));
      }
      historyLink.removeAttribute('data-ta-orig-d');
      historyLink.removeAttribute('data-ta-orig-label');
    }

    setAttr(heart.querySelector('path'), 'd', onLikes ? HEART_FILLED_PATH : HEART_PATH);
    const activeLabelClass = historyLink?.getAttribute('data-ta-orig-label');
    setAttr(navLabel(heart), 'class', onLikes && activeLabelClass ? activeLabelClass : navLabel(profile)?.className);
  };

  const GROK_ICON_PATH_PREFIX = 'M12.745 20.54l10.97-8.19';

  const isPromoted = (article) => {
    const el = pageObject(article);
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    for (let fiber = fiberKey && el[fiberKey], i = 0; fiber && i < 40; fiber = fiber.return, i++) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object' && 'promotedContent' in props) return !!props.promotedContent;
    }
    return !article.querySelector('time');
  };

  const RETRY_ICON_PATH_PREFIX = 'M12 4c-4.418 0-8 3.58-8 8s3.582 8 8 8c3.806';

  // Latest 429 per GraphQL operation, from x.com's rate-limit headers.
  const rateLimits = new Map();

  const rateLimitText = (op, { limit, reset }) => {
    const resetMs = reset * 1000;
    const time = new Date(resetMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const minutes = Math.ceil((resetMs - Date.now()) / 60000);
    if (minutes <= 0) return `x.com rate limit for ${op} reset at ${time}. Retry now.`;
    const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(minutes, 'minute');
    return `x.com rate limit hit: ${op} allows ${limit} requests per window.\nResets at ${time} (${relative}).`;
  };

  const updateRateLimitNotes = () => {
    const latest = [...rateLimits].sort((a, b) => b[1].at - a[1].at)[0];
    for (const path of document.querySelectorAll(`[data-testid="primaryColumn"] button path[d^="${RETRY_ICON_PATH_PREFIX}"]`)) {
      const button = path.closest('button');
      const box = button.parentElement;
      let note = box.querySelector(':scope > [data-ta-ratelimit]');
      if (!latest) {
        note?.remove();
        continue;
      }
      if (!note) {
        // Copy the error message's element so the note matches its style.
        const message = button.previousElementSibling;
        note = message ? message.cloneNode(true) : document.createElement('div');
        note.setAttribute('data-ta-ratelimit', '');
        note.style.whiteSpace = 'pre-line';
        box.insertBefore(note, button);
      }
      const target = note.querySelector('span') ?? note;
      const text = rateLimitText(...latest);
      // Only write on change; writes trigger the MutationObserver.
      if (target.textContent !== text) target.textContent = text;
    }
  };

  // Each fix: { name, css?, init?, run? }. `css` is injected once, `init()`
  // runs at document-start, and `run(root)` runs on load and on every DOM
  // mutation batch.
  const fixes = [
    {
      // Every ancestor of the search form hides its children that don't
      // contain the form, leaving only the search box in the sidebar.
      name: 'sidebar-search-only',
      css: `
        [data-testid="sidebarColumn"] :has(> * form[role="search"]) > :not(:has(form[role="search"])) {
          display: none !important;
        }
        /* Pages like /explore put search in the main column instead. */
        [data-testid="sidebarColumn"]:not(:has(form[role="search"])) > * {
          display: none !important;
        }`,
    },
    {
      name: 'hide-floating-drawers',
      css: `
        [data-testid="GrokDrawer"],
        [data-testid="chat-drawer-root"] {
          display: none !important;
        }`,
    },
    {
      // Hide the nav links; the "More" menu gets copies that navigate the
      // same way. The originals stay in the DOM so their icons can be reused.
      name: 'move-nav-items-to-more-menu',
      css: MOVED_TO_MENU.map((href) => `${NAV} > a[href="${href}"]`).join(',\n') + ' { display: none !important; }',
      run() {
        const settings = document.querySelector(MENU_SETTINGS);
        if (!settings) return;
        rememberLabel('settings', settings.textContent.trim());
        const template = settings.parentElement;
        const list = template.parentElement;
        if (list.querySelector('[data-ta-moved]')) return;

        const items = MOVED_TO_MENU.map((href) => {
          // The nav only renders visible text in its wide layout; otherwise
          // use its (longer) accessible name. Both are localized by x.com.
          const navLink = document.querySelector(`${NAV} > a[href="${href}"]`);
          const label = navLink?.textContent.trim() || navLink?.getAttribute('aria-label') || href;
          const item = template.cloneNode(true);
          const a = item.querySelector('a');
          a.setAttribute('href', href);
          a.dataset.testid = `ta-menu${href.replaceAll('/', '-')}`;
          a.dataset.taMoved = '';
          a.querySelector('span').textContent = label;
          const navSvg = navLink?.querySelector('svg');
          if (navSvg) {
            const svg = a.querySelector('svg');
            svg.setAttribute('viewBox', navSvg.getAttribute('viewBox'));
            svg.replaceChildren(...[...navSvg.childNodes].map((n) => n.cloneNode(true)));
          }
          mirrorHover(a, () => document.querySelector(MENU_SETTINGS));
          onPlainClick(a, () => {
            // The More button toggles the menu; synthetic Escape doesn't close it.
            document.querySelector('[data-testid="AppTabBar_More_Menu"]')?.click();
            spaNavigate(href);
          });
          return item;
        });
        list.prepend(...items);
      },
    },
    {
      // Hide "Settings and privacy" in the "More" menu and add it to the nav,
      // built from a copy of the Profile link so it matches the other items.
      name: 'settings-in-nav',
      css: `
        [data-testid="Dropdown"] div:has(> a[data-testid="settings"]) {
          display: none !important;
        }`,
      run() {
        ensureNavItem({
          testid: 'ta-nav-settings',
          href: '/settings',
          iconPath: GEAR_PATH,
          label: learnedLabel('settings', 'Settings and privacy'),
          after: (profile) => profile,
        });
      },
    },
    {
      // Heart link to your likes (the Likes tab of the History page), placed
      // after History/Bookmarks.
      name: 'likes-in-nav',
      run() {
        const tab = document.querySelector('[data-testid="primaryColumn"] [role="tab"][href="/i/history/likes"]');
        if (tab) rememberLabel('likes', tab.textContent.trim());
        ensureNavItem({
          testid: 'ta-nav-likes',
          href: '/i/history/likes',
          iconPath: HEART_PATH,
          label: learnedLabel('likes', 'Likes'),
          after: (profile) =>
            document.querySelector(`${NAV} > a[href="/i/history"], ${NAV} > a[href="/i/bookmarks"]`) ??
            profile.previousElementSibling,
        });
        updateLikesActiveState();
      },
    },
    {
      // Matched by icon, since the button's label is localized. The same icon
      // also marks "Translated from …" lines, which aren't buttons.
      // Also covers other Grok-icon buttons such as the profile header's
      // "Profile Summary".
      name: 'hide-grok-buttons',
      css: `
        article[data-testid="tweet"] div:has(> button path[d^="${GROK_ICON_PATH_PREFIX}"]),
        [data-testid="primaryColumn"] button:has(path[d^="${GROK_ICON_PATH_PREFIX}"]) {
          display: none !important;
        }`,
    },
    {
      // The "You aren't verified yet" box on your own profile has no test ID;
      // its link to the Premium sign-up page is the stable marker. Only hide
      // siblings of the profile header, never the header or posts.
      name: 'hide-profile-verify-upsell',
      css: `
        [data-testid="primaryColumn"] :has(> * [data-testid="UserName"])
          > :has(a[href="/i/premium_sign_up"]):not(:has([data-testid="UserName"], article)) {
          display: none !important;
        }`,
    },
    {
      // Composer toolbar, both inline on Home and in the Post dialog.
      name: 'hide-grok-image-generation',
      css: `
        [data-testid="toolBar"] [data-testid="grokImgGen"] {
          display: none !important;
        }`,
    },
    {
      // Promoted posts have no test ID and their "Ad" label is localized, so
      // read React's props for the post. If that ever fails, fall back to ads
      // having no timestamp anywhere in the post.
      name: 'hide-promoted-posts',
      run() {
        for (const article of document.querySelectorAll('article[data-testid="tweet"]:not([data-ta-checked])')) {
          article.setAttribute('data-ta-checked', '');
          if (!isPromoted(article)) continue;
          article.closest('[data-testid="cellInnerDiv"]')?.setAttribute('data-ta-ad', '');
        }
      },
      css: `
        [data-testid="cellInnerDiv"][data-ta-ad] {
          display: none !important;
        }`,
    },
    {
      // Share links get ?s=<client>&t=<sharer id>&a=... appended. Strip them from
      // copied/shared links and from the address bar when opening one. Runs
      // before the media fix so its address-bar cleanup isn't seen as a
      // navigation.
      name: 'strip-share-tracking-params',
      init() {
        const clean = (text) =>
          text.replace(/https:\/\/(?:x|twitter)\.com\/[^\s?#]*\?[^\s#]*/g, (link) => {
            try {
              const u = new URL(link);
              if (!/^\d+$/.test(u.searchParams.get('s') ?? '')) return link;
              // s: client and share method (20 = web, 46 = iPhone, 19 = Android).
              u.searchParams.delete('s');
              // t: opaque token tied to the sharing account, so X can attribute
              // clicks to whoever shared the link.
              u.searchParams.delete('t');
              // a: per-share token, added October 2026, that ties each click to
              // the session and moment the link was generated.
              u.searchParams.delete('a');
              return u.href;
            } catch {
              return link;
            }
          });

        const here = clean(location.href);
        if (here !== location.href) history.replaceState(history.state, '', here);

        const nav = pageWindow.navigator;
        const clip = nav.clipboard;
        if (clip?.writeText) {
          const writeText = clip.writeText;
          clip.writeText = toPage(function (text) {
            return Reflect.apply(writeText, this, [typeof text === 'string' ? clean(text) : text]);
          });
        }

        if (nav.share) {
          const share = nav.share;
          nav.share = toPage(function (data) {
            const src = pageObject(data);
            if (src && typeof src === 'object') {
              const copy = { ...src };
              for (const k of ['url', 'text']) if (typeof copy[k] === 'string') copy[k] = clean(copy[k]);
              data = toPageObject(copy);
            }
            return Reflect.apply(share, this, [data]);
          });
        }

        // Fallback path: execCommand('copy') on a selected hidden textarea.
        addEventListener(
          'copy',
          (e) => {
            const el = document.activeElement;
            const text =
              el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.selectionStart != null
                ? el.value.slice(el.selectionStart, el.selectionEnd)
                : String(getSelection() ?? '');
            const cleaned = clean(text);
            if (cleaned === text || !e.clipboardData) return;
            e.clipboardData.setData('text/plain', cleaned);
            e.preventDefault();
          },
          true,
        );
      },
    },
    {
      // Make Photos the default media filter: bare /<user>/media means Photos.
      // x.com's dropdown selects Videos by navigating to that same bare URL
      // from the media page itself, so that case gets ?filter=video instead.
      name: 'profile-media-defaults-to-photos',
      init() {
        const NOT_USERS = new Set(['i', 'settings', 'compose', 'search', 'explore', 'home', 'notifications', 'messages']);
        const mediaUser = (url) => {
          const m = url.pathname.match(/^\/([^/]+)\/media\/?$/);
          return m && !NOT_USERS.has(m[1]) ? m[1] : null;
        };

        // Page loads: rewrite before x.com's router reads the URL.
        const loaded = !location.search && mediaUser(location);
        if (loaded) history.replaceState(history.state, '', `/${loaded}/media?filter=photo${location.hash}`);

        // In-app navigation. The router has already decided to render the
        // bare URL (Videos), so after switching to Photos, fire popstate to
        // make it re-read the address bar.
        const pageHistory = pageWindow.history;
        for (const method of ['pushState', 'replaceState']) {
          const original = pageHistory[method];
          pageHistory[method] = toPage(function (state, title, url) {
            let resync = false;
            if (url != null) {
              try {
                const u = new URL(String(url), location.href);
                const user = u.origin === location.origin && !u.search && mediaUser(u);
                if (user) {
                  const choosingVideos = mediaUser(location)?.toLowerCase() === user.toLowerCase();
                  url = `/${user}/media?filter=${choosingVideos ? 'video' : 'photo'}${u.hash}`;
                  resync = !choosingVideos;
                }
              } catch {}
            }
            const result = Reflect.apply(original, this, [state, title, url]);
            if (resync) setTimeout(firePopstate);
            return result;
          });
        }
      },
    },
    {
      // x.com shows only "Something went wrong" when it rate-limits a request.
      // Add when the limit resets, next to the Retry button.
      name: 'explain-rate-limit-errors',
      init() {
        const urls = new WeakMap();
        const proto = pageWindow.XMLHttpRequest.prototype;
        const { open, send } = proto;
        proto.open = toPage(function (method, url) {
          urls.set(this, String(url));
          return Reflect.apply(open, this, [...arguments]);
        });
        proto.send = toPage(function () {
          this.addEventListener('loadend', () => {
            const op = urls.get(this)?.match(/\/i\/api\/graphql\/[^/]+\/([^/?]+)/)?.[1];
            if (!op) return;
            if (this.status === 429) {
              rateLimits.set(op, {
                limit: this.getResponseHeader('x-rate-limit-limit') ?? '?',
                reset: Number(this.getResponseHeader('x-rate-limit-reset')),
                at: Date.now(),
              });
            } else if (this.status >= 200 && this.status < 300) {
              rateLimits.delete(op);
            }
          });
          return Reflect.apply(send, this, [...arguments]);
        });
        // Keep the countdown current while a note is showing.
        setInterval(() => rateLimits.size && updateRateLimitNotes(), 15000);
      },
      run: updateRateLimitNotes,
    },
  ];

  for (const f of fixes) f.init?.();

  const styleText = fixes.filter((f) => f.css).map((f) => `/* ${f.name} */\n${f.css}`).join('\n');
  if (styleText) {
    const style = document.createElement('style');
    style.dataset.twitterAnnoyances = '';
    style.textContent = styleText;
    // At document-start, even <html> may not exist yet.
    if (document.documentElement) {
      document.documentElement.appendChild(style);
    } else {
      new MutationObserver((_, obs) => {
        if (!document.documentElement) return;
        obs.disconnect();
        document.documentElement.appendChild(style);
      }).observe(document, { childList: true });
    }
  }

  const runners = fixes.filter((f) => f.run);
  if (!runners.length) return;

  const runAll = () => {
    for (const f of runners) {
      try {
        f.run(document);
      } catch (err) {
        console.error(`[twitter-annoyances] ${f.name}:`, err);
      }
    }
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      runAll();
    });
  };

  const start = () => {
    runAll();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
