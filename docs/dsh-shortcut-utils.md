# dsh-shortcut-utils

`dsh-shortcut-utils` 不是可安装的 DSH 插件，没有 `dsh.bundle`、没有客户端半部、也不注册服务。它只放两个快捷键插件共用的**纯函数**：

- `binding.ts`：固定行 / 普通绑定与手势匹配、逻辑修饰键 `primary` 的平台展开、键帽格式化；
- `capture.ts`：捕获阶段读取按键元素、物理手势、输入区域与模态状态。

使用方是 [`dsh-keyboard-shortcuts`](dsh-keyboard-shortcuts.md) 与 [`dsh-changes-behavior`](dsh-changes-behavior.md)。两边的客户端 bundle 都会把这几个模块内联进去（它们没有需要共享的运行时标识），因此包本身不引入任何全局状态，也不会在浏览器里成为单例。

-----

## 为什么单独成包

`⌘⌥Y` 打开「变更请求」从 `dsh-keyboard-shortcuts` 迁到 `dsh-changes-behavior` 后，两个插件都需要同一套固定行匹配与捕获层判定。复制两份会让修饰键顺序、`primary` 展开规则或 `composedPath` 兜底在两边慢慢分叉；抽成 workspace 包后只有一份源文件。

`dsh-keyboard-shortcuts` 的 `src/binding.ts` / `src/capture.ts` 保留为一行 `export * from 'dsh-shortcut-utils/…'` 的稳定入口，因此该插件内部与既有测试的 import 不需要改动。

-----

## 边界

- **纯函数**：不读 `document` / `window`、不注册监听、没有模块级可变状态；`capture.ts` 的 `captureContext` 在调用时才读全局 `document`。
- **不发布**：`private: true`，只在本仓库 workspace 内使用；`pnpm install` 会在使用方的 `node_modules` 里建立符号链接。
- **只做类型检查**：包没有构建产物，源文件由使用方的 tsdown 直接编译；`pnpm --filter dsh-shortcut-utils typecheck` 只做 `tsc --noEmit`。
- **不覆盖业务动作**：打开哪个页面、怎么切全屏、怎么消费按键仍由使用方决定，本包只回答“这一按是不是这个绑定 / 落在哪个区域”。
