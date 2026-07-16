const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const STACKED_LAYOUT_BREAKPOINT = 1500;

export class EditorSplitPaneController {
  private readonly minimumSidebarWidth = 260;
  private readonly minimumBoardWidth = 380;
  private sidebarWidth?: number;
  private activePointerId?: number;

  public constructor(
    private readonly layout: HTMLElement,
    private readonly separator: HTMLElement,
  ) {}

  public bind(): void {
    this.separator.addEventListener('pointerdown', (event) => this.startDrag(event));
    this.separator.addEventListener('pointermove', (event) => this.drag(event));
    this.separator.addEventListener('pointerup', (event) => this.endDrag(event));
    this.separator.addEventListener('pointercancel', (event) => this.endDrag(event));
    this.separator.addEventListener('keydown', (event) => this.handleKeydown(event));
    window.addEventListener('resize', () => {
      if (this.sidebarWidth !== undefined) this.setSidebarWidth(this.sidebarWidth);
    });
    this.updateAccessibility(this.currentSidebarWidth());
  }

  private startDrag(event: PointerEvent): void {
    if (window.matchMedia(`(max-width: ${STACKED_LAYOUT_BREAKPOINT}px)`).matches) return;
    event.preventDefault();
    this.activePointerId = event.pointerId;
    this.separator.setPointerCapture(event.pointerId);
    this.layout.classList.add('is-resizing');
    this.resizeFromPointer(event.clientX);
  }

  private drag(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    this.resizeFromPointer(event.clientX);
  }

  private endDrag(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) return;
    if (this.separator.hasPointerCapture(event.pointerId)) this.separator.releasePointerCapture(event.pointerId);
    this.activePointerId = undefined;
    this.layout.classList.remove('is-resizing');
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
    event.preventDefault();
    if (event.key === 'Home') {
      this.setSidebarWidth(340);
      return;
    }
    const direction = event.key === 'ArrowLeft' ? 1 : -1;
    this.setSidebarWidth(this.currentSidebarWidth() + direction * 24);
  }

  private resizeFromPointer(clientX: number): void {
    const bounds = this.layout.getBoundingClientRect();
    const gap = this.columnGap();
    this.setSidebarWidth(
      bounds.right - clientX - this.separator.offsetWidth * 0.5 - this.levelPanelWidth() - gap * 2,
    );
  }

  private setSidebarWidth(requestedWidth: number): void {
    const maximum = Math.max(
      this.minimumSidebarWidth,
      this.layout.clientWidth
        - this.minimumBoardWidth
        - this.infoPanelWidth()
        - this.separator.offsetWidth
        - this.levelPanelWidth()
        - this.columnGap() * 4,
    );
    this.sidebarWidth = clamp(requestedWidth, this.minimumSidebarWidth, maximum);
    this.layout.style.setProperty('--editor-sidebar-width', `${this.sidebarWidth}px`);
    this.updateAccessibility(this.sidebarWidth, maximum);
  }

  private currentSidebarWidth(): number {
    const sidebar = this.layout.querySelector<HTMLElement>('.editor-sidebar');
    return sidebar?.getBoundingClientRect().width ?? 340;
  }

  private levelPanelWidth(): number {
    return this.layout.querySelector<HTMLElement>('.editor-level-panel')?.getBoundingClientRect().width ?? 280;
  }

  private infoPanelWidth(): number {
    return this.layout.querySelector<HTMLElement>('.editor-info-panel')?.getBoundingClientRect().width ?? 208;
  }

  private columnGap(): number {
    return Number.parseFloat(window.getComputedStyle(this.layout).columnGap) || 0;
  }

  private updateAccessibility(width: number, maximum = this.layout.clientWidth
    - this.minimumBoardWidth
    - this.infoPanelWidth()
    - this.separator.offsetWidth
    - this.levelPanelWidth()
    - this.columnGap() * 4): void {
    this.separator.setAttribute('aria-valuemin', String(this.minimumSidebarWidth));
    this.separator.setAttribute('aria-valuemax', String(Math.max(this.minimumSidebarWidth, Math.round(maximum))));
    this.separator.setAttribute('aria-valuenow', String(Math.round(width)));
    this.separator.setAttribute('aria-valuetext', `配置区域宽度 ${Math.round(width)} 像素`);
  }
}
