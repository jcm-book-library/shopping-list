# Want & Need (shopping list): notes for Claude

**Read the house rules first:** [HOUSE-RULES.md](https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md) in `control-room` (plain text: https://raw.githubusercontent.com/jcm-book-library/control-room/main/HOUSE-RULES.md). They cover Google Sheet safety, branches and pull requests into `main`, using cheaper models to save usage credits, and the build template. The notes below are this repo's own; where they are more specific, they win. The project charter is `project.json`.

## This repo
- Source: `app.html`. Rebuild `index.html` with `python3 tools/build-pages.py` after every change and commit both.
- Live site: https://jcm-book-library.github.io/shopping-list/ (from `main`). `?demo` runs on made-up sample data with no sheet.
- **Look is different from the house default on purpose:** the owner asked for Roboto, a warm neutral palette, light and dark (auto, or chosen with the header toggle), and a symmetrical layout. Keep that here; don't switch it to Atkinson/Figtree or dark-only.
- Separate from Coin & Compass (`Personal-budget`) on purpose. The only link is the export on the Budget tab, which produces rows in the exact column order of Coin & Compass's `BuyList` tab. If BuyList's columns change, update `BUYLIST_HEADS` and `buyListRows` in `app.html`. Likely to merge later.
- Pure logic (money, totals, sorting, ordering, the import mapper) sits between `LOGIC START` and `LOGIC END` in `app.html`, tested by `tools/test-logic.js`.
- Tests: `node tools/test-logic.js` and `NODE_PATH=$(npm root -g) node tools/test.js /tmp/wn-shots`. Run both before every push.

## Google Sheet
- Sheet id is in the owner's browser settings (`wn_config`), not here: the repo is public.
- The app owns only `🛒 Items` and `🛒 Settings`. Columns are in the README. It never deletes rows: remove = Active FALSE.
- The importer **reads** the owner's hand-made tabs `Priorities`, `Purchases`, `Clothing` and `Household` (scoped ranges, read-only) and writes the result to `🛒 Items` only, after a preview the owner ticks through. Never write to those four tabs or any other tab in that sheet (it also holds Budget, Accounts and other finance tabs).
- Photos: optional, uploaded to the owner's Google Drive (`drive.file` scope: the app sees only files it made) in a folder "Want & Need photos". The Image column holds `drive:<fileId>` or a normal image URL.
