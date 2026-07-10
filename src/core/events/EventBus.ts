type EventName<TEvents extends object> = Extract<keyof TEvents, string>;
type EventHandler<TPayload> = (payload: TPayload) => void;
type StoredHandler = (payload: unknown) => void;

export class EventBus<TEvents extends object> {
  private readonly listeners = new Map<EventName<TEvents>, Set<StoredHandler>>();

  public emit<TName extends EventName<TEvents>>(name: TName, payload: TEvents[TName]): void {
    this.listeners.get(name)?.forEach((handler) => handler(payload));
  }

  public on<TName extends EventName<TEvents>>(name: TName, handler: EventHandler<TEvents[TName]>): () => void {
    const storedHandler = handler as unknown as StoredHandler;
    const handlers = this.listeners.get(name) ?? new Set<StoredHandler>();
    handlers.add(storedHandler);
    this.listeners.set(name, handlers);
    return () => {
      handlers.delete(storedHandler);
      if (handlers.size === 0) this.listeners.delete(name);
    };
  }
}
