declare module 'saxen' {
  export class Parser {
    public constructor(options?: { proxy?: boolean });
    public on(name: string, callback: (...args: any[]) => void): this;
    public write(xml: string): void;
    public end(): void;
  }
}
