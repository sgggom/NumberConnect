import { query } from './dom';

export interface AmbientPoint {
  x: number;
  y: number;
}

interface AmbientDirection {
  x: number;
  y: number;
}

interface DirectionOption {
  direction: AmbientDirection;
  weight: number;
}

const GRID_SIZE = 60;
const GRID_OFFSET = GRID_SIZE / 2;
const GRID_VISUAL_RADIUS = 520;
const GRID_DOT_MIN_RADIUS = 1.25;
const GRID_DOT_MAX_RADIUS = 20;
const GRID_DOT_PROXIMITY_EXPONENT = 2.2;
const LINE_SPEED = 20;
const ROUTE_RETENTION_RADIUS = GRID_SIZE * 10;
const MAX_ROUTE_POINTS = 128;
const VIEWBOX_CENTER = { x: 215, y: 380 };
const WORLD_ROTATION = 45;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const INITIAL_ROUTE: AmbientPoint[] = [
  { x: -90, y: 270 },
  { x: -30, y: 270 },
  { x: 30, y: 270 },
  { x: 90, y: 270 },
  { x: 90, y: 330 },
  { x: 150, y: 330 },
  { x: 150, y: 390 },
  { x: 210, y: 390 },
];

const samePoint = (left: AmbientPoint, right: AmbientPoint): boolean => left.x === right.x && left.y === right.y;

export const trimAmbientRoute = (
  routePoints: AmbientPoint[],
  head: AmbientPoint,
  retentionRadius: number,
  maximumPoints: number,
): void => {
  const retentionRadiusSquared = retentionRadius ** 2;
  let keepFromIndex = 0;

  for (let index = routePoints.length - 1; index >= 0; index -= 1) {
    const point = routePoints[index];
    const distanceSquared = (point.x - head.x) ** 2 + (point.y - head.y) ** 2;
    if (distanceSquared <= retentionRadiusSquared) continue;
    keepFromIndex = index + 1;
    break;
  }

  if (keepFromIndex > 0) routePoints.splice(0, keepFromIndex);
  const overflow = routePoints.length - maximumPoints;
  if (overflow > 0) routePoints.splice(0, overflow);
};

export const startLobbyAmbientNetwork = (): void => {
  new LobbyAmbientNetwork();
};

class LobbyAmbientNetwork {
  private readonly grid = query<SVGGElement>('#lobby-ambient-grid');
  private readonly routeLayer = query<SVGGElement>('#lobby-ambient-route-layer');
  private readonly routeBase = query<SVGPathElement>('#lobby-ambient-route-base');
  private readonly routeFlow = query<SVGPathElement>('#lobby-ambient-route-flow');
  private readonly routeHead = query<SVGCircleElement>('#lobby-ambient-route-head');
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly gridDots = new Map<string, SVGCircleElement>();

  private readonly routePoints = INITIAL_ROUTE.map((point) => ({ ...point }));
  private direction: AmbientDirection = { x: 1, y: 0 };
  private segmentProgress = 0;
  private animationFrame?: number;
  private previousTimestamp?: number;

  public constructor() {
    this.render();
    this.reducedMotion.addEventListener('change', this.handleMotionPreference);
    if (!this.reducedMotion.matches) this.animationFrame = requestAnimationFrame(this.tick);
  }

  private readonly handleMotionPreference = (): void => {
    if (this.reducedMotion.matches) {
      if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
      this.previousTimestamp = undefined;
      return;
    }

    if (this.animationFrame === undefined) this.animationFrame = requestAnimationFrame(this.tick);
  };

