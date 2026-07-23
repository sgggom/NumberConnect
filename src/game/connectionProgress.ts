export type ConnectionFailure =
  | 'hidden-start'
  | 'non-consecutive'
  | 'direction-change'
  | 'click-order';

export type ConnectionAction =
  | { type: 'started'; index: number }
  | { type: 'advanced'; index: number; added: boolean; progress: number; complete: boolean }
  | { type: 'wrong'; index: number; reason: ConnectionFailure }
  | { type: 'ignored' };

export interface ConnectionHint {
  index: number;
  consecutive: boolean;
}

type Direction = -1 | 1;
type SwapChoice = 'authored' | 'swapped';

interface SwapSegment {
  firstIndex: number;
  secondIndex: number;
  choice?: SwapChoice;
}

interface TransitionOption {
  direction: Direction;
  segment?: SwapSegment;
  choice?: SwapChoice;
}

const edgeKey = (left: number, right: number): string =>
  left < right ? `${left}:${right}` : `${right}:${left}`;

export class ConnectionProgress {
  private readonly connectedEdges = new Map<string, readonly [number, number]>();
  private readonly connectedNodes = new Set<number>();
  private readonly visibleIndices: Set<number>;
  private readonly swapSegments: SwapSegment[];
  private active?: number;
  private previous?: number;
  private direction?: Direction;
  private clickAnchor?: number;

  public constructor(
    private readonly totalNodes: number,
    initiallyVisible: Iterable<number>,
    swappableHiddenPairs: Iterable<readonly [number, number]> = [],
  ) {
    this.visibleIndices = new Set(initiallyVisible);
    this.swapSegments = [...swappableHiddenPairs]
      .filter(([firstIndex, secondIndex]) => (
        Number.isInteger(firstIndex)
        && secondIndex === firstIndex + 1
        && firstIndex > 0
        && secondIndex < totalNodes - 1
      ))
      .map(([firstIndex, secondIndex]) => ({ firstIndex, secondIndex }));
  }

  public get activeIndex(): number | undefined { return this.active; }
  public get progress(): number { return this.connectedEdges.size === 0 ? 0 : this.connectedEdges.size + 1; }
  public get complete(): boolean {
    return this.totalNodes > 1 && this.connectedEdges.size === this.totalNodes - 1;
  }
  public get currentClickIndex(): number | undefined {
    const orderedIndices = this.orderedIndices();
    this.syncClickAnchor(orderedIndices);
    return this.clickAnchor ?? orderedIndices[0];
  }

  public begin(index: number, allowHidden = false): ConnectionAction {
    if (!this.inBounds(index) || this.complete) return { type: 'ignored' };
    if (!allowHidden && !this.visibleIndices.has(index)) {
      return { type: 'wrong', index, reason: 'hidden-start' };
    }
    const segmentDirection = this.segmentStartDirection(index);
    if (segmentDirection === null) return { type: 'ignored' };
    this.visibleIndices.add(index);
    this.active = index;
    this.previous = undefined;
    this.direction = segmentDirection;
    return { type: 'started', index };
  }

  public extend(index: number): ConnectionAction {
    if (this.active === undefined || !this.inBounds(index) || this.complete || index === this.active) {
      return { type: 'ignored' };
    }
    if (index === this.previous) return { type: 'ignored' };

    const targetAlreadyConnected = this.isNodeConnected(index);
    const options = this.transitionOptions(this.active, index);
    if (options.length === 0) {
      if (targetAlreadyConnected) return { type: 'ignored' };
      return { type: 'wrong', index, reason: 'non-consecutive' };
    }
    const connectionKey = edgeKey(this.active, index);
    if (this.connectedEdges.has(connectionKey)) return { type: 'ignored' };

    const validOptions = this.direction === undefined
      ? options
      : options.filter(({ direction }) => direction === this.direction);
    if (validOptions.length === 0) {
      if (targetAlreadyConnected) return { type: 'ignored' };
      return { type: 'wrong', index, reason: 'direction-change' };
    }

    const selected = validOptions[0];
    if (selected.segment && selected.choice) selected.segment.choice = selected.choice;
    this.direction = selected.direction;
    const from = this.active;
    this.connectedEdges.set(
      connectionKey,
      from < index ? [from, index] : [index, from],
    );
    this.connectedNodes.add(from);
    this.connectedNodes.add(index);
    this.visibleIndices.add(from);
    this.visibleIndices.add(index);
    this.previous = from;
    this.active = index;
    return { type: 'advanced', index, added: true, progress: this.progress, complete: this.complete };
  }

