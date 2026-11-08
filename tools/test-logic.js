// Unit tests for the pure LOGIC block in app.html. Run: node tools/test-logic.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
const a = html.indexOf('const esc = '), s = html.indexOf('/* LOGIC START'), e = html.indexOf('/* LOGIC END */');
if (a < 0 || s < 0 || e < 0) { console.log('FAIL logic markers not found in app.html'); process.exit(1); }
const helpers = html.slice(a, s).split('\n').filter(l => !/^const (\$|todayIso|fdy|plural) /.test(l)).join('\n');
const L = new Function(helpers + html.slice(s, e) + '\n;return { money, fmtMoney, total, saving, coolingLeft, rank, sortItems, effOrder, orderBetween, fromLink, buyListRows, BUYLIST_HEADS, toCsv, toTsv, guessCategory, normWindow, shortDate, mapPriorities, mapPurchases, mapClothing, mapHousehold, sameThing, mergeInto, planImport, blankItem, fmtMoney, isOpen, parseSubs, subsText, stockSummary, nextCond, SUB_PRESETS, CONDITIONS };')();

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
}
const ok = (name, c, d) => eq(name, !!c, true) || (c ? 0 : d !== undefined && console.log('   ' + JSON.stringify(d)));
const TODAY = '2026-11-07';

/* money */
eq('money $1,600.00', L.money('$1,600.00'), 1600);
eq('money N/A', L.money('N/A'), null);
eq('money ~$70', L.money('~$70'), 70);
eq('money blank/null', [L.money(''), L.money(null), L.money(undefined)], [null, null, null]);
eq('money number passthrough', L.money(12.5), 12.5);
eq('money decimal string', L.money('$26.40'), 26.4);
eq('money negative', L.money('-5'), -5);
eq('money NaN number', L.money(NaN), null);
eq('fmtMoney whole', L.fmtMoney(1600), '$1,600');
eq('fmtMoney cents', L.fmtMoney(26.4), '$26.40');
eq('fmtMoney forced cents', L.fmtMoney(5, true), '$5.00');
eq('fmtMoney null', L.fmtMoney(null), '');

/* total / saving */
eq('total qty x cost', L.total({ cost: 35, qty: 3 }), 105);
eq('total sale beats cost', L.total({ cost: 700, sale: 595, qty: 1 }), 595);
eq('total no price', L.total({}), 0);
eq('total qty missing = 1', L.total({ cost: 10 }), 10);
eq('total bought uses final', L.total({ status: 'Bought', cost: 10, qty: 2, final: 17 }), 17);
eq('total not bought ignores final', L.total({ status: 'Planned', cost: 10, qty: 2, final: 17 }), 20);
eq('total bought without final falls back', L.total({ status: 'Bought', cost: 10, qty: 2 }), 20);
eq('saving sale x qty', L.saving({ cost: 100, sale: 80, qty: 2 }), 40);
eq('saving none when no sale', L.saving({ cost: 100 }), 0);
eq('saving never negative', L.saving({ cost: 80, sale: 100 }), 0);

/* coolingLeft: today 2026-11-07, 30 days, min $100 */
const want = (o) => ({ kind: 'Want', status: 'Planned', cost: 300, added: '2026-10-28', ...o });
eq('cooling: 10 days in -> 20 left', L.coolingLeft(want({}), TODAY, 30, 100), 20);
eq('cooling: elapsed -> 0', L.coolingLeft(want({ added: '2026-09-01' }), TODAY, 30, 100), 0);
eq('cooling: need exempt', L.coolingLeft(want({ kind: 'Need' }), TODAY, 30, 100), 0);
eq('cooling: under threshold exempt', L.coolingLeft(want({ cost: 50 }), TODAY, 30, 100), 0);
eq('cooling: bought exempt', L.coolingLeft(want({ status: 'Bought' }), TODAY, 30, 100), 0);
eq('cooling: days 0 disables', L.coolingLeft(want({}), TODAY, 0, 100), 0);
eq('cooling: no added date', L.coolingLeft(want({ added: '' }), TODAY, 30, 100), 0);
eq('cooling: inactive exempt', L.coolingLeft(want({ active: false }), TODAY, 30, 100), 0);

