/**
 * The Nova wordmark as inline SVG: the letters take the surrounding text colour (so it reads on the dark and the light
 * theme), the crescent, slash, star and the triangle in the A are the brand blue. Drawn in code so the search pages need
 * no image file (the logo PNGs are about 1 MB each).
 */
const BRAND_BLUE = '#2a8cff';

function createNovaLogo(height: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'ns-logo';
  wrap.style.cssText = `display:inline-flex;line-height:0;height:${height}px;`;
  wrap.innerHTML = `<svg viewBox="0 0 300 80" height="${height}" role="img" aria-label="Nova" xmlns="http://www.w3.org/2000/svg">`
    + '<g fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="miter">'
    + '<path d="M12 68V12l46 56V12"/><circle cx="112" cy="40" r="27"/><path d="M158 12l25 56 25-56"/><path d="M222 68l30-56 30 56"/>'
    + '</g>'
    + `<path d="M132 18a27 27 0 0 1-14 46" stroke="${BRAND_BLUE}" stroke-width="7" fill="none" stroke-linecap="round"/>`
    + `<path d="M86 70L136 12" stroke="${BRAND_BLUE}" stroke-width="4" stroke-linecap="round"/>`
    + `<path d="M140 3l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="${BRAND_BLUE}"/>`
    + `<path d="M246 68l6-11 6 11z" fill="${BRAND_BLUE}"/>`
    + '</svg>';
  return wrap;
}

export { createNovaLogo, BRAND_BLUE };