  public clickForward(index: number): ConnectionAction[] {
    if (!this.inBounds(index) || this.complete) return [{ type: 'ignored' }];

    const orderedIndices = this.orderedIndices();
    this.syncClickAnchor(orderedIndices);
    this.clickAnchor ??= orderedIndices[0];
    if (index === this.clickAnchor) return [{ type: 'ignored' }];

    const actions: ConnectionAction[] = [];
    if (this.active !== this.clickAnchor) {
      const started = this.begin(this.clickAnchor, true);
      actions.push(started);
      if (started.type === 'wrong') return actions;
    }

    if (this.followConnectedClickEdge(index)) {
      this.clickAnchor = index;
      return actions.length > 0 ? actions : [{ type: 'ignored' }];
    }

    const action = this.extend(index);
    if (action.type === 'wrong') {
      actions.push({ type: 'wrong', index, reason: 'click-order' });
      return actions;
    }
    actions.push(action);
    if (action.type === 'advanced' && (this.active === index || this.complete)) this.clickAnchor = index;
    return actions.length > 0 ? actions : [{ type: 'ignored' }];
  }

  public enableClickMode(): void {
    const firstIndex = this.orderedIndices()[0];
    if (firstIndex !== undefined) this.visibleIndices.add(firstIndex);
  }

  public endStroke(): void {
    this.active = undefined;
    this.previous = undefined;
    this.direction = undefined;
  }

  public revealIndices(indices: Iterable<number>): number {
    const revealed = new Set<number>();
    for (const index of indices) {
      if (!this.inBounds(index) || this.visibleIndices.has(index)) continue;
      this.visibleIndices.add(index);
      revealed.add(index);
    }
    if (revealed.size === 0) return 0;

    for (let index = this.swapSegments.length - 1; index >= 0; index -= 1) {
      const segment = this.swapSegments[index];
      if (
        segment.choice === undefined
        && (revealed.has(segment.firstIndex) || revealed.has(segment.secondIndex))
      ) {
        this.swapSegments.splice(index, 1);
      }
    }
    return revealed.size;
  }

  public isVisible(index: number): boolean { return this.visibleIndices.has(index); }
  public isEdgeConnected(index: number): boolean {
    return this.connectedEdges.has(edgeKey(index, index + 1));
  }
  public connectedNodePairs(): Array<readonly [number, number]> {
    return [...this.connectedEdges.values()];
  }
  public displayNumber(index: number): number {
    const position = this.orderedIndices().indexOf(index);
    return position < 0 ? index + 1 : position + 1;
  }
  public isNodeConnected(index: number): boolean {
    return this.connectedNodes.has(index);
  }

  public suggestedNextHint(): ConnectionHint | undefined {
    if (this.active === undefined) return undefined;
    const directions: Direction[] = this.direction === undefined ? [1, -1] : [this.direction];
    const orderedIndices = this.orderedIndices();
    const activePosition = orderedIndices.indexOf(this.active);
    if (activePosition < 0) return undefined;
    for (const direction of directions) {
      let position = activePosition + direction;
      while (this.inBounds(position)) {
        const index = orderedIndices[position];
        if (this.visibleIndices.has(index)) {
          return { index, consecutive: Math.abs(position - activePosition) === 1 };
        }
        position += direction;
      }
    }
    return undefined;
  }