/* rank + sortItems */
const cats = ['Office', 'Clothing', 'Pet'], wins = ['Now', 'Black Friday', 'Q1'];
eq('rank known/unknown/blank', [L.rank(cats, 'clothing'), L.rank(cats, 'Zed'), L.rank(cats, '')], [1, 5e5, 1e6]);
const mk = (id, item, cat, window, kind, prio) => ({ id, item, cat, window, kind, prio });
const list = [
  mk(1, 'a', 'Pet', 'Now', 'Want', 1), mk(2, 'b', 'Office', 'Q1', 'Need', 2), mk(3, 'c', 'Office', 'Black Friday', 'Want', 1),
  mk(4, 'd', 'Office', 'Mystery', 'Need', 1), mk(5, 'e', 'Office', '', 'Need', 1), mk(6, 'f', 'Office', 'Black Friday', 'Need', null),
  mk(7, 'g', 'Office', 'Black Friday', 'Need', 1), mk(8, 'h', 'Zed', 'Now', 'Need', 1), mk(9, 'i', '', 'Now', 'Need', 1), mk(10, 'j', 'Clothing', 'Now', 'Need', 3)
];
const sorted = L.sortItems(list, ['cat', 'window', 'kind', 'prio'], { cats, wins });
eq('sortItems cat/window/kind/prio', sorted.map(x => x.id), [7, 6, 3, 2, 4, 5, 10, 1, 8, 9]);
eq('sortItems does not mutate input', list.map(x => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
eq('sortItems ties fall to name then id', L.sortItems([mk(2, 'same'), mk(1, 'same')], ['prio'], { cats, wins }).map(x => x.id), [1, 2]);
eq('sortItems price high first', L.sortItems([{ id: 1, item: 'a', cost: 5 }, { id: 2, item: 'b', cost: 50 }], ['price'], { cats, wins }).map(x => x.id), [2, 1]);
eq('sortItems order key uses effOrder', L.sortItems([{ id: 1, item: 'a', order: 5000 }, { id: 2, item: 'b' }, { id: 3, item: 'c', order: 2500 }], ['order'], { cats, wins }).map(x => x.id), [2, 3, 1]);
eq('effOrder fallback id*1000', [L.effOrder({ id: 4 }), L.effOrder({ id: 4, order: 12.5 }), L.effOrder({ id: 4, order: '' })], [4000, 12.5, 4000]);

/* orderBetween */
eq('orderBetween empty column', L.orderBetween(null, null), 1000);
eq('orderBetween at top', L.orderBetween(null, 3000), 2000);
eq('orderBetween at bottom', L.orderBetween(3000, null), 4000);
eq('orderBetween middle', L.orderBetween(1000, 2000), 1500);
eq('orderBetween equal neighbours -> renumber', L.orderBetween(1000, 1000), null);
eq('orderBetween reversed -> renumber', L.orderBetween(2000, 1000), null);
eq('orderBetween too tight -> renumber', L.orderBetween(1, 1 + 1e-7), null);
eq('orderBetween top with zero/negative', L.orderBetween(null, 0), -1000);
eq('orderBetween fractional', L.orderBetween(1000, 1500), 1250);

/* fromLink */
const fl = L.fromLink('https://www.jbhifi.com.au/products/philips-34e1c5600he-34-curved-monitor');
eq('fromLink retailer', fl.retailer, 'Jbhifi');
ok('fromLink item contains Philips', fl.item.includes('Philips'), fl);
ok('fromLink item contains Monitor', fl.item.includes('Monitor'), fl);
eq('fromLink keeps url', fl.link, 'https://www.jbhifi.com.au/products/philips-34e1c5600he-34-curved-monitor');
eq('fromLink short domain upper-cased', L.fromLink('https://ebay.com/itm/123456').retailer, 'EBAY');
eq('fromLink amazon dp skips ASIN', L.fromLink('https://www.amazon.com.au/Anker-Power-Bank/dp/B0ABCDEFGH').item, 'Anker Power Bank');
eq('fromLink strips .html and _p123', L.fromLink('https://shop.example.com/kettle-one_p123.html').item, 'Kettle One');
eq('fromLink bare domain falls back to retailer', L.fromLink('https://www.example.com/').item, 'Example');
eq('fromLink invalid -> null', L.fromLink('not a url'), null);

/* buyListRows / csv / tsv */
const bl = L.buyListRows([{ id: 3, item: 'Desk, "big"', cat: 'Office', sub: 's', room: 'r', prio: 1, status: 'Bought', window: 'Now', cost: 100, qty: 2, final: 150, retailer: 'R', pay4: true, added: '2026-01-01', link: 'https://x', kind: 'Need', stickers: 'A', notes: 'n' }, { id: 4, item: 'x', status: 'Planned', cost: 10, pay4: false }]);
eq('BUYLIST_HEADS has 22 columns', L.BUYLIST_HEADS.length, 22);
ok('buyListRows every row has 22 columns', bl.every(r => r.length === 22), bl.map(r => r.length));
eq('buyListRows maps columns to heads', [bl[0][L.BUYLIST_HEADS.indexOf('Item')], bl[0][L.BUYLIST_HEADS.indexOf('Cost each')], bl[0][L.BUYLIST_HEADS.indexOf('Qty')], bl[0][L.BUYLIST_HEADS.indexOf('Total')], bl[0][L.BUYLIST_HEADS.indexOf('Final cost')], bl[0][L.BUYLIST_HEADS.indexOf('Pay-in-4 eligible')], bl[0][L.BUYLIST_HEADS.indexOf('Notes')], bl[0][L.BUYLIST_HEADS.indexOf('Source')]], ['Desk, "big"', 100, 2, 150, 150, 'TRUE', 'Need · A · n', 'Want & Need #3']);
eq('buyListRows unbought has blank final, qty 1', [bl[1][L.BUYLIST_HEADS.indexOf('Final cost')], bl[1][L.BUYLIST_HEADS.indexOf('Qty')]], ['', 1]);
eq('toCsv quotes commas, quotes, newlines', L.toCsv([['a', 'b,c', 'd"e', 'f\ng', null, 5]]), 'a,"b,c","d""e","f\ng",,5');
eq('toCsv joins rows with newline', L.toCsv([['a'], ['b']]), 'a\nb');
eq('toTsv flattens tabs/newlines', L.toTsv([['a\tb', 'c\nd', null]]), 'a b\tc d\t');

/* normWindow / shortDate / guessCategory / sameThing */
eq('normWindow Wait for sale', L.normWindow('Wait for sale'), 'On sale');
eq('normWindow PRIOR TO MOVE', L.normWindow('PRIOR TO MOVE'), 'Pre-move');
eq('normWindow Pre move', L.normWindow('pre move'), 'Pre-move');
eq('normWindow PRIOR TO FEB', L.normWindow('PRIOR TO FEB'), 'Before Feb');
eq('normWindow Once Moved', L.normWindow('Once Moved'), 'Once moved');
eq('normWindow black friday sale', L.normWindow('black friday'), 'Black Friday');
eq('normWindow TBA / N/A / blank', [L.normWindow('TBA'), L.normWindow('n/a'), L.normWindow(''), L.normWindow(null)], ['', '', '', '']);
eq('normWindow passthrough', L.normWindow('Q2'), 'Q2');
eq('shortDate 21 Mar', L.shortDate('21 Mar', TODAY), '2026-03-21');
eq('shortDate 30 Dec previous year', L.shortDate('30 Dec', TODAY), '2025-12-30');
eq('shortDate today', L.shortDate('7 Nov', TODAY), '2026-11-07');
eq('shortDate tomorrow -> last year', L.shortDate('8 Nov', TODAY), '2025-11-08');
eq('shortDate junk', [L.shortDate('', TODAY), L.shortDate('hello', TODAY), L.shortDate('3 Xyz', TODAY)], ['', '', '']);
eq('guessCategory', [L.guessCategory('Cat water fountain'), L.guessCategory('Walking shoes'), L.guessCategory('Anker power bank'), L.guessCategory('Standing desk'), L.guessCategory('Ceiling fan'), L.guessCategory('Mystery thing')], ['Pet', 'Clothing', 'Tech', 'Office', 'Household', 'Other']);
eq('guessCategory hint', [L.guessCategory('Thing', 'for Tink'), L.guessCategory('Thing', 'electrician'), L.guessCategory('Thing', 'travel')], ['Pet', 'Household', 'Travel']);
eq('sameThing exact ignoring punctuation', L.sameThing('Air-Fryer (XL)', 'air fryer xl'), true);
eq('sameThing >=12 char prefix', L.sameThing('Corner Bookshelf', 'Corner Bookshelf Unit'), true);
eq('sameThing short prefix is not same', L.sameThing('Desk Mat', 'Desk Mat Large'), false);
eq('sameThing blank', L.sameThing('', 'abc'), false);

/* planImport fixtures: all made up */
const R = arr => arr.map(v => (typeof v === 'object' ? v : { v, h: '' }));
const H = (url, text) => ({ v: text || url, h: url });
const src = {
  Household: [
    R(['Item', 'Room', 'Status', 'When', 'Priority', 'Category', 'Retailer', 'Final cost', 'Budget cost', 'Low', 'Premium', 'Notes']),
    R(['Zeta Lamp Alpha', 'Lounge', 'To buy', 'Black Friday', '1', 'Appliance', '#N/A', '', '$120.00', '', '', H('https://shop.example.com/lamp', 'see lamp')]),
    R(['Corner Bookshelf Unit', 'Study', 'To buy', 'TBA', '2', 'Furniture', '#N/A', '', '$250.00', '', '', 'Needs to fit alcove']),
    R(['Reading Light Duo', 'Bedroom', 'To buy', '', '3', 'Lighting', 'Lamp Co', '', '$40.00', '', '', '']),
    R(['Reading Light Duo', 'Spare room', 'To buy', '', '3', 'Lighting', 'Lamp Co', '', '$40.00', '', '', '']),
    R(['Old Kettle Thing', 'Kitchen', 'Bought', '', '2', 'Appliance', 'Kitchen Co', '$55.00', '', '', '', '']),
    R(['Desk Mat Large', 'Office', 'To buy', '', '3', 'Office', '', '', '$30.00', '', '', ''])
  ],
  Purchases: [
    R(['Product', 'Category', 'Sub', 'Approx Total', 'Importance', 'Move Sheet', 'Purchased', 'When to Purchase', 'Pay in 4', 'Unit Cost', 'Units', 'Purchase From', 'Date Added', 'Link', 'Notes', 'Online/Instore']),
    R(['Ceiling Fan Pair', 'Home', 'Lighting', '$900', '2', 'x', 'FALSE', 'Wait for sale', '✅', '$300', '3', 'Fan Store', '21 Mar', H('https://fans.example.com/p', 'HERE'), 'Fit all at once', 'Online']),
    R(['Gadget Hub Bought', 'Office', '', '$40', '1', '', 'TRUE', '', '', '', '', '', '30 Dec', '', '', 'Instore']),
    R(['Zeta Lamp Alpha', 'Home', '', '$110', '2', '', 'FALSE', '', '', '', '', 'Lamp Co', '', '', 'Warm light', 'Online'])
  ],
  Priorities: [
    R(['', 'PRIOR TO MOVE', 'Why?', 'Cost']),
    R(['FALSE', 'Corner Bookshelf', 'Storage', '$260.00', '', '', '', '', '']),
    R(['TRUE', 'Standing Desk Frame', 'Work', '$500.00', '$450.00', 'Desk Co', 'Black Friday', '', 'https://desk.example.com/frame']),
    R(['FALSE', 'PRIOR TO FEB', 'Why?']),
    R(['FALSE', 'Cat Water Fountain', 'Pet hydration', '$70.00']),
    R(['FALSE', 'Once Moved']),
    R(['FALSE', 'Doormat Large', 'Entry', '$59.00', '', '', '', '', '']),
    R(['FALSE', 'Desk Mat', 'Protect desk', '$20.00'])
  ],
  Clothing: [
    R(['Acme', 'Trail Boots', H('https://acme.example.com/boots', 'link'), 'M 10', '$28.00']),
    R(['Wool Beanie', H('https://b.example.com/beanie')]),
    R(['Tshirts -- add white and beige for summer layering and more']),
    R(['Add a few more warm layers for the trip, maybe three or four of them']),
    []
  ]
};
let plan = L.planImport(src, [], TODAY);
const by = n => plan.items.find(i => i.item === n);
const names = plan.items.map(i => i.item).sort();
eq('import: 14 items out of 18 rows', plan.items.length, 14);
eq('import: names (dupes merged, advice skipped, dupes in one tab kept)', names, ['Acme – Trail Boots', 'Ceiling Fan Pair', 'Corner Bookshelf Unit', 'Cat Water Fountain', 'Desk Mat', 'Desk Mat Large', 'Doormat Large', 'Gadget Hub Bought', 'Old Kettle Thing', 'Reading Light Duo', 'Reading Light Duo', 'Standing Desk Frame', 'Wool Beanie', 'Zeta Lamp Alpha'].sort());
eq('import: merged count', plan.merged, 2);
eq('import: Household+Priorities source', by('Corner Bookshelf Unit').source, 'Household 3; Priorities 2');
eq('import: merged keeps first (longer household) name & cost', [by('Corner Bookshelf Unit').cost], [250]);
eq('import: merged takes window from priorities section', by('Corner Bookshelf Unit').window, 'Pre-move');
eq('import: merged kind Need / prio best', [by('Corner Bookshelf Unit').kind, by('Corner Bookshelf Unit').prio], ['Need', 1]);
eq('import: merged notes combine', by('Corner Bookshelf Unit').notes, 'Needs to fit alcove · Storage');
eq('import: Household+Purchases source', by('Zeta Lamp Alpha').source, 'Household 2; Purchases 4');
eq('import: household link from hyperlink + window + retailer #N/A blank', [by('Zeta Lamp Alpha').link, by('Zeta Lamp Alpha').window, by('Zeta Lamp Alpha').retailer], ['https://shop.example.com/lamp', 'Black Friday', 'Lamp Co']);
const twins = plan.items.filter(i => i.item === 'Reading Light Duo');
eq('import: same name twice in ONE tab stays two items', [twins.length, twins.map(t => t.source).sort()], [2, ['Household 4', 'Household 5']]);
eq('import: Desk Mat vs Desk Mat Large not merged (short prefix)', [!!by('Desk Mat'), !!by('Desk Mat Large')], [true, true]);
eq('import: household Bought status & final cost', [by('Old Kettle Thing').status, by('Old Kettle Thing').cost], ['Bought', 55]);
eq('import: household priority>=3 is Want', [twins[0].kind, by('Old Kettle Thing').kind], ['Want', 'Need']);
eq('import: priorities ticked row -> Bought', by('Standing Desk Frame').status, 'Bought');
eq('import: priorities when overrides section; sale; retailer; link text url', [by('Standing Desk Frame').window, by('Standing Desk Frame').sale, by('Standing Desk Frame').retailer, by('Standing Desk Frame').link], ['Black Friday', 450, 'Desk Co', 'https://desk.example.com/frame']);
eq('import: section PRIOR TO FEB', [by('Cat Water Fountain').window, by('Cat Water Fountain').cat], ['Before Feb', 'Pet']);
eq('import: section Once Moved', by('Doormat Large').window, 'Once moved');
eq('import: unticked priorities Planned, Need, prio 1', [by('Doormat Large').status, by('Doormat Large').kind, by('Doormat Large').prio], ['Planned', 'Need', 1]);
eq('import: purchases mapping', (({ cat, window, pay4, cost, qty, added, link, retailer, status, prio }) => ({ cat, window, pay4, cost, qty, added, link, retailer, status, prio }))(by('Ceiling Fan Pair')),
  { cat: 'Household', window: 'On sale', pay4: true, cost: 300, qty: 3, added: '2026-03-21', link: 'https://fans.example.com/p', retailer: 'Fan Store', status: 'Planned', prio: 2 });
eq('import: purchases bought, in-store sticker, Dec date last year', [by('Gadget Hub Bought').status, by('Gadget Hub Bought').stickers, by('Gadget Hub Bought').added, by('Gadget Hub Bought').cat], ['Bought', 'In store', '2025-12-30', 'Office']);
eq('import: clothing brand+model, size note, cost, link', [by('Acme – Trail Boots').cost, by('Acme – Trail Boots').notes, by('Acme – Trail Boots').link, by('Acme – Trail Boots').cat], [28, 'Size M 10', 'https://acme.example.com/boots', 'Clothing']);
eq('import: clothing [name, link] row', [by('Wool Beanie').link, by('Wool Beanie').source], ['https://b.example.com/beanie', 'Clothing 2']);
eq('import: clothing advice rows skipped', plan.items.some(i => /Tshirts|warm layers/.test(i.item)), false);
eq('import: added defaults to today', by('Doormat Large').added, TODAY);
eq('import: no internal _tabs left', plan.items.some(i => '_tabs' in i), false);
eq('import: nothing skipped on empty sheet', plan.skipped.length, 0);

plan = L.planImport(src, [{ item: 'cat water fountain', active: true }, { item: 'Unrelated', source: 'Clothing 1; Purchases 9', active: true }, { item: 'Doormat Large', active: false }], TODAY);
eq('import: existing by name skipped', plan.skipped.some(i => i.item === 'Cat Water Fountain'), true);
eq('import: existing by source skipped', plan.skipped.some(i => i.item === 'Acme – Trail Boots'), true);
eq('import: inactive existing does not block', plan.items.some(i => i.item === 'Doormat Large'), true);
eq('import: second run with first run output skips everything', (() => { const p1 = L.planImport(src, [], TODAY); const p2 = L.planImport(src, p1.items, TODAY); return [p2.items.length, p2.skipped.length === p1.items.length]; })(), [0, true]);
eq('import: missing tabs ok', L.planImport({}, [], TODAY).items.length, 0);
eq('import: Purchases-only tab, row 0 is header', L.planImport({ Purchases: [R(['Product']), R(['Thing One', 'Office'])] }, [], TODAY).items.map(i => i.item), ['Thing One']);

/* stocktake */
eq('parseSubs: targets and plain names', L.parseSubs('Socks (10), Jackets'), [{ name: 'Socks', target: 10 }, { name: 'Jackets', target: null }]);
eq('parseSubs: dedupes case-insensitively, first wins', L.parseSubs('Socks (10), socks (4), SOCKS'), [{ name: 'Socks', target: 10 }]);
eq('parseSubs: blank/null/stray commas', [L.parseSubs(''), L.parseSubs(null), L.parseSubs(' , ,')], [[], [], []]);
eq('parseSubs: spacing and zero target', L.parseSubs('  T-shirts(6) ,Hats ( 3 ), Belts (0)'), [{ name: 'T-shirts', target: 6 }, { name: 'Hats ( 3 )', target: null }, { name: 'Belts', target: 0 }]);
eq('parseSubs: non-numeric parens stay in the name', L.parseSubs('Shoes (work)'), [{ name: 'Shoes (work)', target: null }]);
eq('subsText: joins with targets', L.subsText([{ name: 'Socks', target: 10 }, { name: 'Jackets', target: null }]), 'Socks (10), Jackets');
eq('subsText: empty list', L.subsText([]), '');
eq('subsText: zero target kept', L.subsText([{ name: 'Belts', target: 0 }]), 'Belts (0)');
eq('subsText/parseSubs round trip', L.subsText(L.parseSubs('Socks (10), Jackets, Hats (3)')), 'Socks (10), Jackets, Hats (3)');
eq('round trip is stable for every preset', Object.values(L.SUB_PRESETS).every(p => L.subsText(L.parseSubs(L.subsText(L.parseSubs(p)))) === L.subsText(L.parseSubs(p))), true);
const stk = [
  { sub: 'Socks', qty: 6, cond: 'Good' }, { sub: 'socks', qty: 3, cond: 'Replace' }, { sub: 'Socks', qty: 2, cond: 'Worn' },
  { sub: 'Jackets', qty: 2, cond: 'Good' }, { sub: 'Hats', qty: '4', cond: 'Replace' }, { sub: 'Other', qty: 5, cond: 'Good' }
];
const sm = L.stockSummary(stk, L.parseSubs('Socks (10), Jackets, Hats (2), Belts (3)'));
eq('stockSummary: Replace rows reduce usable, Worn still counts', sm[0], { name: 'Socks', target: 10, lines: 3, pieces: 11, replace: 3, usable: 8, gap: 2 });
eq('stockSummary: no target -> gap 0', sm[1], { name: 'Jackets', target: null, lines: 1, pieces: 2, replace: 0, usable: 2, gap: 0 });
eq('stockSummary: all Replace, string qty coerced', sm[2], { name: 'Hats', target: 2, lines: 1, pieces: 4, replace: 4, usable: 0, gap: 2 });
eq('stockSummary: empty sub with target', sm[3], { name: 'Belts', target: 3, lines: 0, pieces: 0, replace: 0, usable: 0, gap: 3 });
eq('stockSummary: gap never negative', L.stockSummary([{ sub: 'A', qty: 9, cond: 'Good' }], [{ name: 'A', target: 4 }])[0].gap, 0);
eq('stockSummary: rows outside subs ignored, no rows ok', [sm.length, L.stockSummary([], [{ name: 'A', target: 2 }])[0].gap], [4, 2]);
eq('stockSummary: row with blank qty counts 0 pieces but one line', L.stockSummary([{ sub: 'A', qty: '', cond: 'Good' }], [{ name: 'A', target: null }])[0], { name: 'A', target: null, lines: 1, pieces: 0, replace: 0, usable: 0, gap: 0 });
eq('CONDITIONS order', L.CONDITIONS, ['Good', 'Worn', 'Replace']);
eq('nextCond cycles Good>Worn>Replace>Good', [L.nextCond('Good'), L.nextCond('Worn'), L.nextCond('Replace')], ['Worn', 'Replace', 'Good']);
eq('nextCond: unknown/blank -> Good', [L.nextCond(''), L.nextCond(undefined)], ['Good', 'Good']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
