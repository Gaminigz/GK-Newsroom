// The page the 30+DA Android app's sign-in sheet (a Chrome Custom Tab) ends on — src/lib/thirtyda-pages.mjs
// appReturnPage. Try its "Open 30+DA" link (Chrome's intent:// link to the app) once by itself; when Chrome wants a
// tap first, the button and the plain link stay right there. An external file: the page's CSP allows no inline script.
const open = document.querySelector('a[data-app-open]');
if (open) window.location.href = open.href;
