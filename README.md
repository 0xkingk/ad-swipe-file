# Lightbox — a private ad swipe file

A Pinterest-style board for saving ad inspo, hosted free on GitHub Pages.
Drag a screenshot in, paste one with ⌘V, or pin a link — it gets committed
straight into this repo (`/images` + `data/manifest.json`). That's what
makes it persistent: everything you pin is stored in the repo itself, not
your browser, so it's still there every time you open the link, on any
device.

## 1. Create the repo

1. On GitHub, create a **new public repository** (e.g. `ad-swipe-file`).
   Public is what makes image loading simple and free — treat the URL as
   "unlisted," not secret, since it's just ad screenshots. It's only
   findable if you share the link.
2. Upload every file in this folder to the repo root, keeping the structure:
   ```
   index.html
   styles.css
   app.js
   data/manifest.json
   images/.gitkeep
   ```

## 2. Turn on GitHub Pages

1. In the repo: **Settings → Pages**.
2. Under "Build and deployment," set **Source: Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. GitHub gives you a URL like `https://your-username.github.io/ad-swipe-file/`.
   That's the board. Give that link to your co-founder / creative partner.

## 3. Make a token

You need a GitHub personal access token so the app can commit pins on
your behalf. It's saved only in **your own browser's** local storage —
never written into the repo. You'll need to re-enter it if you switch
browsers or devices.

1. Go to **github.com/settings/personal-access-tokens/new** (fine-grained token).
2. Name it something like `lightbox-swipefile`.
3. Under **Repository access**, choose **Only select repositories** →
   pick the `ad-swipe-file` repo.
4. Under **Permissions → Repository permissions**, set **Contents: Read and write**.
5. Generate, and copy the token (starts with `github_pat_…`) — you won't see it again.

## 4. Connect

1. Open the Pages URL. On first visit it'll ask you to connect the board.
2. Fill in:
   - **github username/org** – whoever owns the repo
   - **repo name** – e.g. `ad-swipe-file`
   - **branch** – `main`
   - **personal access token** – the one you just made
3. Click connect. Do this once per browser/device you use — after that,
   the board (and everything on it) loads automatically every time you
   visit the link.

## Using it

- **Drag & drop** an image anywhere on the page to pin it.
- **Paste** (⌘V / Ctrl+V) a copied screenshot to pin it instantly.
- **+ link** pins something by URL without uploading a file — good for
  saving a live ad or landing page image you found online.
- Click any pin to add a **caption**, **tags**, and the **source URL**,
  or to unpin it.
- Tag chips along the top filter the board; the search bar matches
  captions, tags, source, and who pinned it.

## Notes on how it works (nothing to do, just FYI)

- There's no database — the GitHub repo *is* the database. Images live in
  `/images`, and all metadata (captions, tags, when) lives in
  `data/manifest.json`. GitHub Pages just serves those files as a website.
  That's the whole reason everything persists across visits and devices.
- Images get resized client-side (max 1600px, JPEG ~85%) before upload so
  the repo stays small and the board loads fast.
- Repo getting big isn't a real concern for a swipe file, but if it ever
  matters, old pins can just be deleted from the board (unpin), which
  removes the file from the repo too.
