import { query } from './dom';

export type ScreenName = 'lobby' | 'play' | 'editor' | 'bead' | 'collection' | 'daily' | 'endless' | 'favorites';
type PrimaryTab = 'lobby' | 'challenge' | 'endless' | 'favorites';

const primaryTabForScreen: Partial<Record<ScreenName, PrimaryTab>> = {
  lobby: 'lobby',
  daily: 'challenge',
  endless: 'endless',
  favorites: 'favorites',
};

export class ScreenRouter {
  private readonly appShell = query<HTMLElement>('#app');
  private readonly screens: Record<ScreenName, HTMLElement> = {
    lobby: query<HTMLElement>('#lobby-screen'),
    play: query<HTMLElement>('#play-screen'),
    editor: query<HTMLElement>('#editor-screen'),
    bead: query<HTMLElement>('#bead-screen'),
    collection: query<HTMLElement>('#collection-screen'),
    daily: query<HTMLElement>('#daily-screen'),
    endless: query<HTMLElement>('#endless-screen'),
    favorites: query<HTMLElement>('#favorites-screen'),
  };
  private readonly primaryTabBar = query<HTMLElement>('#primary-tab-bar');

  public show(name: ScreenName): void {
    this.appShell.classList.toggle('is-editor-fullscreen', name === 'editor');
    (Object.entries(this.screens) as Array<[ScreenName, HTMLElement]>).forEach(([screenName, screen]) => {
      screen.hidden = screenName !== name;
    });
    const activeTab = primaryTabForScreen[name];
    this.primaryTabBar.hidden = activeTab === undefined;
    this.primaryTabBar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === activeTab;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
}
