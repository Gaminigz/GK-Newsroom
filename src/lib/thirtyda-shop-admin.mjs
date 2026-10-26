// Shop administration adopted into GK Workspaces. These are the marketplace's existing collections.
// The caller supplies its authenticated database and audit callback; no shop-owner session is issued here.
import { ObjectId } from 'mongodb';
import crypto from 'node:crypto';

const id = value => /^[a-f0-9]{24}$/i.test(String(value || '')) ? new ObjectId(value) : null;
const stamp = value => value instanceof Date ? value.toISOString() : value || null;
const view = doc => ({ ...doc, _id: String(doc._id), createdAt: stamp(doc.createdAt) });
const fail = (status, message) => Object.assign(new Error(message), { status });
const SHOP_FIELDS = { name: 1, owner: 1, email: 1, phone: 1, city: 1, country: 1, kind: 1, signup: 1, status: 1, open: 1, listings: 1, createdAt: 1 };
const ORDER_FIELDS = { orderNo: 1, shopId: 1, buyer: 1, phone: 1, items: 1, total: 1, status: 1, source: 1, type: 1, tableN: 1, paidAt: 1, createdAt: 1 };

export async function shopAdminData(d, section) {
  const shops = d.collection('shop_owners');
  const names = async rows => {
    const ids = [...new Set(rows.map(r => String(r.shopId || '')))].map(id).filter(Boolean);
    const owners = ids.length ? await shops.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray() : [];
    const byId = new Map(owners.map(o => [String(o._id), o.name]));
    return rows.map(r => ({ ...view(r), shop: byId.get(String(r.shopId)) || 'Unknown shop' }));
  };
  if (section === 'shops') {
    const [rows, total, active, pending, suspended, users, reports] = await Promise.all([
      shops.find({}, { projection: SHOP_FIELDS }).sort({ createdAt: -1 }).limit(500).toArray(), shops.countDocuments(),
      shops.countDocuments({ status: 'active' }), shops.countDocuments({ status: 'pending' }), shops.countDocuments({ status: 'suspended' }),
      d.collection('app_users').countDocuments(),
      d.collection('app_reports').find({ status: 'open' }, { projection: { shopId: 1, reason: 1, contact: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray(),
    ]);
    return { rows: rows.map(view), reports: await names(reports), total, active, pending, suspended, users, limit: 500 };
  }
  if (section === 'orders') {
    const [rows, total] = await Promise.all([
      d.collection('app_orders').find({}, { projection: ORDER_FIELDS }).sort({ createdAt: -1 }).limit(200).toArray(),
      d.collection('app_orders').countDocuments(),
    ]);
    return { rows: await names(rows), total, limit: 200 };
  }
  if (section === 'menus') {
    const [rows, total, removed] = await Promise.all([
      d.collection('app_dishes').find({}, { projection: { name: 1, nameSi: 1, shopId: 1, price: 1, special: 1, offMenu: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(300).toArray(),
      d.collection('app_dishes').countDocuments(),
      d.collection('shop_admin_removed_dishes').find({ restoredAt: { $exists: false } }, { projection: { 'dish.name': 1, 'dish.shopId': 1, removedAt: 1 } }).sort({ removedAt: -1 }).limit(50).toArray(),
    ]);
    // Also recover an interrupted removal: the archived copy exists even if the completion marker was not written.
    const present = removed.length ? await d.collection('app_dishes').find({ _id: { $in: removed.map(r => r._id) } }, { projection: { _id: 1 } }).toArray() : [];
    const live = new Set(present.map(r => String(r._id)));
    return { rows: await names(rows), total, limit: 300, removed: removed.filter(r => !live.has(String(r._id))).map(r => ({ _id: String(r._id), name: r.dish?.name, removedAt: stamp(r.removedAt) })) };
  }
  if (section === 'chats') {
    const rows = await d.collection('app_orders').find({ 'messages.0': { $exists: true } },
      { projection: { orderNo: 1, shopId: 1, buyer: 1, messages: { $slice: -8 }, createdAt: 1 } }).sort({ createdAt: -1 }).limit(100).toArray();
    return { rows: await names(rows), limit: 100 };
  }
  if (section === 'activity') {
    const rows = await d.collection('admin_activity').find({}, { projection: { action: 1, target: 1, detail: 1, actor: 1, at: 1 } }).sort({ at: -1 }).limit(300).toArray();
    return { rows: rows.map(r => ({ ...view(r), at: stamp(r.at) })), limit: 300 };
  }
  throw fail(404, 'No such shop section.');
}

export async function shopAdminAction(d, action, body, { actor, audit }) {
  const targetId = id(body.id);
  if (!targetId) throw fail(422, 'Choose a valid record.');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  if (reason.length < 5) throw fail(422, 'Add a reason of at least 5 characters.');
  const log = async (event, target) => {
    const detail = reason;
    await d.collection('admin_activity').insertOne({ action: event, target, detail, actor, at: new Date() });
    await audit(event, { workspace: '3una5aha', target: String(targetId), detail });
  };
  if (action === 'status') {
    if (!['active', 'pending', 'suspended'].includes(body.status)) throw fail(422, 'Choose a valid shop status.');
    const shops = d.collection('shop_owners');
    const shop = await shops.findOne({ _id: targetId }, { projection: { name: 1, status: 1 } });
    if (!shop) throw fail(404, 'Shop not found.');
    await log('shop_status_requested', shop.name);
    const r = await shops.updateOne({ _id: targetId, status: shop.status }, { $set: { status: body.status, adminReviewedAt: new Date() } });
    if (!r.matchedCount) throw fail(409, 'This shop changed. Refresh and try again.');
    await log('shop_' + body.status, shop.name);
    return { message: 'Shop status updated. Discovery lists read this status; direct routes retain their existing behavior.' };
  }
  if (action === 'resolve') {
    const reports = d.collection('app_reports');
    const report = await reports.findOne({ _id: targetId, status: 'open' });
    if (!report) throw fail(409, 'This report is no longer open.');
    await log('report_resolve_requested', String(report.shopId || 'general'));
    const changed = await reports.updateOne({ _id: targetId, status: 'open' }, { $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: actor, resolution: reason } });
    if (!changed.matchedCount) throw fail(409, 'This report changed. Refresh and try again.');
    await log('report_resolved', String(report.shopId || 'general'));
    return { message: 'Report resolved. Resolving a report does not change the shop status.' };
  }
  if (action === 'remove-menu' || action === 'restore-menu') {
    const locks = d.collection('shop_admin_locks');
    const operation = crypto.randomUUID();
    await locks.deleteOne({ _id: targetId, expires: { $lte: new Date() } });
    try { await locks.insertOne({ _id: targetId, operation, expires: new Date(Date.now() + 5 * 60e3) }); }
    catch (err) { if (err.code === 11000) throw fail(409, 'Another admin is changing this listing. Refresh shortly.'); throw err; }
    try {
  if (action === 'remove-menu') {
    const dishes = d.collection('app_dishes');
    const dish = await dishes.findOne({ _id: targetId });
    if (!dish) throw fail(404, 'Listing not found.');
    // Archive before removal. A concurrent seller edit makes the delete fail rather than discarding that edit.
    await d.collection('shop_admin_removed_dishes').updateOne({ _id: targetId }, { $set: { dish, removed: false, reason, actor, removedAt: new Date() }, $unset: { restoredAt: '' } }, { upsert: true });
    await log('dish_remove_requested', dish.name);
    const deleted = await dishes.deleteOne({ _id: targetId, $expr: { $eq: ['$$ROOT', { $literal: dish }] } });
    if (!deleted.deletedCount) throw fail(409, 'This listing changed. Refresh before removing it.');
    await d.collection('shop_admin_removed_dishes').updateOne({ _id: targetId }, { $set: { removed: true } });
    const shopId = id(dish.shopId);
    if (shopId) await d.collection('shop_owners').updateOne({ _id: shopId, listings: { $gt: 0 } }, { $inc: { listings: -1 } });
    await log('dish_removed', dish.name);
    return { message: 'Listing removed from the live menu and saved in Removed listings. Existing orders keep their item snapshots.' };
  }
  if (action === 'restore-menu') {
    const archive = d.collection('shop_admin_removed_dishes');
    const saved = await archive.findOne({ _id: targetId, restoredAt: { $exists: false } });
    if (!saved?.dish) throw fail(404, 'Removed listing not found.');
    await log('dish_restore_requested', saved.dish.name);
    try { await d.collection('app_dishes').insertOne(saved.dish); }
    catch (err) { if (err.code === 11000) throw fail(409, 'This listing is already present. Refresh the page.'); throw err; }
    await archive.updateOne({ _id: targetId }, { $set: { removed: false, restoredAt: new Date() } });
    const shopId = id(saved.dish.shopId);
    if (shopId) await d.collection('shop_owners').updateOne({ _id: shopId }, { $inc: { listings: 1 } });
    await log('dish_restored', saved.dish.name);
    return { message: 'Listing restored with its original ID and menu data.' };
  }
    } finally { await locks.deleteOne({ _id: targetId, operation }); }
  }
  throw fail(404, 'No such shop action.');
}