  private readonly tick = (timestamp: number): void => {
    if (this.previousTimestamp !== undefined) {
      const elapsedSeconds = Math.min((timestamp - this.previousTimestamp) / 1000, 0.05);
      this.advance(elapsedSeconds * LINE_SPEED);
      this.render();
    }

    this.previousTimestamp = timestamp;
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private advance(distance: number): void {
    let remainingDistance = distance;

    while (remainingDistance > 0) {
      const segmentRemaining = GRID_SIZE - this.segmentProgress;
      const step = Math.min(remainingDistance, segmentRemaining);
      this.segmentProgress += step;
      remainingDistance -= step;

      if (this.segmentProgress < GRID_SIZE) continue;

      const segmentEnd = this.currentHead();
      this.routePoints.push(segmentEnd);
      this.segmentProgress = 0;
      this.trimRoute(segmentEnd);
      this.direction = this.chooseNextDirection();
    }

    this.trimRoute(this.currentHead());
  }

  private trimRoute(head: AmbientPoint): void {
    trimAmbientRoute(this.routePoints, head, ROUTE_RETENTION_RADIUS, MAX_ROUTE_POINTS);
  }

  private chooseNextDirection(): AmbientDirection {
    const straight = { ...this.direction };
    const left = { x: -this.direction.y, y: this.direction.x };
    const right = { x: this.direction.y, y: -this.direction.x };
    const options: DirectionOption[] = [
      { direction: straight, weight: 0.58 },
      { direction: left, weight: 0.21 },
      { direction: right, weight: 0.21 },
    ];
    const routeEnd = this.routePoints.at(-1) ?? VIEWBOX_CENTER;
    const available = options.filter(({ direction }) => {
      const target = {
        x: routeEnd.x + direction.x * GRID_SIZE,
        y: routeEnd.y + direction.y * GRID_SIZE,
      };
      return !this.routePoints.some((point) => samePoint(point, target));
    });
    const candidates = available.length > 0 ? available : options;
    const totalWeight = candidates.reduce((total, option) => total + option.weight, 0);
    let randomWeight = Math.random() * totalWeight;

    for (const option of candidates) {
      randomWeight -= option.weight;
      if (randomWeight <= 0) return option.direction;
    }

    return candidates.at(-1)?.direction ?? straight;
  }

  private currentHead(): AmbientPoint {
    const routeEnd = this.routePoints.at(-1) ?? VIEWBOX_CENTER;
    return {
      x: routeEnd.x + this.direction.x * this.segmentProgress,
      y: routeEnd.y + this.direction.y * this.segmentProgress,
    };
  }

  private render(): void {
    const head = this.currentHead();
    const routeData = this.routePoints
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
      .concat(`L${head.x} ${head.y}`)
      .join(' ');
    const worldTransform = [
      `translate(${VIEWBOX_CENTER.x} ${VIEWBOX_CENTER.y})`,
      `rotate(${WORLD_ROTATION})`,
      `translate(${-head.x} ${-head.y})`,
    ].join(' ');

    this.grid.setAttribute('transform', worldTransform);
    this.renderGrid(head);
    this.routeLayer.setAttribute('transform', worldTransform);
    this.routeBase.setAttribute('d', routeData);
    this.routeFlow.setAttribute('d', routeData);
    this.routeHead.setAttribute('cx', String(head.x));
    this.routeHead.setAttribute('cy', String(head.y));
  }

  private renderGrid(head: AmbientPoint): void {
    const minimumGridX = Math.ceil((head.x - GRID_VISUAL_RADIUS - GRID_OFFSET) / GRID_SIZE);
    const maximumGridX = Math.floor((head.x + GRID_VISUAL_RADIUS - GRID_OFFSET) / GRID_SIZE);
    const minimumGridY = Math.ceil((head.y - GRID_VISUAL_RADIUS - GRID_OFFSET) / GRID_SIZE);
    const maximumGridY = Math.floor((head.y + GRID_VISUAL_RADIUS - GRID_OFFSET) / GRID_SIZE);
    const visibleDots = new Set<string>();

    for (let gridY = minimumGridY; gridY <= maximumGridY; gridY += 1) {
      const y = GRID_OFFSET + gridY * GRID_SIZE;
      for (let gridX = minimumGridX; gridX <= maximumGridX; gridX += 1) {
        const x = GRID_OFFSET + gridX * GRID_SIZE;
        const distanceFromCenter = Math.hypot(x - head.x, y - head.y);
        if (distanceFromCenter > GRID_VISUAL_RADIUS) continue;

        const key = `${x},${y}`;
        const proximity = 1 - distanceFromCenter / GRID_VISUAL_RADIUS;
        const curvedProximity = proximity ** GRID_DOT_PROXIMITY_EXPONENT;
        const radius = GRID_DOT_MIN_RADIUS
          + (GRID_DOT_MAX_RADIUS - GRID_DOT_MIN_RADIUS) * curvedProximity;
        let dot = this.gridDots.get(key);

        if (!dot) {
          dot = document.createElementNS(SVG_NAMESPACE, 'circle');
          dot.classList.add('lobby-ambient-grid-dot');
          dot.setAttribute('cx', String(x));
          dot.setAttribute('cy', String(y));
          this.grid.append(dot);
          this.gridDots.set(key, dot);
        }

        dot.setAttribute('r', radius.toFixed(2));
        visibleDots.add(key);
      }
    }

    for (const [key, dot] of this.gridDots) {
      if (visibleDots.has(key)) continue;
      dot.remove();
      this.gridDots.delete(key);
    }
  }

}
