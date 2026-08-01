import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { HtmlElement } from '../src/browser/rendering/html5/dom';
import { HtmlSanitizer, containsDangerousCss, sanitizeStyleAttribute } from '../src/browser/security/html-sanitizer';
import { isBlockedUrlScheme } from '../src/browser/security/blocked-url-schemes';

// Test 1: CSS detection
console.log('=== CSS Detection ===');
console.log('expression():', containsDangerousCss('color: red; expression(alert(1))'));
console.log('safe CSS:', containsDangerousCss('color: red'));

// Test 2: sanitizeStyleAttribute
console.log('=== Style Sanitization ===');
console.log('result:', sanitizeStyleAttribute('color: red; expression(alert(1))'));

// Test 3: URL scheme
console.log('=== URL Schemes ===');
console.log('JavaScript:', isBlockedUrlScheme('JavaScript:alert(1)'));
console.log('VaBsCrIpT:', isBlockedUrlScheme('VaBsCrIpT:alert(1)'));

// Test 4: HTML sanitizer with style
console.log('=== HTML Sanitizer CSS ===');
const domTree = new DomTree();
const htmlParser = new HtmlParser();
const result = htmlParser.parse('<div><p style="color: red; expression(alert(1))">Text</p></div>', 'https://example.com');
const doc = domTree.buildFromHtml(result.document);
const ps = domTree.getElementsByTagName('p');
console.log('p count:', ps.length);
if (ps[0]) {
  const style = ps[0].attributes.get('style');
  console.log('style before:', style);
  console.log('style contains expression:', style?.includes('expression'));
}

const sanitizer = new HtmlSanitizer();
sanitizer.sanitize(doc, domTree);
const ps2 = domTree.getElementsByTagName('p');
if (ps2[0]) {
  const style = ps2[0].attributes.get('style');
  console.log('style after:', style);
}

// Test 5: HtmlNode tree for mutation observer
console.log('=== HtmlNode Tree ===');
const result2 = htmlParser.parse('<div><div><p onclick="evil()">Nested</p></div></div>', 'https://example.com');
const htmlDoc = result2.document;
console.log('htmlDoc.children:', htmlDoc.children.length);
if (htmlDoc.children[0]) {
  const html = htmlDoc.children[0] as HtmlElement;
  console.log('html.tagName:', html.tagName);
  console.log('html.children:', html.children.length);
  if (html.children[0]) {
    const body = (html.children.find((c: any) => c.tagName === 'body') || html.children[0]) as HtmlElement;
    console.log('body.tagName:', body.tagName);
    console.log('body.children:', body.children.length);
    if (body.children[0]) {
      const outerDiv = body.children[0] as HtmlElement;
      console.log('outerDiv.tagName:', outerDiv.tagName);
      console.log('outerDiv.children:', outerDiv.children.length);
    }
  }
}