  public suggestedNextIndex(): number | undefined {
    return this.suggestedNextHint()?.index;
  }

  private inBounds(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.totalNodes;
  }

  private syncClickAnchor(orderedIndices: ReadonlyArray<number>): void {
    let position = 0;
    while (
      position < orderedIndices.length - 1
      && this.connectedEdges.has(edgeKey(orderedIndices[position], orderedIndices[position + 1]))
    ) {
      position += 1;
    }
    if (position === 0) return;
    const currentPosition = this.clickAnchor === undefined
      ? -1
      : orderedIndices.indexOf(this.clickAnchor);
    if (position > currentPosition) this.clickAnchor = orderedIndices[position];
  }

  private followConnectedClickEdge(index: number): boolean {
    if (this.active === undefined || !this.connectedEdges.has(edgeKey(this.active, index))) return false;
    const options = this.transitionOptions(this.active, index);
    const selected = options.find((option) => this.direction === undefined || option.direction === this.direction);
    if (!selected) return false;
    if (selected.segment && selected.choice) selected.segment.choice = selected.choice;
    const from = this.active;
    this.direction = selected.direction;
    this.previous = from;
    this.active = index;
    this.visibleIndices.add(index);
    return true;
  }

  private segmentStartDirection(index: number): Direction | null | undefined {
    const connectedNeighbors = [...this.connectedEdges.values()].flatMap(([left, right]) => {
      if (left === index) return [right];
      if (right === index) return [left];
      return [];
    });
    if (connectedNeighbors.length === 0) return undefined;
    if (connectedNeighbors.length > 1) return null;

    const orderedIndices = this.orderedIndices();
    const position = orderedIndices.indexOf(index);
    const neighborPosition = orderedIndices.indexOf(connectedNeighbors[0]);
    if (neighborPosition < position) return 1;
    if (neighborPosition > position) return -1;
    return undefined;
  }

  private transitionOptions(from: number, to: number): TransitionOption[] {
    const connectionKey = edgeKey(from, to);

    for (const segment of this.swapSegments) {
      const authoredOrder = [
        segment.firstIndex - 1,
        segment.firstIndex,
        segment.secondIndex,
        segment.secondIndex + 1,
      ];
      const swappedOrder = [
        segment.firstIndex - 1,
        segment.secondIndex,
        segment.firstIndex,
        segment.secondIndex + 1,
      ];
      const controlledEdges = new Set([
        ...this.orderEdgeKeys(authoredOrder),
        ...this.orderEdgeKeys(swappedOrder),
      ]);
      if (!controlledEdges.has(connectionKey)) continue;

      const choices: SwapChoice[] = segment.choice
        ? [segment.choice]
        : ['authored', 'swapped'];
      return choices.flatMap((choice): TransitionOption[] => {
        const order = choice === 'authored' ? authoredOrder : swappedOrder;
        const fromPosition = order.indexOf(from);
        const toPosition = order.indexOf(to);
        if (fromPosition < 0 || Math.abs(toPosition - fromPosition) !== 1) return [];
        return [{
          direction: Math.sign(toPosition - fromPosition) as Direction,
          segment,
          choice,
        }];
      });
    }

    if (Math.abs(to - from) !== 1) return [];
    return [{ direction: Math.sign(to - from) as Direction }];
  }

  private orderEdgeKeys(order: ReadonlyArray<number>): string[] {
    return order.slice(0, -1).map((value, index) => edgeKey(value, order[index + 1]));
  }

  private orderedIndices(): number[] {
    const result = Array.from({ length: this.totalNodes }, (_, index) => index);
    this.swapSegments.forEach((segment) => {
      if (segment.choice !== 'swapped') return;
      [result[segment.firstIndex], result[segment.secondIndex]] = [
        result[segment.secondIndex],
        result[segment.firstIndex],
      ];
    });
    return result;
  }
}
