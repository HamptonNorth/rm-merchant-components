// client/harness/theme.js — light/dark for the harness chrome and the component under test.
//
// data-theme rather than a class, because a shadow root cannot see a class on <html>.
// The harness sets it on <html> for its own chrome and on the component element (which is
// the shadow host, so `:host([data-theme="dark"])` matches) for the component.

const KEY = "merchant-harness-theme";

export function currentTheme() {
  return localStorage.getItem(KEY) ?? "light";
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = currentTheme();
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(KEY, next);
  document.documentElement.dataset.theme = next;
  return next;
}
