import { query } from './dom';

export type ScreenName = 'lobby' | 'play' | 'editor' | 'bead' | 'collection';

export class ScreenRouter {
  private readonly appShell = query<HTMLElement>('#app');
  private readonly screens: Record<ScreenName, HTMLElement> = {
    lobby: query<HTMLElement>('#lobby-screen'),
    play: query<HTMLElement>('#play-screen'),
    editor: query<HTMLElement>('#editor-screen'),
    bead: query<HTMLElement>('#bead-screen'),
    collection: query<HTMLElement>('#collection-screen'),
  };

  public show(name: ScreenName): void {
    this.appShell.classList.toggle('is-editor-fullscreen', name === 'editor');
    (Object.entries(this.screens) as Array<[ScreenName, HTMLElement]>).forEach(([screenName, screen]) => {
      screen.hidden = screenName !== name;
    });
  }
}
