import { describe, it, expect } from 'vitest';
import { ContentRenderer } from '../src/ui/components/content-renderer/content-renderer';
import type { SearchResult } from '../src/ui/components/content-renderer/content-renderer';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('ContentRenderer', () => {
  describe('attach / renderHtml', () => {
    it('should render raw HTML into the container', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderHtml('<h1>Hello</h1>');

      expect(container.querySelector('iframe')).not.toBeNull();
      const iframe = container.querySelector('iframe') as HTMLIFrameElement;
      expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-scripts allow-forms allow-popups');
    });

    it('should set title on the rendered document', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderHtml('<p>Content</p>', { title: 'My Page' });

      const iframe = container.querySelector('iframe') as HTMLIFrameElement;
      expect(iframe).not.toBeNull();
    });

    it('should do nothing when not attached', () => {
      const renderer = new ContentRenderer();
      renderer.renderHtml('<h1>No-op</h1>');
      // Should not throw.
    });
  });

  describe('renderSearchResults', () => {
    it('should render a search bar with the query', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      const results: SearchResult[] = [
        { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
      ];

      renderer.renderSearchResults('test query', 'https://duckduckgo.com/?q=test+query', results);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe('test query');
    });

    it('should render result items', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      const results: SearchResult[] = [
        { title: 'First', url: 'https://a.com', snippet: 'Snippet A' },
        { title: 'Second', url: 'https://b.com', snippet: 'Snippet B' },
      ];

      renderer.renderSearchResults('query', 'https://search.url', results);

      const links = container.querySelectorAll('a');
      // 2 result links + 1 footer link
      expect(links.length).toBe(3);
      expect(links[0].textContent).toBe('First');
      expect(links[1].textContent).toBe('Second');
    });

    it('should show no-results message when results is empty', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderSearchResults('nothing', 'https://search.url', []);

      expect(container.textContent).toContain('No results found');
      expect(container.textContent).toContain('nothing');
    });

    it('should dispatch nova-navigate when a result link is clicked', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      let navigatedUrl = '';
      container.addEventListener('nova-navigate', ((e: CustomEvent) => {
        navigatedUrl = e.detail.url;
      }) as EventListener);

      const results: SearchResult[] = [
        { title: 'Link', url: 'https://target.com', snippet: 'Click me' },
      ];
      renderer.renderSearchResults('q', 'https://search.url', results);

      const link = container.querySelector('a') as HTMLAnchorElement;
      link.click();

      expect(navigatedUrl).toBe('https://target.com');
    });

    it('should include a powered-by footer', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderSearchResults('q', 'https://search.url', []);

      expect(container.textContent).toContain('Search powered by');
    });
  });

  describe('renderError', () => {
    it('should display error title and message', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderError('Connection Failed', 'Could not reach server.', 'https://down.com');

      expect(container.textContent).toContain('Connection Failed');
      expect(container.textContent).toContain('Could not reach server.');
      expect(container.textContent).toContain('https://down.com');
    });

    it('should render without URL', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderError('Oops', 'Something went wrong.');

      expect(container.textContent).toContain('Oops');
      expect(container.textContent).toContain('Something went wrong.');
    });
  });

  describe('renderLoading', () => {
    it('should display a loading spinner and URL', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderLoading('https://example.com');

      expect(container.textContent).toContain('Loading');
      expect(container.textContent).toContain('example.com');
      // Should contain a style element for the spinner animation.
      expect(container.querySelector('style')).not.toBeNull();
    });
  });

  describe('renderNewTab', () => {
    it('should display the Nova branding', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderNewTab();

      expect(container.textContent).toContain('Nova');
      expect(container.textContent).toContain('Private');
      expect(container.textContent).toContain('Search the web');
    });
  });

  describe('clear / dispose', () => {
    it('should remove all content on clear', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderHtml('<p>Something</p>');
      expect(container.children.length).toBeGreaterThan(0);

      renderer.clear();
      expect(container.innerHTML).toBe('');
    });

    it('should clear and null the container on dispose', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderHtml('<p>Content</p>');
      renderer.dispose();
      expect(container.innerHTML).toBe('');
    });
  });

  describe('HTML escaping', () => {
    it('should escape HTML in search queries', () => {
      const container = makeContainer();
      const renderer = new ContentRenderer();
      renderer.attach(container);

      renderer.renderSearchResults('<script>alert(1)</script>', 'https://search.url', []);

      // The escaped script tag should NOT create a real script element.
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('input')).not.toBeNull();
    });
  });
});
