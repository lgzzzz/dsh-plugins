declare module 'react' {
  export type ReactNode = unknown

  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode

  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]

  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}
