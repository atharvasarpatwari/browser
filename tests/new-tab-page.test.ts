import { describe, it, expect } from 'vitest';
import { NewTabPage } from '../src/ui/pages/new-tab-page';
import { SearchEngineManager, BUILT_IN_ENGINES } from '../src/browser/omnibox/search-engine';

function createDomContainer(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'test';
  return div;
}

describe('NewTabPage search engine dropdown (unit)', () => {
  it('renders an entry for every engine in the manager after setSearchEngineManager', () => {
    const page = new NewTabPage();
    const manager = new SearchEngineManager();
    const container = createDomContainer();
    page.mount(container);
    page.setSearchEngineManager(manager);

    const engineBtn = container.querySelector('.ntp-engine-btn') as HTMLElement;
    expect(engineBtn.textContent).toBe(manager.getDefaultEngine().name);

    engineBtn.click();
    const items = container.querySelectorAll('.ntp-dropdown-item');
    expect(items.length).toBe(manager.getEngines().length);
    expect(items.length).toBe(BUILT_IN_ENGINES.length);
    expect(engineBtn.textContent).toBe('Nova'); // Nova is the default engine out of the box
  });

  it('switching engines in the dropdown updates the manager default and the label', () => {
    const page = new NewTabPage();
    const manager = new SearchEngineManager();
    const container = createDomContainer();
    page.mount(container);
    page.setSearchEngineManager(manager);

    const github = manager.getEngines().find(e => e.name === 'GitHub')!;
    const engineBtn = container.querySelector('.ntp-engine-btn') as HTMLElement;
    engineBtn.click();

    const items = Array.from(container.querySelectorAll('.ntp-dropdown-item')) as HTMLElement[];
    const githubItem = items.find(i => i.textContent?.includes('GitHub'))!;
    githubItem.click();

    expect(manager.getDefaultEngine().id).toBe(github.id);
    expect(engineBtn.textContent).toBe('GitHub');
  });

  it('search input builds the URL from the manager default engine, not a hardcoded template', () => {
    const page = new NewTabPage();
    const manager = new SearchEngineManager();
    manager.setDefaultEngine(manager.getEngines().find(e => e.name === 'Bing')!.id);
    const container = createDomContainer();
    page.mount(container);
    page.setSearchEngineManager(manager);

    let navigatedUrl = '';
    page.on('navigate', (event) => { navigatedUrl = event.url ?? ''; });

    const input = container.querySelector('input') as HTMLInputElement;
    input.value = 'test query';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(navigatedUrl).toBe('https://www.bing.com/search?q=test%20query');
  });

  it('searches Nova by default, with or without a manager', () => {
    const search = (page: NewTabPage, container: HTMLElement): string => {
      let url = '';
      page.on('navigate', (event) => { url = event.url ?? ''; });
      const input = container.querySelector('input') as HTMLInputElement;
      input.value = 'test query';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      return url;
    };

    const withManager = new NewTabPage();
    const c1 = createDomContainer();
    withManager.mount(c1);
    withManager.setSearchEngineManager(new SearchEngineManager());
    expect(search(withManager, c1)).toBe('nova://search?q=test%20query');

    const bare = new NewTabPage();
    const c2 = createDomContainer();
    bare.mount(c2);
    expect(search(bare, c2)).toBe('nova://search?q=test%20query');
  });
});
