/**
 * 自声明 react 切片:@types/react 不在 dsh 内置 bundle 里(与 dsh-client-ui-slots /
 * dsh-client-ui-primitives 同理),而 react 是上游 ModuleLoader 的平台 seed 词
 * (window.__ModuleLoader__ 的 staticModules 含 react / react/jsx-runtime),
 * 插件经打包产物里的 require('react') 取用同一份实例。这里只声明本插件实际消费的三个 API。
 */
declare module 'react' {
  export type ReactNode = unknown

  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode

  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]

  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}
