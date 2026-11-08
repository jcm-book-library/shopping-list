// Headless test: serves index.html with a fake Sheets API held in memory. Never touches real Google.
// Run: python3 tools/build-pages.py && NODE_PATH=$(npm root -g) node tools/test.js /tmp/wn-shots
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

/* "Today" is Sat 7 Nov 2026, 10:00 local, everywhere. */
const T = '2026-11-07';
const serial = s => { const [y, m, d] = s.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5); };
const SERIAL_RE = /^\d{4}-\d{2}-\d{2}$/;
const ITEMS = '🛒 Items', SETTINGS = '🛒 Settings', JOBS = '🛒 Stocktakes', STOCK = '🛒 Stock';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
}

/* ---------- fake database ---------- */
const COLS = ['id', 'item', 'cat', 'sub', 'room', 'kind', 'prio', 'status', 'window', 'cost', 'qty', 'sale', 'final', 'retailer', 'link', 'image', 'stickers', 'pay4', 'notes', 'added', 'bought', 'order', 'source', 'active'];
const HEADS = {
  [ITEMS]: ['id', 'Item', 'Category', 'Subcategory', 'Room', 'Need or want', 'Priority', 'Status', 'Time frame', 'Price each', 'Qty', 'Sale price each', 'Paid total', 'Retailer', 'Link', 'Image', 'Stickers', 'Pay in 4', 'Notes', 'Date added', 'Date bought', 'Order', 'Source', 'Active'],
  [SETTINGS]: ['Key', 'Value', 'Notes'],
  [JOBS]: ['id', 'Stocktake', 'Category', 'Subcategories', 'Status', 'Started', 'Last checked', 'Notes', 'Active'],
  [STOCK]: ['id', 'Stocktake id', 'Subcategory', 'Item', 'Qty', 'Condition', 'Detail', 'Where', 'Notes', 'Last checked', 'Shopping id', 'Active']
};
const JCOLS = ['id', 'name', 'cat', 'subs', 'status', 'started', 'checked', 'notes', 'active'];
const SCOLS = ['id', 'job', 'sub', 'item', 'qty', 'cond', 'detail', 'where', 'notes', 'checked', 'shop', 'active'];
const stockRow = (id, o) => { const d = { id, job: 1, sub: '', item: '', qty: 1, cond: 'Good', detail: '', where: '', notes: '', checked: '', shop: '', active: true, ...o }; return SCOLS.map(c => d[c]); };
const jobRow = (id, o) => { const d = { id, name: '', cat: 'Clothing', subs: '', status: 'Open', started: serial('2026-10-01'), checked: '', notes: '', active: true, ...o }; return JCOLS.map(c => d[c]); };
const rowsOf = (db, tab, cols) => db.tabs[tab].slice(1).filter(r => r[0] !== '' && r[0] != null).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
const stockOf = (db, id) => rowsOf(db, STOCK, SCOLS).find(r => r.id === id);
const jobOf = (db, id) => rowsOf(db, JOBS, JCOLS).find(r => r.id === id);
const stockSeed = () => {
  const t = seedTabs(true);
  t[JOBS] = [HEADS[JOBS].slice()]; t[STOCK] = [HEADS[STOCK].slice()];
  return t;
};
const letter = c => String.fromCharCode(65 + COLS.indexOf(c));
const IMPORT_NAMES = ['Priorities', 'Purchases', 'Clothing', 'Household'];
const blank = n => Array(n).fill('');
function item(id, o) { // a sheet row
  const d = { id, item: '', cat: 'Other', sub: '', room: '', kind: 'Want', prio: '', status: 'Planned', window: '', cost: '', qty: '', sale: '', final: '', retailer: '', link: '', image: '', stickers: '', pay4: false, notes: '', added: serial('2026-10-01'), bought: '', order: id * 1000, source: '', active: true, ...o };
  return COLS.map(c => d[c]);
}
function seedTabs(full) {
  const tabs = {};
  for (const k of [ITEMS, SETTINGS]) tabs[k] = [HEADS[k].slice()];
  if (!full) return tabs;
  tabs[ITEMS].push(
    item(1, { item: 'Standing desk', cat: 'Office', kind: 'Need', prio: 1, window: 'Black Friday', cost: 1200 }),
    item(2, { item: 'Ergonomic chair', cat: 'Office', kind: 'Need', prio: 1, window: 'Black Friday', cost: 700, sale: 595 }),
    item(3, { item: 'Merino socks', cat: 'Clothing', kind: 'Need', prio: 2, cost: 35, qty: 3 }),
    item(4, { item: 'Wax jacket', cat: 'Clothing', kind: 'Want', prio: 2, cost: 549, added: serial('2026-10-28') }),
    item(5, { item: 'Towel set', cat: 'Household', kind: 'Need', cost: 160, order: 9000 }),
    item(6, { item: 'Cat water fountain', cat: 'Pet', kind: 'Need', cost: 70 }),
    item(12, { item: 'Turntable', cat: 'Entertainment', kind: 'Want', cost: 729, added: serial('2026-06-01'), order: 12000 }),
    item(8, { item: 'Work pants', cat: 'Clothing', kind: 'Need', status: 'Bought', cost: 300, final: 300, bought: serial('2026-11-01') }),
    blank(24), blank(24));
  return tabs;
}
const rowOf = (db, id) => db.tabs[ITEMS].findIndex((r, i) => i > 0 && r[0] === id) + 1; // 1-based sheet row
const obj = (db, id) => { const r = db.tabs[ITEMS][rowOf(db, id) - 1]; return Object.fromEntries(COLS.map((c, i) => [c, r[i]])); };

function parseA1(r) { // "'🛒 Items'!A2:X", "'🛒 Items'!A5:X5"
  const i = r.lastIndexOf('!'); let tab = r.slice(0, i); if (tab.startsWith("'")) tab = tab.slice(1, -1).replace(/''/g, "'");
  const [a, b] = r.slice(i + 1).split(':');
  const p = s => { const m = s.match(/^([A-Z]+)(\d*)$/); return { c: m[1].charCodeAt(0) - 65, r: m[2] ? Number(m[2]) : null }; };
  const A = p(a), B = b ? p(b) : A; return { tab, r0: A.r, c0: A.c, r1: B.r, c1: B.c };
}
function userEntered(v) {
  if (typeof v === 'string') {
    if (SERIAL_RE.test(v)) return serial(v);
    if (v.startsWith("'")) return v.slice(1);
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v === 'TRUE') return true;
    if (v === 'FALSE') return false;
  }
  return v;
}
const trim = row => { const r = row.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] == null)) r.pop(); return r; };
const BAD_REQ = /deleteDimension|deleteRange|deleteSheet|sortRange|insertDimension|moveDimension|cutPaste|clear|updateSheetProperties|deleteNamedRange/i;

