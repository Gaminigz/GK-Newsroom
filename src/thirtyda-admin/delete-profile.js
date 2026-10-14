// 30+DA admin · Delete a profile: the one confirm dialog and the one route (POST /30da/admin/api/users/:id/delete,
// src/lib/thirtyda-admin.mjs → the app's own full delete). Used by Users → Delete (monitor.js) and App review → Remove
// (review.js). It builds its own <dialog> in the admin's dialog style (app.css .ad-dialog); everything from a profile
// goes on the page as text.
//
//   window.thirtydaDeleteProfile({ id, name }) → Promise: the server's answer (the overview) once deleted, or null
//   (Cancel / Escape). A refusal shows in the dialog, which stays open; a signed-out admin goes back to the sign-in.
(() => {
  let dlg = null;
  let parts = null;

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function build() {
    dlg = make('dialog', 'ad-dialog');
    dlg.id = 'delete-dialog';
    dlg.setAttribute('aria-labelledby', 'delete-title');
    dlg.setAttribute('aria-describedby', 'delete-text');
    const title = make('h2', null, 'Delete profile');
    title.id = 'delete-title';
    const text = make('p', 'ad-dialog-text');
    text.id = 'delete-text';
    const error = make('p', 'form-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = make('div', 'ad-dialog-actions');
    const cancel = make('button', 'link', 'Cancel');
    cancel.type = 'button';
    cancel.id = 'delete-cancel';
    const ok = make('button', 'btn block ad-dialog-danger', 'Delete');
    ok.type = 'button';
    ok.id = 'delete-ok';
    actions.append(cancel, ok);
    dlg.append(title, text, error, actions);
    document.body.append(dlg);
    parts = { text, error, cancel, ok };
  }

  window.thirtydaDeleteProfile = function thirtydaDeleteProfile({ id, name }) {
    if (!dlg) build();
    if (dlg.open) return Promise.resolve(null);
    const label = name || id;
    parts.text.textContent = `Delete ${label} (${id})? The profile, photos and messages are deleted for good.`;
    parts.error.hidden = true;
    parts.ok.disabled = false;
    parts.cancel.disabled = false;
    return new Promise((resolve) => {
      let answer = null;
      let busy = false;
      const done = () => {
        parts.ok.onclick = null;
        parts.cancel.onclick = null;
        dlg.removeEventListener('cancel', onEscape);
        dlg.removeEventListener('close', onClose);
        resolve(answer);
      };
      const onClose = () => done();
      const onEscape = (e) => { if (busy) e.preventDefault(); };
      dlg.addEventListener('close', onClose);
      dlg.addEventListener('cancel', onEscape);
      parts.cancel.onclick = () => { if (!busy) dlg.close(); };
      parts.ok.onclick = async () => {
        if (busy) return;
        busy = true;
        parts.ok.disabled = true;
        parts.cancel.disabled = true;
        parts.error.hidden = true;
        try {
          const res = await fetch(`/30da/admin/api/users/${encodeURIComponent(id)}/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: id }),
          });
          if (res.status === 401) { location.href = '/30da/admin'; return; }
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
          answer = data;
          busy = false;
          dlg.close();
        } catch (err) {
          busy = false;
          parts.error.textContent = err.message;
          parts.error.hidden = false;
          parts.ok.disabled = false;
          parts.cancel.disabled = false;
        }
      };
      dlg.showModal();
      parts.cancel.focus();
    });
  };
})();
