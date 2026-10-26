const API = '/30da/admin/api/shops';
const $ = id => document.getElementById(id);
const sections = { shops: 'Shops & reports', orders: 'Orders', menus: 'Menus', chats: 'Buyer–shop chats', activity: 'Activity log', logic: 'How it controls the apps' };
let section = 'shops', data = null, generation = 0, pending = null, saving = false;
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') el.textContent = value;
    else if (key === 'onClick') el.addEventListener('click', value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) el.append(child);
  return el;
};
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const num = value => Number(value || 0).toLocaleString();
const price = value => 'LKR ' + Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const status = value => h('span', { class: 'shop-status ' + String(value || '').replace(/[^a-z_]/g, ''), text: String(value || 'Not recorded').replaceAll('_', ' ') });
const cell = (main, detail = null) => h('div', {}, typeof main === 'string' ? h('strong', { text: main }) : main, detail ? h('small', { text: detail }) : null);
const panel = (title, ...content) => h('section', { class: 'shop-panel' }, h('h2', { text: title }), ...content);
const p = text => h('p', { text });
const action = (label, kind, record, extra = {}) => h('button', { type: 'button', class: 'link', text: label, onClick: () => confirmChange(kind, record, extra) });
function table(headings, rows) {
  return h('div', { class: 'shop-table-wrap' }, h('table', { class: 'shop-table' },
    h('thead', {}, h('tr', {}, headings.map(text => h('th', { scope: 'col', text })))),
    h('tbody', {}, rows.length ? rows.map(row => h('tr', {}, row.map(value => h('td', {}, value)))) : h('tr', {}, h('td', { colspan: headings.length, text: 'No records to show.' })))));
}
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; $('notice').hidden = !text; }
async function request(path = '', body) {
  const response = await fetch(API + path, body === undefined ? { credentials: 'same-origin', cache: 'no-store' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (response.status === 401) { location.href = '/30da/admin'; throw new Error('Please sign in again.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not finish.');
  return result;
}
function matching(rows) {
  const query = $('search').value.trim().toLowerCase();
  return query ? rows.filter(row => JSON.stringify(row).toLowerCase().includes(query)) : rows;
}
function render() {
  const root = $('content'); root.replaceChildren();
  if (section === 'logic') { renderLogic(root); return; }
  if (!data) return;
  const rows = matching(data.rows);
  $('state').textContent = `${rows.length} shown · ${data.rows.length} loaded${data.total != null ? ' · ' + num(data.total) + ' total' : ''}`;
  if (section === 'shops') {
    root.append(h('div', { class: 'shop-metrics' }, [['Total shops', data.total], ['Active', data.active], ['Pending', data.pending], ['Suspended', data.suspended], ['App accounts', data.users]].map(([label, value]) =>
      h('div', { class: 'shop-metric' }, h('span', { class: 'label', text: label }), h('strong', { text: num(value) })))));
    root.append(panel('What a status change does', p('Active shops appear in buyer discovery. Pending and suspended shops are excluded there. The old application does not consistently enforce that status on direct shop, order or owner URLs; this control does not promise a full account lock. New registrations currently start active automatically.')));
    root.append(table(['Shop / owner', 'Location / contact', 'Status', 'Listings', 'Change discovery status'], rows.map(row => {
      const select = h('select', { 'aria-label': 'Status for ' + row.name });
      for (const value of ['active', 'pending', 'suspended']) { const option = h('option', { value, text: value }); option.selected = row.status === value; select.append(option); }
      return [cell(row.name, row.owner), cell([row.city, row.country].filter(Boolean).join(', ') || 'Not set', [row.email, row.phone].filter(Boolean).join(' · ')),
        cell(status(row.status), row.open === false ? 'Seller has marked closed' : 'Seller has marked open'), num(row.listings),
        h('div', { class: 'shop-actions' }, select, h('button', { class: 'link', text: 'Apply', onClick: () => confirmChange('status', row, { status: select.value }) }))];
    })));
    root.append(panel('Open reports — latest 50', table(['When', 'Shop', 'Report', 'Contact', 'Action'], data.reports.map(row => [time(row.createdAt), row.shop, row.reason || '', row.contact || '', action('Resolve', 'resolve', row)]))));
    root.append(panel('Account recovery', p('The former admin writes temporary passwords onto shop records, but the actual sign-in code reads account credentials from app_users. That old reset control is not connected to account authentication. Account recovery must use the account’s verified recovery flow; this workspace does not issue a temporary password that the app cannot use.')));
  } else if (section === 'orders') {
    root.append(panel('Order supervision', p('Latest 200 orders, including review, hold, kitchen and delivery states. This page observes orders; the seller’s POS and kitchen own the operational transitions. A delivery state does not establish that payment was received. Amounts below use the marketplace’s stored LKR base values.')));
    root.append(table(['Order / shop', 'Buyer', 'Items', 'Stored total', 'Operational status', 'Source / when'], rows.map(row => [
      cell('#' + (row.orderNo ?? '—'), row.shop), cell(row.buyer || 'Not recorded', row.phone),
      (row.items || []).map(item => `${item.qty} × ${item.name}`).join(', '), cell(price(row.total), row.paidAt ? 'Payment recorded ' + time(row.paidAt) : 'No paid-at timestamp'),
      status(row.status), cell(row.source || row.type || 'Not recorded', time(row.createdAt)),
    ])));
  } else if (section === 'menus') {
    root.append(panel('Menu moderation', p('Latest 300 live listing records. Removing a listing takes it out of app_dishes, which the apps use for their menus. A copy is retained below for restoration. Existing order items keep their recorded names and prices. “Off standing menu” can still be included by the seller in a dated meal plan.')));
    root.append(table(['Dish / shop', 'Stored base price', 'Menu flags', 'Created', 'Moderation'], rows.map(row => [cell(row.name, row.shop), price(row.price),
      [row.special ? 'Special' : 'Regular', row.offMenu ? 'Off standing menu' : 'Standing menu'].join(' · '), time(row.createdAt), action('Remove listing', 'remove-menu', row)])));
    root.append(panel('Removed listings — latest 50', table(['Dish', 'Removed', 'Action'], data.removed.map(row => [row.name || 'Unnamed listing', time(row.removedAt), action('Restore listing', 'restore-menu', row)]))));
  } else if (section === 'chats') {
    root.append(panel('Conversation review', p('Latest 100 orders containing messages; the last eight messages from each thread are shown. This is the buyer–shop conversation attached to an order. Reading a conversation does not send a message or alter its order.')));
    for (const row of rows) root.append(panel('#' + (row.orderNo ?? '—') + ' · ' + row.shop,
      (row.messages || []).map(message => h('div', { class: 'shop-message' }, h('strong', { text: message.from === 'buyer' ? row.buyer || 'Buyer' : 'Shop' }), p(message.text || ''), h('small', { text: time(message.at) })))));
    if (!rows.length) root.append(p('No conversations to show.'));
  } else if (section === 'activity') {
    root.append(panel('Who changed what', p('Latest 300 marketplace admin events. New changes identify the GK admin session; the shared code sign-in does not establish an individual person’s name. Older events may say “admin5”. Requested actions and completed actions are recorded separately where applicable.')));
    root.append(table(['When', 'Action', 'Target', 'Reason / detail', 'Admin session'], rows.map(row => [time(row.at), row.action || '', row.target || '', row.detail || '', row.actor || 'Not recorded'])));
  }
}
function renderLogic(root) {
  $('state').textContent = 'Logic traced from the marketplace code';
  root.append(panel('One marketplace, shared records', p('The buyer app, seller Shop Manager and this administration workspace use the same backend and MongoDB records. A native app requests server pages or JSON; the server reads those records. An admin change becomes visible the next time the relevant app screen loads or polls. No remote command is sent to the phone and no app-store update is required for a data-only status change.')));
  root.append(table(['Record', 'Written by', 'Read by / effect'], [
    ['shop_owners', 'Registration, shop owner and admin status review', 'Buyer discovery filters status=active. Shop Manager reads menus, location, open/closed and setup.'],
    ['app_dishes', 'Seller menus and admin moderation', 'Buyer menu, POS, meal planning and kitchen screens use shopId and dish IDs.'],
    ['app_orders', 'Buyer/table order, POS and kitchen', 'Buyer order progress, seller queues, order messages and admin oversight.'],
    ['app_reports', 'App support/report form; admin resolution', 'Open report queue. Resolving a report does not automatically suspend its shop.'],
    ['app_users', 'Marketplace sign-in and profile flow', 'Account credentials and profile details. Separate from shop status.'],
    ['admin_activity', 'Marketplace administration', 'Trace of admin actions, targets, reasons and GK admin session.'],
  ]));
  root.append(panel('Seller lifecycle', p('Registration → active immediately. An admin can change discovery status to pending or suspended, then reactivate it. The seller’s open/closed switch is a separate field. An active seller can still mark the kitchen closed; an admin review status is not the same as kitchen availability.')));
  root.append(panel('Order lifecycle', p('App, web and table orders start pending_review → the seller’s POS sends them to pending (kitchen queue) or on_hold → preparing → done (ready / on the way) → delivered. Counter/POS orders enter pending directly. Newer kitchen routes check the allowed previous state. Older owner order-status routes also exist and have weaker transition checks. Payment confirmation is stored separately from these kitchen states.')));
  root.append(panel('Shop Manager functions', p('The existing seller suite connects Table QR, daily menu, POS, messages, kitchen, menu planning, portion planning, purchase planning, stock, buying/bills, bill history and bank setup. Staff salaries, staff pay, utilities, accounting, dashboard and business health are still marked as preview screens in the source. The super admin supervises the marketplace; these seller tools remain in Shop Manager.')));
  root.append(panel('Limits to fix during the migration', p('1. Suspension is consistently used by discovery, but direct shop/order/owner routes need an enforcement audit before claiming a complete lock.'),
    p('2. Several owner operations address a shop by its ID. Seller identity and authorization must be enforced consistently before treating these routes as a strong account boundary.'),
    p('3. The old temporary-password action changes shop_owners, while account login reads app_users; it is not a working password recovery integration.'),
    p('4. Old admin money summaries label stored values LKR. Currency conversion, payment settlement and reconciliation are separate concerns.'),
    p('This adoption adds a shared admin sign-in and management UI over the existing records. It does not relocate app endpoints, copy customer records or change the seller’s workflow.')));
}
async function load() {
  const current = ++generation;
  section = Object.hasOwn(sections, location.hash.slice(1)) ? location.hash.slice(1) : 'shops';
  $('title').textContent = sections[section];
  for (const link of document.querySelectorAll('.shop-nav a')) {
    if (link.hash === '#' + section) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('search-wrap').hidden = section === 'logic'; $('state').textContent = 'Loading…'; data = null; render();
  if (section === 'logic') return;
  try {
    const result = await request('?section=' + section);
    if (current !== generation) return;
    data = result; render();
  } catch (err) { if (current === generation) { $('state').textContent = 'Could not load records'; notice(err.message, true); } }
}
function confirmChange(kind, record, extra) {
  if (saving) return;
  pending = { kind, record, extra };
  const title = { status: 'Change shop status', resolve: 'Resolve report', 'remove-menu': 'Remove listing', 'restore-menu': 'Restore listing' }[kind];
  $('change-title').textContent = title;
  $('change-help').textContent = kind === 'status' ? `${record.name}: ${record.status} → ${extra.status}. This changes discovery status, with the direct-route limits described on this page.`
    : kind === 'remove-menu' ? `Remove ${record.name} from live menu records? A copy will be kept for restoration. Existing orders retain their item data.`
    : kind === 'restore-menu' ? `Restore ${record.name} with its original ID and stored menu details?`
    : `Close this report for ${record.shop}? The shop’s status will stay as it is.`;
  $('change-reason').value = ''; $('change-error').textContent = ''; $('change-dialog').showModal(); $('change-reason').focus();
}
$('change-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!pending || saving) return;
  saving = true; $('change-submit').disabled = true; $('change-cancel').disabled = true;
  try {
    const result = await request('/' + pending.kind, { id: pending.record._id, ...pending.extra, reason: $('change-reason').value });
    $('change-dialog').close(); pending = null; notice(result.message); await load();
  } catch (err) { $('change-error').textContent = err.message; }
  finally { saving = false; $('change-submit').disabled = false; $('change-cancel').disabled = false; }
});
$('change-cancel').addEventListener('click', () => { if (!saving) $('change-dialog').close(); });
$('change-dialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
$('search').addEventListener('input', render);
$('refresh').addEventListener('click', () => load());
$('signout').addEventListener('click', async () => {
  try { await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.href = '/30da/admin'; }
  catch { notice('Could not sign out. Please try again.', true); }
});
window.addEventListener('hashchange', () => { $('search').value = ''; notice(''); load(); });
load();
