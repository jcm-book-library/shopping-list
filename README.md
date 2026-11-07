# Want & Need

A shopping list for every future purchase: needs and wants, sorted by category and time frame, with links, product pictures, a tick-off checklist that keeps a record of what you bought, and totals you can hand to the budget app.

Live (once Pages is on): https://jcm-book-library.github.io/shopping-list/
Try it without a sheet: https://jcm-book-library.github.io/shopping-list/?demo

## What's in it
- **Board:** columns by Category, Time frame, Need / want or Status. Drag a card to another column to change it, or up and down to reorder. On a phone, drag by the ⋮⋮ grip.
- **Cards:** hover (or tap on a phone) to open a drawer: one-click category, one-click stickers, a note box that saves when you click away, the time frame, and a Shop ↗ link. The Need / Want pill flips with one click. Tick the box when you've bought it.
- **List:** a checklist sorted by Category → Time frame → Need / want → Priority. Change the order with **Change order**.
- **Gallery:** every item as a picture. Pictures come from an image address you paste, a photo you upload (saved to your Google Drive), or an image dragged onto a card from another browser tab. With no picture, the shop's icon shows.
- **Budget:** totals by category (with an optional budget per category), by time frame with a running total, need vs want, Pay in 4 instalments, biggest items, and **Send to the budget app** (copy rows or download a CSV in the same columns as Coin & Compass's BuyList tab).
- **Bought:** everything you've ticked, by month, with what you paid. Untick to put something back on the list.
- **Cooling-off:** wants over $100 show "Wait N days" for 30 days after they're added (both numbers in Settings).
- **Quick add:** type a name, or paste a product link (the shop and a name are filled in for you).

## How it works
- Sign in with Google; the page reads and writes its own tabs in your Google Sheet directly (Sheets API). No personal data is stored in this repo.
- The sheet id and OAuth Client ID are saved in your browser (Settings). The Client ID is picked up from the book library automatically on `jcm-book-library.github.io`.
- First time: **Set up sheet** adds the two 🛒 tabs with headers and default settings. It never touches any other tab.
- **Import:** Settings → *Import from Priorities, Purchases, Clothing and Household tabs*. It reads those tabs (never changes them), merges items that appear on more than one tab, skips anything already imported, and shows the list for you to untick before anything is written.

## Sheet tabs
| Tab | Columns |
|---|---|
| 🛒 Items | id, Item, Category, Subcategory, Room, Need or want, Priority, Status, Time frame, Price each, Qty, Sale price each, Paid total, Retailer, Link, Image, Stickers, Pay in 4, Notes, Date added, Date bought, Order, Source, Active |
| 🛒 Settings | Key, Value, Notes (`categories`, `windows`, `stickers`, `cooling_off_days`, `cooling_off_threshold`, `budget:<Category>`) |

Status is one of Idea, Planned, Waiting for sale, Bought, Dropped (the same as Coin & Compass). Keep the column order; rows can be edited or sorted by hand, the page finds rows by id.

## Files
| File | What it is |
|---|---|
| `app.html` | The only source. Pure logic sits between `LOGIC START` / `LOGIC END`. |
| `index.html` | Built from `app.html` by `python3 tools/build-pages.py`. Don't edit by hand. |
| `tools/test-logic.js` | Unit tests for the logic block, including the importer. |
| `tools/test.js` | Headless Chromium test against a fake, in-memory Sheets API. |
| `manifest.webmanifest`, `icons/` | Home-screen install. |

## Testing
```
python3 tools/build-pages.py
node tools/test-logic.js
NODE_PATH=$(npm root -g) node tools/test.js /tmp/wn-shots
```

## Ideas for later
Price history while waiting for a sale, a wardrobe gap grid (colours × garment types, like the Clothing tab), "buy with" bundles, and merging into Coin & Compass.
