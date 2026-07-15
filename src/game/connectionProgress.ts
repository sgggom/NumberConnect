export type ConnectionFailure = 'hidden-start' | 'non-consecutive' | 'direction-change';

export type ConnectionAction =
  | { type: 'started'; index: number }
  | { type: 'advanced'; index: number; added: boolean; progress: number; complete: boolean }
  | { type: 'wrong'; index: number; reason: ConnectionFailure }
  | { type: 'ignored' };

type Direction = -1 | 1;

export class ConnectionProgress {
  private readonly connectedEdges = new Set<number>();
  private readonly visibleIndices: Set<number>;
  private active?: number;
  private previous?: number;
  private direction?: Direction;

  public constructor(
    private readonly totalNodes: number,
    initiallyVisible: Iterable<number>,
  ) {
    this.visibleIndices = new Set(initiallyVisible);
  }

  public get activeIndex(): number | undefined { return this.active; }
  public get progress(): number { return this.connectedEdges.size === 0 ? 0 : this.connectedEdges.size + 1; }
  public get complete(): boolean {
    return this.totalNodes > 1 && this.connectedEdges.size === this.totalNodes - 1;
  }

  public begin(index: number, allowHidden = false): ConnectionAction {
    if (!this.inBounds(index) || this.complete) return { type: 'ignored' };
    if (!allowHidden && !this.visibleIndices.has(index)) {
      return { type: 'wrong', index, reason: 'hidden-start' };
    }
    this.visibleIndices.add(index);
    this.active = index;
    this.previous = undefined;
    this.direction = undefined;
    return { type: 'started', index };
  }

  public extend(index: number): ConnectionAction {
    if (this.active === undefined || !this.inBounds(index) || this.complete || index === this.active) {
      return { type: 'ignored' };
    }
    if (index === this.previous) return { type: 'ignored' };

    const difference = index - this.active;
    if (Math.abs(difference) !== 1) {
      return { type: 'wrong', index, reason: 'non-consecutive' };
    }
    const nextDirection = Math.sign(difference) as Direction;
    if (this.direction !== undefined && nextDirection !== this.direction) {
      return { type: 'wrong', index, reason: 'direction-change' };
    }

    this.direction = nextDirection;
    const from = this.active;
    const edgeIndex = Math.min(from, index);
    const added = !this.connectedEdges.has(edgeIndex);
    this.connectedEdges.add(edgeIndex);
    this.visibleIndices.add(from);
    this.visibleIndices.add(index);
    this.previous = from;
    this.active = index;
    return { type: 'advanced', index, added, progress: this.progress, complete: this.complete };
  }

  public endStroke(): void {
    this.active = undefined;
    this.previous = undefined;
    this.direction = undefined;
  }

  public isVisible(index: number): boolean { return this.visibleIndices.has(index); }
  public isEdgeConnected(index: number): boolean { return this.connectedEdges.has(index); }
  public isNodeConnected(index: number): boolean {
    return this.connectedEdges.has(index - 1) || this.connectedEdges.has(index);
  }

  public suggestedNextIndex(): number | undefined {
    if (this.active === undefined) return undefined;
    const directions: Direction[] = this.direction === undefined ? [1, -1] : [this.direction];
    for (const direction of directions) {
      let index = this.active + direction;
      while (this.inBounds(index)) {
        if (this.visibleIndices.has(index)) return index;
        index += direction;
      }
    }
    return undefined;
  }

  private inBounds(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.totalNodes;
  }
}