/* ---------- scenario runner ---------- */
const browserP = chromium.launch();
const MIME = { '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function scenario(name, opts, fn) {
  console.log('--- ' + name);
  const b = await browserP;
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [], calls = [], stray = [];
  const db = { tabs: opts.tabs || {}, imp: opts.imp || {}, sids: {}, rowCount: {} };
  let nextSid = 100;
  Object.keys(db.tabs).forEach(k => { db.sids[k] = nextSid++; db.rowCount[k] = 1000; });
  IMPORT_NAMES.forEach(k => { if (db.imp[k]) { db.sids[k] = nextSid++; db.rowCount[k] = 1000; } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.setFixedTime(new Date(2026, 10, 7, 10, 0, 0));
  await page.route('**/*', r => { const u = r.request().url(); if (!u.startsWith('data:')) stray.push(u); return r.abort(); });
  await page.route(/^https:\/\/wn\.test\//, r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: HTML });
    const f = path.join(ROOT, u.pathname);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route(/accounts\.google\.com/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route(/www\.google\.com\/s2\/favicons/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route(/sheets\.googleapis\.com/, async r => {
    const u = new URL(r.request().url()), method = r.request().method();
    const p = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    const post = r.request().postData(); calls.push({ method, path: p, query: u.search, body: post ? JSON.parse(post) : null });
    const json = (o, status) => r.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
    const bad = m => json({ error: { message: m } }, 400);
    if (p === '') {
      const fields = u.searchParams.get('fields') || '';
      if (fields.includes('rowData')) { // import read: formatted values + hyperlinks
        const sheets = u.searchParams.getAll('ranges').map(rg => {
          const a = parseA1(rg); const rows = db.imp[a.tab]; if (!rows) return null;
          return { properties: { title: a.tab }, data: [{ rowData: rows.map(row => ({ values: row.slice(a.c0, a.c1 + 1).map(c => { const o = {}; if (c.v) o.formattedValue = c.v; if (c.h) o.hyperlink = c.h; return o; }) })) }] };
        }).filter(Boolean);
        return json({ sheets });
      }
      const titles = Object.keys(db.tabs).concat(IMPORT_NAMES.filter(k => db.imp[k]));
      return json({ sheets: titles.map(t => ({ properties: { sheetId: db.sids[t], title: t, gridProperties: { rowCount: db.rowCount[t] } } })) });
    }
    if (p === '/values:batchGet') {
      const out = [];
      for (const rg of u.searchParams.getAll('ranges')) {
        const a = parseA1(rg); if (!db.tabs[a.tab]) return bad('no tab ' + a.tab);
        const vals = db.tabs[a.tab].slice(a.r0 - 1).map(row => trim(row.slice(a.c0, a.c1 + 1)));
        while (vals.length && !vals[vals.length - 1].length) vals.pop();
        out.push(vals.length ? { range: rg, values: vals } : { range: rg });
      }
      return json({ valueRanges: out });
    }
    if (p === '/values:batchUpdate') {
      const b = JSON.parse(post); if (b.valueInputOption !== 'USER_ENTERED') return bad('valueInputOption');
      for (const d of b.data) {
        const a = parseA1(d.range); if (!db.tabs[a.tab]) return bad('no tab');
        d.values.forEach((rv, i) => { const ri = a.r0 - 1 + i; while (db.tabs[a.tab].length <= ri) db.tabs[a.tab].push([]); rv.forEach((v, j) => { db.tabs[a.tab][ri][a.c0 + j] = userEntered(v); }); });
      }
      return json({ totalUpdatedCells: b.data.length });
    }
    if (p.startsWith('/values/')) {
      const a = parseA1(p.slice(8)); if (!db.tabs[a.tab]) return bad('no tab ' + a.tab);
      if (method === 'GET') return json({ values: db.tabs[a.tab].slice(a.r0 - 1).map(row => { const v = row[a.c0]; return v === '' || v == null ? [] : [v]; }) });
      if (method === 'PUT') {
        if (u.searchParams.get('valueInputOption') !== 'USER_ENTERED') return bad('valueInputOption');
        const vals = JSON.parse(post).values;
        vals.forEach((rv, i) => { const ri = a.r0 - 1 + i; while (db.tabs[a.tab].length <= ri) db.tabs[a.tab].push([]); rv.forEach((v, j) => { db.tabs[a.tab][ri][a.c0 + j] = userEntered(v); }); });
        return json({ updatedRows: vals.length });
      }
    }
    if (p === ':batchUpdate') {
      const replies = [];
      for (const q of JSON.parse(post).requests) {
        if (q.addSheet) { const t = q.addSheet.properties.title; if (db.tabs[t]) return bad('exists'); db.tabs[t] = []; db.sids[t] = nextSid++; db.rowCount[t] = 1000; replies.push({ addSheet: { properties: { sheetId: db.sids[t], title: t, gridProperties: { rowCount: 1000 } } } }); }
        else if (q.appendDimension) { const t = Object.keys(db.sids).find(k => db.sids[k] === q.appendDimension.sheetId); db.rowCount[t] += q.appendDimension.length; replies.push({}); }
        else return bad('unsupported request ' + Object.keys(q));
      }
      return json({ replies });
    }
    return bad('unhandled ' + method + ' ' + p);
  });
  const cfg = { clientId: 'abc.apps.googleusercontent.com', sheetId: 'TESTSHEET1234567890abc' };
  if (opts.token !== false) await page.addInitScript(([exp, c]) => {
    localStorage.setItem('jm-google-token', JSON.stringify({ t: 'x', exp }));
    localStorage.setItem('wn_config', JSON.stringify(c));
  }, [new Date(2026, 10, 8).getTime(), cfg]);
  await page.goto('https://wn.test/' + (opts.query || ''));
  const settle = async () => { await page.waitForTimeout(100); await page.waitForSelector('#status:not([data-state=loading])', { timeout: 8000 }); await page.waitForTimeout(80); };
  const ctxo = { page, db, calls, settle, errors };
  try { await fn(ctxo); } catch (e) { check(name + ': ran without throwing', false, String(e.message).split('\n')[0]); }
  check(name + ': no console or page errors', errors.length === 0, errors);
  check(name + ': no destructive or sorting requests', !calls.some(c => BAD_REQ.test(JSON.stringify(c.body || {}))), calls.filter(c => BAD_REQ.test(JSON.stringify(c.body || {}))));
  check(name + ': no stray network requests', stray.length === 0, stray);
  await ctx.close();
}
const text = (page, sel) => page.locator(sel).first().innerText();
const writes = calls => calls.filter(c => c.method !== 'GET');
const live = page => page.waitForSelector('#status[data-state=live]', { timeout: 8000 });
const showBoard = async page => { await page.waitForSelector('.board .card'); };

/* synthetic import fixtures (made up) */
const R = arr => arr.map(v => (typeof v === 'object' ? v : { v, h: '' }));
const H = (url, text) => ({ v: text || url, h: url });
const importTabs = () => ({
  Household: [
    R(['Item', 'Room', 'Status', 'When', 'Priority', 'Category', 'Retailer', 'Final cost', 'Budget cost', 'Low', 'Premium', 'Notes']),
    R(['Zeta Lamp Alpha', 'Lounge', 'To buy', 'Black Friday', '1', 'Appliance', '#N/A', '', '$120.00', '', '', H('https://shop.example.com/lamp', 'see lamp')]),
    R(['Corner Bookshelf Unit', 'Study', 'To buy', 'TBA', '2', 'Furniture', '#N/A', '', '$250.00', '', '', 'Needs to fit alcove']),
    R(['Reading Light Duo', 'Bedroom', 'To buy', '', '3', 'Lighting', 'Lamp Co', '', '$40.00', '', '', '']),
    R(['Reading Light Duo', 'Spare room', 'To buy', '', '3', 'Lighting', 'Lamp Co', '', '$40.00', '', '', '']),
    R(['Old Kettle Thing', 'Kitchen', 'Bought', '', '2', 'Appliance', 'Kitchen Co', '$55.00', '', '', '', ''])
  ],
  Purchases: [
    R(['Product', 'Category', 'Sub', 'Approx Total', 'Importance', 'Move Sheet', 'Purchased', 'When to Purchase', 'Pay in 4', 'Unit Cost', 'Units', 'Purchase From', 'Date Added', 'Link', 'Notes', 'Online/Instore']),
    R(['Ceiling Fan Pair', 'Home', 'Lighting', '$900', '2', 'x', 'FALSE', 'Wait for sale', '✅', '$300', '3', 'Fan Store', '21 Mar', H('https://fans.example.com/p', 'HERE'), 'Fit all at once', 'Online']),
    R(['Gadget Hub Bought', 'Office', '', '$40', '1', '', 'TRUE', '', '', '', '', '', '30 Dec', '', '', 'Instore']),
    R(['Zeta Lamp Alpha', 'Home', '', '$110', '2', '', 'FALSE', '', '', '', '', 'Lamp Co', '', '', 'Warm light', 'Online'])
  ],
  Priorities: [
    R(['', 'PRIOR TO MOVE', 'Why?', 'Cost']),
    R(['FALSE', 'Corner Bookshelf', 'Storage', '$260.00']),
    R(['TRUE', 'Standing Desk Frame', 'Work', '$500.00', '$450.00', 'Desk Co', 'Black Friday', '', 'https://desk.example.com/frame']),
    R(['FALSE', 'PRIOR TO FEB', 'Why?']),
    R(['FALSE', 'Cat Water Fountain', 'Pet hydration', '$70.00']),
    R(['FALSE', 'Once Moved']),
    R(['FALSE', 'Doormat Large', 'Entry', '$59.00'])
  ],
  Clothing: [
    R(['Acme', 'Trail Boots', H('https://acme.example.com/boots', 'link'), 'M 10', '$28.00']),
    R(['Wool Beanie', H('https://b.example.com/beanie')]),
    R(['Tshirts -- add white and beige for summer layering and more']),
    []
  ]
});

(async () => {
  /* a. empty sheet: gate, then set up */
  const other = [['Name', 'Qty'], ['Hello', 3]];
  await scenario('setup', { tabs: { Other: JSON.parse(JSON.stringify(other)) } }, async ({ page, db, calls, settle }) => {
    await page.waitForSelector('#gate [data-act=setup]');
    check('setup: gate says Set up sheet', (await text(page, '#gate')).includes('Set up sheet'));
    check('setup: app hidden until set up', !(await page.locator('#stats').isVisible()));
    const before = calls.length;
    await page.click('[data-act=setup]'); await page.waitForSelector('#askDlg[open]');
    const listed = await page.locator('#askBody li').allInnerTexts();
    check('setup: confirm lists both tabs', JSON.stringify(listed) === JSON.stringify([ITEMS, SETTINGS]), listed);
    check('setup: nothing written before confirming', calls.length === before);
    await page.click('#askYes'); await live(page); await page.waitForTimeout(200);
    const added = Object.keys(db.tabs).filter(k => k !== 'Other');
    check('setup: adds exactly both tabs', added.length === 2 && added.includes(ITEMS) && added.includes(SETTINGS), added);
    check('setup: header rows written', [ITEMS, SETTINGS].every(k => JSON.stringify(db.tabs[k][0]) === JSON.stringify(HEADS[k])), [ITEMS, SETTINGS].map(k => db.tabs[k][0]));
    const st = db.tabs[SETTINGS].slice(1).map(r => r[0] + '=' + r[1]);
    check('setup: default settings rows', st.length === 5 && st[0].startsWith('categories=Clothing, Household') && st[1].startsWith('windows=Now, Pre-move') && st[3] === 'cooling_off_days=30' && st[4] === 'cooling_off_threshold=100', st);
    check('setup: unrelated tab untouched', JSON.stringify(db.tabs.Other) === JSON.stringify(other));
    const w = writes(calls);
    check('setup: only addSheet + writes to the new tabs', w.every(c => (c.path === ':batchUpdate' && c.body.requests.every(q => q.addSheet && q.addSheet.properties.title.startsWith('🛒'))) || (c.method === 'PUT' && c.path.includes('🛒'))), w.map(c => c.method + c.path));
    check('setup: board shows empty state, gate gone', await page.locator('#gate').isHidden() && await page.locator('#stats').isVisible());
    check('setup: stats start at $0', (await text(page, '#stats .stat .v')) === '$0');
  });

  /* b. seeded: render, quick add, link paste */
  await scenario('board', { tabs: seedTabs(true) }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    const heads = await page.locator('.col-head .nm').allInnerTexts();
    check('board: one column per used category, in settings order', JSON.stringify(heads) === JSON.stringify(['Clothing', 'Household', 'Office', 'Entertainment', 'Pet']), heads);
    const tiles = await page.locator('#stats .stat').evaluateAll(els => els.map(e => [e.querySelector('.k').textContent, e.querySelector('.v').textContent, e.querySelector('.s').textContent]));
    check('board: To buy tile = $3,408 over 7 items', tiles[0][0] === 'To buy' && tiles[0][1] === '$3,408' && tiles[0][2] === '7 items', tiles[0]);
    check('board: Needs / Wants / Bought-this-month tiles', tiles[1][1] === '$2,130' && tiles[2][1] === '$1,278' && tiles[3][1] === '$300', tiles.slice(1));
    check('board: bought item not on board', (await page.locator('.card[data-id="8"]').count()) === 0);
    check('board: sale price shown struck-through original', (await text(page, '.card[data-id="2"] .c-price')).replace(/\s+/g, '') === '$700$595', await text(page, '.card[data-id="2"] .c-price'));
    check('board: qty shown as 3 x $35 = $105', (await text(page, '.card[data-id="3"] .c-price')).replace(/\s+/g, '') === '3×$35$105', await text(page, '.card[data-id="3"] .c-price'));
    check('board: cooling-off tag on recent want over $100', (await text(page, '.card[data-id="4"] .c-tags')).includes('Wait 20 days'));
    check('board: no cooling tag on old want', !(await text(page, '.card[data-id="12"] .c-tags')).includes('Wait'));
    await page.screenshot({ path: path.join(OUT, 'board-1280.png'), fullPage: true });

    let m = calls.length;
    await page.selectOption('#qaCat', 'Pet'); await page.click('[data-qk=Need]');
    await page.fill('#qaItem', 'Desk lamp'); await page.fill('#qaPrice', '$45');
    await page.click('#quickAdd button[type=submit]'); await settle();
    let w = writes(calls.slice(m));
    check('quick add: one append (PUT), nothing else written', w.length === 1 && w[0].method === 'PUT', w.map(c => c.method + c.path));
    check('quick add: appended on row 10 (below last filled row), not in the blank gap', w[0] && w[0].path.includes('!A10:X10'), w[0] && w[0].path);
    const r = obj(db, 13);
    check('quick add: id = max + 1 (13, not last+1)', rowOf(db, 13) === 10, rowOf(db, 13));
    check('quick add: fields', r.item === 'Desk lamp' && r.cat === 'Pet' && r.kind === 'Need' && r.cost === 45 && r.status === 'Planned' && r.added === serial(T) && r.order === 13000 && r.active === true, r);
    check('quick add: card appears and inputs cleared', (await page.locator('.card[data-id="13"]').count()) === 1 && (await page.inputValue('#qaItem')) === '');
    check('quick add: stats updated to $3,453', (await text(page, '#stats .stat .v')) === '$3,453');

    m = calls.length;
    await page.fill('#qaItem', 'https://www.jbhifi.com.au/products/philips-34e1c5600he-34-curved-monitor');
    await page.click('#quickAdd button[type=submit]'); await settle();
    const r2 = obj(db, 14);
    check('url paste: name from slug, retailer, link filled', r2 && r2.item.includes('Philips') && r2.retailer === 'Jbhifi' && r2.link === 'https://www.jbhifi.com.au/products/philips-34e1c5600he-34-curved-monitor', r2);
    check('url paste: appended on row 11', rowOf(db, 14) === 11 && writes(calls.slice(m))[0].path.includes('!A11:X11'), writes(calls.slice(m)).map(c => c.path));
    check('url paste: only the new row written', writes(calls.slice(m)).length === 1);
    check('quick add: ids 1-12 untouched', [1, 2, 3, 4, 5, 6, 12, 8].every(id => obj(db, id).item));
  });

  /* c. tick a card */
  await scenario('tick', { tabs: seedTabs(true) }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    const m = calls.length, row = rowOf(db, 1);
    await page.check('[data-tick="1"]'); await settle();
    const w = writes(calls.slice(m));
    check('tick: exactly one write, a values:batchUpdate', w.length === 1 && w[0].path === '/values:batchUpdate' && w[0].method === 'POST', w.map(c => c.method + c.path));
    const d = w[0].body.data;
    check('tick: one range, spans only Status..Date bought of that row', d.length === 1 && d[0].range === `'${ITEMS}'!${letter('status')}${row}:${letter('bought')}${row}`, d.map(x => x.range));
    const o = obj(db, 1);
    check('tick: Status Bought, Date bought serial of today, Paid total = 1200', o.status === 'Bought' && o.bought === serial(T) && o.final === 1200, o);
    check('tick: other cells unchanged', o.item === 'Standing desk' && o.cat === 'Office' && o.cost === 1200 && o.order === 1000 && o.id === 1, o);
    check('tick: card left the board', (await page.locator('.card[data-id="1"]').count()) === 0);
    await page.click('[data-view=bought]');
    const bt = await text(page, '#bought');
    check('tick: shows in Bought view under Nov 2026', bt.includes('Standing desk') && bt.includes('Nov 2026'), bt.slice(0, 200));
    check('tick: Bought tile includes it ($1,500)', (await text(page, '#stats .stat:nth-child(4) .v')) === '$1,500');
    // sale price: paid = sale
    await page.click('[data-view=board]'); await showBoard(page);
    await page.check('[data-tick="2"]'); await settle();
    check('tick: sale item pays sale price', obj(db, 2).final === 595, obj(db, 2));
    // untick from the Bought view
    await page.click('[data-view=bought]');
    const m2 = calls.length;
    await page.uncheck('[data-tick="1"]'); await settle();
    const o2 = obj(db, 1);
    check('untick: back to Planned, date and paid cleared', o2.status === 'Planned' && o2.bought === '' && (o2.final === '' || o2.final == null), o2);
    check('untick: single batchUpdate write', writes(calls.slice(m2)).length === 1 && writes(calls.slice(m2))[0].path === '/values:batchUpdate');
  });

  /* d. single-cell edits */
  await scenario('cell edits', { tabs: seedTabs(true) }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    const single = (w, id, col) => w.length === 1 && w[0].path === '/values:batchUpdate' && w[0].body.data.length === 1 && w[0].body.data[0].range === `'${ITEMS}'!${letter(col)}${rowOf(db, id)}:${letter(col)}${rowOf(db, id)}`;
    const snap = () => JSON.stringify(db.tabs[ITEMS]);
    let m = calls.length, s0 = snap();
    await page.click('[data-flip="2"]'); await settle();
    let w = writes(calls.slice(m));
    check('flip: writes only the Need/Want cell', single(w, 2, 'kind'), w.map(c => c.body && c.body.data.map(d => d.range)));
    check('flip: Need -> Want', obj(db, 2).kind === 'Want');
    const diff = (a, b) => { const A = JSON.parse(a), B = JSON.parse(b); let n = 0; A.forEach((r, i) => r.forEach((v, j) => { if (JSON.stringify(v) !== JSON.stringify(B[i][j])) n++; })); return n; };
    check('flip: exactly one cell in the sheet changed', diff(s0, snap()) === 1, diff(s0, snap()));
    check('flip: pill shows Want', (await page.locator('[data-flip="2"]').textContent()) === 'Want');
    await page.click('[data-flip="2"]'); await settle();
    check('flip: back to Need', obj(db, 2).kind === 'Need');

    // open the drawer by tapping the card meta, then pick a category chip
    await page.click('.card[data-id="3"] .c-meta');
    check('drawer: card opens', await page.locator('.card[data-id="3"].open').count() === 1);
    m = calls.length; s0 = snap();
    await page.click('.card[data-id="3"] [data-setcat="3"][data-v="Household"]'); await settle();
    w = writes(calls.slice(m));
    check('category chip: writes only the Category cell', single(w, 3, 'cat'), w.map(c => c.body && c.body.data.map(d => d.range)));
    check('category chip: Category = Household, one cell changed', obj(db, 3).cat === 'Household' && diff(s0, snap()) === 1, obj(db, 3));
    check('category chip: card now in Household column', (await page.locator('.col:has(.col-head .nm:text-is("Household")) .card[data-id="3"]').count()) === 1);

    // note
    m = calls.length; s0 = snap();
    const ta = page.locator('.card[data-id="3"] [data-note="3"]');
    await ta.fill('Check wool blend'); await ta.evaluate(el => el.blur()); await settle();
    w = writes(calls.slice(m));
    check('note: blur writes only the Notes cell', single(w, 3, 'notes'), w.map(c => c.body && c.body.data.map(d => d.range)));
    check('note: saved text, one cell changed', obj(db, 3).notes === 'Check wool blend' && diff(s0, snap()) === 1, obj(db, 3).notes);
    m = calls.length;
    await page.locator('.card[data-id="3"] [data-note="3"]').evaluate(el => { el.focus(); el.blur(); }); await page.waitForTimeout(150);
    check('note: blur without change writes nothing', writes(calls.slice(m)).length === 0);
    // time frame select
    m = calls.length;
    await page.selectOption('.card[data-id="3"] [data-win="3"]', 'Q1'); await settle();
    w = writes(calls.slice(m));
    check('time frame select: writes only the Time frame cell', single(w, 3, 'window') && obj(db, 3).window === 'Q1', w.map(c => c.body && c.body.data.map(d => d.range)));
  });

  /* e. safety */
  await scenario('safety', { tabs: seedTabs(true) }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    // someone sorts the sheet: rows of id 2 and id 3 swap places
    const t = db.tabs[ITEMS], i2 = rowOf(db, 2) - 1, i3 = rowOf(db, 3) - 1;
    [t[i2], t[i3]] = [t[i3], t[i2]];
    const before = JSON.stringify(t), m = calls.length;
    await page.click('[data-flip="2"]'); await settle();
    check('safety: no write sent when the row moved underneath', writes(calls.slice(m)).length === 0, writes(calls.slice(m)).map(c => c.path));
    check('safety: sheet unchanged', JSON.stringify(t) === before);
    const n = await text(page, '#notice');
    check('safety: notice shown explaining the sheet changed', (await page.locator('#notice').isVisible()) && /sheet changed/i.test(n), n);
    check('safety: status says not saved', (await text(page, '#statusText')) === 'Not saved');
    check('safety: app refreshed from the sheet (chair now where the sheet says)', (await page.locator('.card[data-id="2"]').count()) === 1);
    // now fine again after the refresh
    await page.click('[data-flip="2"]'); await settle();
    check('safety: after the refresh the same edit goes through', obj(db, 2).kind === 'Want');
    // id cell blanked underneath a later edit
    const i5 = rowOf(db, 5) - 1; t[i5][0] = '';
    const m2 = calls.length;
    await page.click('[data-flip="5"]'); await settle();
    check('safety: blanked id column also refuses', writes(calls.slice(m2)).length === 0 && /sheet changed/i.test(await text(page, '#notice')));
    // drag-drop save also goes through the same check
    check('safety: never any deleteDimension or sort requests (all calls)', !calls.some(c => /deleteDimension|sortRange|moveDimension/.test(JSON.stringify(c.body || {}))));
  });

  /* f. drag and drop */
  await scenario('drag', { tabs: seedTabs(true), viewport: { width: 1280, height: 1800 } }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    const dragTo = async (fromSel, toSel, frac) => {
      const fb = await page.locator(fromSel).boundingBox();
      await page.mouse.move(fb.x + 40, fb.y + fb.height / 2); await page.mouse.down();
      await page.mouse.move(fb.x + 60, fb.y + fb.height / 2 + 12, { steps: 4 });
      await page.waitForSelector('.card.dragging');
      let tb = await page.locator(toSel).boundingBox();
      await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
      await page.waitForTimeout(450);
      tb = await page.locator(toSel).boundingBox(); // the card under the pointer may have grown (hover drawer)
      await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * frac, { steps: 6 });
      await page.waitForSelector('.drop-line');
      await page.mouse.up(); await settle();
    };
    // Household -> bottom of the Clothing column (tall viewport: hovered cards expand their drawer)
    let m = calls.length;
    await dragTo('.card[data-id="5"] .c-meta', '.card[data-id="4"]', 0.9);
    let w = writes(calls.slice(m)), o = obj(db, 5);
    check('drag: category changed to Clothing', o.cat === 'Clothing', o);
    check('drag: Order set below the last card (5000)', o.order === 5000, o.order);
    check('drag: one batchUpdate; only Category..Order cells in that row', w.length === 1 && w[0].path === '/values:batchUpdate' && w[0].body.data.length === 1 && w[0].body.data[0].range === `'${ITEMS}'!${letter('cat')}${rowOf(db, 5)}:${letter('order')}${rowOf(db, 5)}`, w.map(c => c.body && c.body.data.map(d => d.range)));
    check('drag: item name etc. intact', o.item === 'Towel set' && o.cost === 160 && o.kind === 'Need');
    check('drag: card now sits last in the Clothing column', (await page.locator('.col:has(.col-head .nm:text-is("Clothing")) .card').evaluateAll(els => els.map(e => e.dataset.id))).join() === '3,4,5');
    check('drag: Household column gone (empty)', (await page.locator('.col-head .nm:text-is("Household")').count()) === 0);
    // reorder inside a column: chair (2) above desk (1): drop onto the top half of desk
    m = calls.length;
    await dragTo('.card[data-id="2"] .c-meta', '.card[data-id="1"]', 0.1);
    w = writes(calls.slice(m)); o = obj(db, 2);
    check('drag: same-column reorder sets Order only (0 = 1000 - 1000)', o.order === 0 && o.cat === 'Office' && w.length === 1 && w[0].body.data[0].range === `'${ITEMS}'!${letter('order')}${rowOf(db, 2)}:${letter('order')}${rowOf(db, 2)}`, { o: o.order, w: w.map(c => c.body && c.body.data.map(d => d.range)) });
    check('drag: Office column order is now chair, desk', (await page.locator('.col:has(.col-head .nm:text-is("Office")) .card').evaluateAll(els => els.map(e => e.dataset.id))).join() === '2,1');
    check('drag: a plain click does not move or write', await (async () => { const k = calls.length; await page.click('.card[data-id="1"] .c-meta'); await page.waitForTimeout(150); return writes(calls.slice(k)).length === 0; })());
  });

  /* g. import */
  const s = seedTabs(true);
  await scenario('import', { tabs: s, imp: importTabs() }, async ({ page, db, calls, settle }) => {
    await live(page);
    const srcBefore = JSON.stringify(db.imp), itemsBefore = db.tabs[ITEMS].filter(r => r[0] !== '' && r[0] != null).length - 1;
    await page.click('#settingsBtn'); await page.waitForSelector('#setDlg[open]');
    const m = calls.length;
    await page.click('#sImport'); await page.waitForSelector('#impDlg[open]');
    const reads = calls.slice(m);
    check('import: reads the four tabs with one GET (formatted value + hyperlink)', reads.length === 1 && reads[0].method === 'GET' && decodeURIComponent(reads[0].query).includes('hyperlink') && IMPORT_NAMES.every(n => decodeURIComponent(reads[0].query).includes(`'${n}'!`)), reads.map(c => c.query));
    const labels = await page.locator('#impList label').allInnerTexts();
    check('import: dialog lists 10 items (2 already here skipped)', labels.length === 10, labels.length);
    check('import: summary mentions merged + skipped', /2 duplicates/.test(await text(page, '#impSum')) && /2 items already here/.test(await text(page, '#impSum')), await text(page, '#impSum'));
    const joined = labels.join('\n');
    check('import: merged row shows both sources', joined.includes('Household 3; Priorities 2'));
    check('import: already-existing items not listed', !joined.includes('Cat Water Fountain') && !joined.includes('Standing Desk Frame'));
    check('import: advice row not listed', !/Tshirts/.test(joined));
    await page.screenshot({ path: path.join(OUT, 'import-dialog.png') });
    await page.click('#impGo'); await settle();
    const w = writes(calls.slice(m));
    check('import: exactly one write, an append PUT to 🛒 Items', w.length === 1 && w[0].method === 'PUT' && w[0].path.includes("'🛒 Items'!A"), w.map(c => c.method + c.path));
    check('import: no write to any of the four source tabs', calls.every(c => c.method === 'GET' || !/Priorities|Purchases|Clothing'|Household'/.test(c.path)), calls.filter(c => c.method !== 'GET').map(c => c.path));
    check('import: source tabs unchanged', JSON.stringify(db.imp) === srcBefore);
    const rows = db.tabs[ITEMS].filter(r => r[0] !== '' && r[0] != null).slice(1);
    check('import: 10 new rows appended after the existing ones', rows.length === itemsBefore + 10, rows.length);
    const imp = rows.filter(r => r[0] > 12).map(r => Object.fromEntries(COLS.map((c, i) => [c, r[i]])));
    check('import: new ids run 13..22 contiguous', imp.map(r => r.id).join() === Array.from({ length: 10 }, (_, i) => 13 + i).join(), imp.map(r => r.id));
    check('import: orders ascend above the old max', imp.every((r, i) => r.order > 12000 && (!i || r.order > imp[i - 1].order)), imp.map(r => r.order));
    const kettle = imp.find(r => r.item === 'Old Kettle Thing'), fan = imp.find(r => r.item === 'Ceiling Fan Pair'), book = imp.find(r => r.item === 'Corner Bookshelf Unit');
    check('import: bought row -> Status Bought', kettle && kettle.status === 'Bought', kettle);
    check('import: purchases row mapped (category, window, pay4, link, date)', fan && fan.cat === 'Household' && fan.window === 'On sale' && fan.pay4 === true && fan.link === 'https://fans.example.com/p' && fan.added === serial('2026-03-21') && fan.qty === 3 && fan.cost === 300, fan);
    check('import: merged row source and window', book && book.source === 'Household 3; Priorities 2' && book.window === 'Pre-move', book);
    check('import: all appended rows are active and written as values (no formulas)', imp.every(r => r.active === true && !String(r.item).startsWith('=')));
    check('import: board shows imported cards', (await page.locator('.card', { hasText: 'Ceiling Fan Pair' }).count()) === 1);
    // re-import: nothing new
    await page.click('#settingsBtn'); await page.click('#sImport'); await page.waitForSelector('#impDlg[open]');
    check('import: running it again offers nothing new', (await page.locator('#impList label').count()) === 0 && await page.locator('#impGo').isDisabled());
  });

  /* h. stocktake: tabs missing -> setup button */
  await scenario('stock setup', { tabs: { ...seedTabs(true), Other: [['Name'], ['Hello']] } }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    check('stock setup: app loads with only Items + Settings (no gate)', await page.locator('#gate').isHidden() && (await page.locator('.card').count()) > 0);
    const snap = JSON.stringify(db.tabs);
    await page.click('[data-view=stock]');
    await page.waitForSelector('[data-act=setup-stock]');
    check('stock setup: view shows the setup button naming both tabs', (await text(page, '#stock')).includes(JOBS) && (await text(page, '#stock')).includes(STOCK));
    check('stock setup: no stocktake controls yet', (await page.locator('[data-act=newjob]').count()) === 0);
    const m = calls.length;
    await page.click('[data-act=setup-stock]'); await page.waitForSelector('#askDlg[open]');
    const listed = await page.locator('#askBody li').allInnerTexts();
    check('stock setup: confirm lists exactly the two stock tabs', JSON.stringify(listed) === JSON.stringify([JOBS, STOCK]), listed);
    check('stock setup: nothing written before confirming', calls.length === m);
    await page.click('#askYes'); await live(page); await page.waitForTimeout(200);
    const added = Object.keys(db.tabs).filter(k => ![ITEMS, SETTINGS, 'Other'].includes(k));
    check('stock setup: adds exactly the two tabs', added.length === 2 && added.includes(JOBS) && added.includes(STOCK), added);
    check('stock setup: header rows written', [JOBS, STOCK].every(k => JSON.stringify(db.tabs[k][0]) === JSON.stringify(HEADS[k])), [JOBS, STOCK].map(k => db.tabs[k][0]));
    const w = writes(calls.slice(m));
    check('stock setup: only addSheet + header PUTs on the new tabs', w.length === 3 && w.every(c => (c.path === ':batchUpdate' && c.body.requests.length === 2 && c.body.requests.every(q => q.addSheet && /Stocktakes|Stock$/.test(q.addSheet.properties.title))) || (c.method === 'PUT' && /Stock/.test(c.path))), w.map(c => c.method + c.path));
    check('stock setup: Items, Settings and Other untouched', JSON.stringify({ [ITEMS]: db.tabs[ITEMS], [SETTINGS]: db.tabs[SETTINGS], Other: db.tabs.Other }) === JSON.stringify({ [ITEMS]: JSON.parse(snap)[ITEMS], [SETTINGS]: JSON.parse(snap)[SETTINGS], Other: JSON.parse(snap).Other }));
    await page.click('[data-view=stock]'); await page.waitForSelector('[data-act=newjob]');
    check('stock setup: view now offers + New stocktake', (await page.locator('[data-act=setup-stock]').count()) === 0);
  });

  /* i. stocktake: full flow on seeded stock tabs */
  await scenario('stocktake', { tabs: stockSeed(), viewport: { width: 1280, height: 1400 } }, async ({ page, db, calls, settle }) => {
    await live(page); await showBoard(page);
    await page.click('[data-view=stock]'); await page.waitForSelector('[data-act=newjob]');
    check('stocktake: empty state, no sheet writes yet', writes(calls).length === 0 && (await text(page, '#stock')).includes('Start a stocktake'));
    // create via dialog
    await page.click('[data-act=newjob]'); await page.waitForSelector('#jobDlg[open]');
    check('stocktake: dialog category defaults to Clothing with preset subcategories', (await page.inputValue('#jCat')) === 'Clothing' && (await page.inputValue('#jSubs')).includes('Socks'), await page.inputValue('#jSubs'));
    let m = calls.length;
    await page.fill('#jName', 'My wardrobe'); await page.fill('#jSubs', 'Socks (4), Jackets');
    await page.click('#jobForm button[type=submit]'); await settle();
    let w = writes(calls.slice(m));
    check('stocktake: create = one append PUT to 🛒 Stocktakes', w.length === 1 && w[0].method === 'PUT' && w[0].path.includes(`'${JOBS}'!A`), w.map(c => c.method + c.path));
    const j = jobOf(db, 1);
    check('stocktake: job row fields', j && j.name === 'My wardrobe' && j.cat === 'Clothing' && j.subs === 'Socks (4), Jackets' && j.status === 'Open' && j.started === serial(T) && j.active === true, j);
    await page.waitForSelector('.sbox[data-sub=Socks]');
    check('stocktake: chip and two subcategory boxes (+ add box)', (await page.locator('[data-job="1"]').count()) === 1 && (await page.locator('.sbox[data-sub]').count()) === 2);
    check('stocktake: Socks box reads 0 of 4 and offers the gap buy', (await text(page, '.sbox[data-sub=Socks] .cnt')).replace(/\s+/g, ' ').includes('0 of 4') && (await page.locator('[data-gapbuy=Socks]').getAttribute('data-n')) === '4');
    // add item
    m = calls.length;
    const form = page.locator('form[data-addstock=Socks]');
    await form.locator('input[name=n]').fill('Merino crew'); await form.locator('input[name=q]').fill('6');
    await form.locator('button[type=submit]').click(); await settle();
    w = writes(calls.slice(m));
    check('add item: one append PUT to 🛒 Stock', w.length === 1 && w[0].method === 'PUT' && w[0].path.includes(`'${STOCK}'!A`), w.map(c => c.method + c.path));
    let r = stockOf(db, 1);
    check('add item: row fields', r && r.job === 1 && r.sub === 'Socks' && r.item === 'Merino crew' && r.qty === 6 && r.cond === 'Good' && r.checked === serial(T) && r.active === true, r);
    check('add item: appears in Socks box; box now 6 of 4, buy button gone', (await page.locator('.sbox[data-sub=Socks] .srow').count()) === 1 && (await text(page, '.sbox[data-sub=Socks] .cnt')).includes('6 of 4') && (await page.locator('[data-gapbuy=Socks]').count()) === 0);
    // qty: two quick bumps -> one debounced write of the final value
    m = calls.length;
    await page.click('[data-qty="1"][data-d="1"]'); await page.click('[data-qty="1"][data-d="1"]');
    await page.waitForTimeout(250);
    check('qty: nothing written during the debounce window', writes(calls.slice(m)).length === 0);
    check('qty: display already shows 8', (await text(page, '.srow[data-sid="1"] .step b')) === '8', await text(page, '.srow[data-sid="1"] .step b'));
    await page.waitForTimeout(900); await settle();
    w = writes(calls.slice(m));
    check('qty: exactly one write after the pause', w.length === 1 && w[0].path === '/values:batchUpdate', w.map(c => c.method + c.path));
    check('qty: final qty 8 stored, Last checked today', stockOf(db, 1).qty === 8 && stockOf(db, 1).checked === serial(T), stockOf(db, 1));
    // minus clamps at zero in the display only after writes; one decrement round trip
    m = calls.length;
    await page.click('[data-qty="1"][data-d="-1"]'); await page.waitForTimeout(1000); await settle();
    check('qty: decrement writes once, qty 7', writes(calls.slice(m)).length === 1 && stockOf(db, 1).qty === 7, stockOf(db, 1).qty);
    // condition
    m = calls.length;
    await page.click('[data-cond="1"]'); await settle();
    w = writes(calls.slice(m));
    check('condition: Good -> Worn, one write', stockOf(db, 1).cond === 'Worn' && w.length === 1, [stockOf(db, 1).cond, w.length]);
    await page.click('[data-cond="1"]'); await settle();
    check('condition: Worn -> Replace', stockOf(db, 1).cond === 'Replace');
    check('condition: Replace pieces leave the usable count (0 of 4, 7 to replace)', (await text(page, '.sbox[data-sub=Socks] .cnt')).replace(/\s+/g, ' ').includes('0 of 4') && (await text(page, '.sbox[data-sub=Socks] .cnt')).includes('7 to replace'), await text(page, '.sbox[data-sub=Socks] .cnt'));
    await page.click('[data-cond="1"]'); await settle();
    check('condition: Replace -> Good', stockOf(db, 1).cond === 'Good');
    // detail edit through the drawer
    await page.click('.srow[data-sid="1"] .srow-top .c-main');
    check('drawer: row opens', (await page.locator('.srow[data-sid="1"].open').count()) === 1);
    m = calls.length;
    await page.fill('[data-sf=detail][data-sid="1"]', 'Navy, size L'); await page.locator('[data-sf=detail][data-sid="1"]').evaluate(el => el.blur()); await settle();
    check('detail: saved on change with one write', stockOf(db, 1).detail === 'Navy, size L' && writes(calls.slice(m)).length === 1, stockOf(db, 1));
    check('detail: other stock fields intact', stockOf(db, 1).item === 'Merino crew' && stockOf(db, 1).qty === 7 && stockOf(db, 1).sub === 'Socks');
    m = calls.length;
    await page.locator('[data-sf=detail][data-sid="1"]').evaluate(el => { el.focus(); el.blur(); }); await page.waitForTimeout(150);
    check('detail: blur without change writes nothing', writes(calls.slice(m)).length === 0);
    // shift to shopping list
    const itemsBefore = rowsOf(db, ITEMS, COLS).length;
    m = calls.length;
    await page.click('[data-shift="1"]'); await settle();
    w = writes(calls.slice(m));
    check('shift: two writes (append to Items, then Shopping id on the stock row)', w.length === 2 && w[0].method === 'PUT' && w[0].path.includes(`'${ITEMS}'!A`) && w[1].path === '/values:batchUpdate', w.map(c => c.method + c.path));
    const made = rowsOf(db, ITEMS, COLS).find(i => i.item === 'Merino crew');
    check('shift: one new Items row', rowsOf(db, ITEMS, COLS).length === itemsBefore + 1 && made, itemsBefore);
    check('shift: Items row category/sub/kind/notes', made && made.cat === 'Clothing' && made.sub === 'Socks' && made.kind === 'Need' && made.status === 'Planned' && made.active === true && made.id === 13 && String(made.notes).includes('From stocktake: My wardrobe') && String(made.notes).includes('Navy, size L'), made);
    check('shift: stock row got the Shopping id', made && stockOf(db, 1).shop === made.id, stockOf(db, 1).shop);
    check('shift: drawer now says on the shopping list, button gone', (await page.locator('[data-shift="1"]').count()) === 0 && (await text(page, '.srow[data-sid="1"] .linked')).includes('On the shopping list'));
    check('shift: Socks box offers a link to shopping list items', (await page.locator('[data-onlist=Socks]').count()) === 1);
    // Jackets: gap-buy. Jackets has no target, so give one via a second job sub; use Socks by removing the row's pieces
    m = calls.length;
    await page.click('[data-delstock="1"]'); await settle();
    w = writes(calls.slice(m));
    check('remove: one write, Active FALSE, nothing deleted', w.length === 1 && stockOf(db, 1).active === false && stockOf(db, 1).item === 'Merino crew', stockOf(db, 1));
    check('remove: row gone from the box', (await page.locator('.srow[data-sid="1"]').count()) === 0);
    // gap buy: Socks target 4, 0 pieces, 1 open shopping item (qty blank = 1) in clothing/Socks -> 3
    const btn = page.locator('[data-gapbuy=Socks]');
    check('gap-buy: count already subtracts the open shopping item (4 - 1 = 3)', (await btn.count()) === 1 && (await btn.getAttribute('data-n')) === '3' && (await btn.innerText()).includes('3'), await btn.count() ? await btn.innerText() : 'missing');
    m = calls.length;
    await btn.click(); await settle();
    w = writes(calls.slice(m));
    check('gap-buy: one append PUT to 🛒 Items', w.length === 1 && w[0].method === 'PUT' && w[0].path.includes(`'${ITEMS}'!A`), w.map(c => c.method + c.path));
    const gap = rowsOf(db, ITEMS, COLS).find(i => i.item === 'Socks');
    check('gap-buy: Items row Item=Socks, Qty=3, Clothing/Socks, note', gap && gap.qty === 3 && gap.cat === 'Clothing' && gap.sub === 'Socks' && gap.kind === 'Need' && String(gap.notes).includes('From stocktake: My wardrobe'), gap);
    check('gap-buy: button disappears once the gap is covered', (await page.locator('[data-gapbuy=Socks]').count()) === 0);
    check('gap-buy: shopping link now counts 2', (await text(page, '[data-onlist=Socks]')).startsWith('2'), await text(page, '[data-onlist=Socks]'));
    // add subcategory
    m = calls.length;
    await page.fill('#addSub input[name=n]', 'Hats'); await page.fill('#addSub input[name=q]', '3');
    await page.click('#addSub button[type=submit]'); await settle();
    w = writes(calls.slice(m));
    check('addSub: one write; Subcategories now "Socks (4), Jackets, Hats (3)"', w.length === 1 && jobOf(db, 1).subs === 'Socks (4), Jackets, Hats (3)', jobOf(db, 1).subs);
    check('addSub: Hats box appears with a 3-piece gap button', (await page.locator('.sbox[data-sub=Hats]').count()) === 1 && (await page.locator('[data-gapbuy=Hats]').getAttribute('data-n')) === '3');
    m = calls.length;
    await page.fill('#addSub input[name=n]', 'hats'); await page.click('#addSub button[type=submit]'); await page.waitForTimeout(200);
    check('addSub: duplicate name (any case) writes nothing', writes(calls.slice(m)).length === 0 && jobOf(db, 1).subs === 'Socks (4), Jackets, Hats (3)');
    check('stocktake: Items rows untouched apart from the 2 appended (ids 1-12 intact)', [1, 2, 3, 4, 5, 6, 12, 8].every(id => obj(db, id).item));
    await page.screenshot({ path: path.join(OUT, 'stocktake-1280.png'), fullPage: true });
  });

  /* j. demo, layout */
  await scenario('demo', { token: false, query: '?demo', viewport: { width: 1280, height: 900 } }, async ({ page, calls }) => {
    await page.waitForSelector('#demoBanner:not([hidden])');
    for (const w of [390, 1280]) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(120);
      for (const v of ['board', 'list', 'gallery', 'insights', 'bought', 'stock']) {
        await page.click(`[data-view=${v}]`); await page.waitForTimeout(150);
        const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        check(`demo: ${v} has no sideways page scroll at ${w}px`, sw[0] <= sw[1], sw);
        check(`demo: ${v} section is visible and not empty at ${w}px`, (await page.locator(`#v-${v}`).isVisible()) && (await text(page, `#v-${v}`)).trim().length > 20);
        await page.screenshot({ path: path.join(OUT, `demo-${v}-${w}.png`), fullPage: true });
      }
    }
    check('demo: makes no sheet calls', calls.length === 0, calls.length);
    check('demo: stats render', (await page.locator('#stats .stat .k').first().textContent()) === 'To buy');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  await (await browserP).close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL harness crashed: ' + e.stack); process.exit(1); });
