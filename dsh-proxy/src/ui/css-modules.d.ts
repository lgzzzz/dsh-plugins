/**
 * `*.module.css` 的类型声明：类名映射由 tsdown 的 `\0dsh-css:` 虚拟模块在构建期生成，
 * 运行时只是「本地名 → 构建哈希类名」的普通对象。这里只补类型，不参与打包。
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
