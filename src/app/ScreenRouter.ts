import { query } from './dom';

export type ScreenName = 'lobby' | 'play' | 'editor' | 'bead' | 'collection' | 'daily' | 'endless' | 'favorites';
type PrimaryTab = 'lobby' | 'challenge' | 'endless' | 'favorites';

const PRIMARY_TAB_ORDER: readonly PrimaryTab[] = ['lobby', 'challenge', 'endless', 'favorites'];
const TAB_TRANSITION_DURATION_MS = 320;

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
  private currentScreen: ScreenName = 'lobby';
  private tabTransitionToken = 0;
  private tabTransitionAnimations: Animation[] = [];

  public show(name: ScreenName): void {
    const previousScreenName = this.currentScreen;
    const previousTab = primaryTabForScreen[previousScreenName];
    const activeTab = primaryTabForScreen[name];
    const shouldAnimateTabChange = (
      name !== previousScreenName
      && previousTab !== undefined
      && activeTab !== undefined
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    this.cancelTabTransition();
    this.currentScreen = name;
    this.appShell.classList.toggle('is-editor-fullscreen', name === 'editor');
    if (activeTab !== undefined) this.appShell.dataset.primaryTab = activeTab;
    if (shouldAnimateTabChange) {
      this.animatePrimaryTabChange(previousScreenName, name, previousTab, activeTab);
    } else {
      this.showOnly(name);
    }

    this.primaryTabBar.hidden = activeTab === undefined;
    this.primaryTabBar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === activeTab;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  private animatePrimaryTabChange(
    previousName: ScreenName,
    nextName: ScreenName,
    previousTab: PrimaryTab,
    nextTab: PrimaryTab,
  ): void {
    const previousScreen = this.screens[previousName];
    const nextScreen = this.screens[nextName];
    const direction = PRIMARY_TAB_ORDER.indexOf(nextTab) > PRIMARY_TAB_ORDER.indexOf(previousTab) ? 1 : -1;

    (Object.entries(this.screens) as Array<[ScreenName, HTMLElement]>).forEach(([screenName, screen]) => {
      screen.hidden = screenName !== previousName && screenName !== nextName;
    });
    previousScreen.classList.add('is-primary-tab-transition');
    nextScreen.classList.add('is-primary-tab-transition');

    const options: KeyframeAnimationOptions = {
      duration: TAB_TRANSITION_DURATION_MS,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    };
    const outgoing = previousScreen.animate([
      { transform: 'translate3d(0, 0, 0)' },
      { transform: `translate3d(${-100 * direction}%, 0, 0)` },
    ], options);
    const incoming = nextScreen.animate([
      { transform: `translate3d(${100 * direction}%, 0, 0)` },
      { transform: 'translate3d(0, 0, 0)' },
    ], options);
    this.tabTransitionAnimations = [outgoing, incoming];
    const transitionToken = ++this.tabTransitionToken;

    void Promise.allSettled(this.tabTransitionAnimations.map((animation) => animation.finished)).then(() => {
      if (transitionToken !== this.tabTransitionToken) return;
      const completedAnimations = this.tabTransitionAnimations;
      this.tabTransitionAnimations = [];
      completedAnimations.forEach((animation) => animation.cancel());
      this.clearTabTransitionClasses();
      this.showOnly(this.currentScreen);
    });
  }

  private cancelTabTransition(): void {
    this.tabTransitionToken += 1;
    this.tabTransitionAnimations.forEach((animation) => animation.cancel());
    this.tabTransitionAnimations = [];
    this.clearTabTransitionClasses();
  }

  private clearTabTransitionClasses(): void {
    Object.values(this.screens).forEach((screen) => {
      screen.classList.remove('is-primary-tab-transition');
    });
  }

  private showOnly(name: ScreenName): void {
    (Object.entries(this.screens) as Array<[ScreenName, HTMLElement]>).forEach(([screenName, screen]) => {
      screen.hidden = screenName !== name;
    });
  }
}
