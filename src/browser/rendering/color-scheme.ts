/**
 * The user's colour-scheme preference as pages see it: `prefers-color-scheme`, `light-dark()` and
 * matchMedia. It was hard-coded to light, so pages stayed light on a dark-mode phone (RC-17).
 * The app sets it at startup from the platform (the WebView's own prefers-color-scheme).
 */
export type ColorScheme = 'light' | 'dark';

let preferred: ColorScheme = 'light';

export function setPreferredColorScheme(scheme: ColorScheme): void {
  preferred = scheme;
}

export function getPreferredColorScheme(): ColorScheme {
  return preferred;
}
