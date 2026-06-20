// A tiny framework-agnostic observable so the core stays free of Vue/React/Svelte.
// Consumers bind it to their own reactivity (Pinia, signals, stores, etc.).

export type Listener<T> = (value: T) => void

export class Observable<T> {
  private listeners = new Set<Listener<T>>()
  constructor(private _value: T) {}

  get value(): T {
    return this._value
  }

  set(v: T): void {
    this._value = v
    this.emit()
  }

  update(fn: (v: T) => T): void {
    this.set(fn(this._value))
  }

  /** Subscribe and receive the current value immediately. Returns an unsubscribe fn. */
  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn)
    fn(this._value)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this._value)
  }
}
