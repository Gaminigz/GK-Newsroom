const $ = (id) => document.getElementById(id);
const error = $('error');

$('show').addEventListener('click', () => {
  const input = $('code');
  const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  $('show').textContent = hidden ? 'Hide' : 'Show';
});

function showError(msg) {
  error.textContent = msg;
  error.hidden = false;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const code = $('code').value;
  if (!code) return showError('Enter the super admin code.');

  $('submit').disabled = true;
  try {
    const res = await fetch('/30da/admin/api/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      $('code').value = '';
      return showError(data.error || 'Sign in failed. Try again.');
    }
    location.href = data.next || '/30da/admin/monitor';
  } catch {
    showError('Cannot reach the server. Check your connection.');
  } finally {
    $('submit').disabled = false;
  }
});
