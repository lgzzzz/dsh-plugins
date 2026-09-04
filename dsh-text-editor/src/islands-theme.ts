/**
 * islands_dark.json（intellij-idea-islands-dark，VS Code / TextMate 颜色主题格式）
 * → Monaco IStandaloneThemeData 的运行时转换，并以 dsh-islands-dark 之名注册。
 *
 * 该 JSON 不是 Monaco 主题格式（缺 base/inherit/rules），本模块做一次性转换：
 *   - tokenColors → rules：scope 数组拍平为 { token, ... }，顺序保持文件原序
 *     （TextMate 主题惯例：具体作用域在前，宽泛在后，Monaco 按最长前缀命中）；
 *   - colors 全部透传：Monaco 只消费 editor.* / diffEditor.* / minimap.* 等已知键，
 *     其余惰性忽略，无需白名单过滤；
 *   - semanticTokenColors / semanticHighlighting 丢弃：本插件只有 Monarch 基础
 *     tokenizer（无语言 worker、无语义 token 源），该数据不可能被消费。
 *
 * 局限（见可行性分析）：Monarch 只产出宽泛 scope（comment/keyword/string/…），
 * 大量细粒度 TextMate scope 不会命中 → 还原度为近似；含空格/逗号的 TextMate
 * 组合选择器（如 "comment.block.documentation variable"）Monaco token 无法命中，
 * 直接跳过。颜色值全为标准 hex，defineTheme 不会遇到不可解析色值。
 */
import islandsDark from '../islands_dark.json' with { type: 'json' }

/** 注册到 Monaco 的主题名（深色模式下 currentTheme() 返回它）。 */
export const ISLANDS_DARK_THEME = 'dsh-islands-dark'

/** 目标 Monaco 全局的最小面（结构切片，避免反向 import monaco.ts 造成依赖环）。 */
interface ThemeMonaco {
  editor: {
    defineTheme(themeName: string, themeData: Record<string, unknown>): void
  }
}

/** 转换后的一条 Monaco 主题规则。 */
interface ThemeRule {
  token: string
  foreground?: string
  background?: string
  fontStyle?: string
}

/** islands_dark.json 中单条 tokenColors 的窄类型面（防御推断出的字面量类型）。 */
interface RawTokenColor {
  scope: string | string[]
  settings?: {
    foreground?: string
    background?: string
    fontStyle?: string
  }
}

let defined = false

/** 把 islands_dark.json 注册为 dsh-islands-dark 主题（幂等；须在 editor.create 前调用）。 */
export function defineIslandsDarkTheme(monaco: ThemeMonaco): void {
  if (defined) return
  monaco.editor.defineTheme(ISLANDS_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: toMonacoRules(),
    colors: islandsDark.colors,
  })
  defined = true
}

/** tokenColors（TextMate scope）→ Monaco rules（token 前缀命中式）。 */
function toMonacoRules(): ThemeRule[] {
  const entries = islandsDark.tokenColors as unknown as RawTokenColor[]
  const rules: ThemeRule[] = []
  for (const entry of entries) {
    const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope]
    const settings = entry.settings
    if (settings === null || settings === undefined) continue
    const { foreground, background, fontStyle } = settings
    // 整条 settings 为空 → 规则无样式，无意义，跳过。
    if (foreground === undefined && background === undefined && fontStyle === undefined) continue
    for (const scope of scopes) {
      // 含空格（后代选择器）或逗号（选择器组）的 TextMate selector 无法对应
      // 任何 Monarch token，跳过；Monaco 无组合选择器语义。
      if (scope === '' || /[\s,]/.test(scope)) continue
      const rule: ThemeRule = { token: scope }
      if (foreground !== undefined) rule.foreground = foreground
      if (background !== undefined) rule.background = background
      if (fontStyle !== undefined && fontStyle !== '') rule.fontStyle = fontStyle
      rules.push(rule)
    }
  }
  return rules
}
