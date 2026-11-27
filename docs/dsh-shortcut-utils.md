# dsh-shortcut-utils

`dsh-shortcut-utils` 不是可安装的 DSH 插件，没有 `dsh.bundle`、没有客户端半部、也不注册服务。它只放快捷键插件用的**纯函数**：

- `binding.ts`：固定行 / 普通绑定与手势匹配、逻辑修饰键 `primary` 的平台展开、键帽格式化；
- `capture.ts`：捕获阶段读取按键元素、物理手势、输入区域与模态状态。

使用方是 [`dsh-keyboard-shortcuts`](dsh-keyboard-shortcuts.md)（`dsh-changes-behavior` 的变更请求快捷键移除后已不再依赖它）。它的客户端 bundle 会把这几个模块内联进去（没有需要共享的运行时标识），因此包本身不引入任何全局状态，也不会在浏览器里成为单例。

-----

## 为什么单独成包

固定行匹配与捕获层判定需要稳定、可测试的一份实现：复制多份会让修饰键顺序、`primary` 展开规则或 `composedPath` 兜底慢慢分叉。抽成 workspace 包后只有一份源文件，`dsh-keyboard-shortcuts` 与 `dsh-changes-behavior` 仍按需引用（变更请求快捷键移除后，`dsh-changes-behavior` 已不再依赖它）。

`dsh-keyboard-shortcuts` 的 `src/binding.ts` / `src/capture.ts` 保留为一行 `export * from 'dsh-shortcut-utils/…'` 的稳定入口，因此该插件内部与既有测试的 import 不需要改动。

-----

## 边界

- **纯函数**：不读 `document` / `window`、不注册监听、没有模块级可变状态；`capture.ts` 的 `captureContext` 在调用时才读全局 `document`。
- **不发布**：`private: true`，只在本仓库 workspace 内使用；`pnpm install` 会在使用方的 `node_modules` 里建立符号链接。
- **只做类型检查**：包没有构建产物，源文件由使用方的 tsdown 直接编译；`pnpm --filter dsh-shortcut-utils typecheck` 只做 `tsc --noEmit`。
- **不覆盖业务动作**：打开哪个页面、怎么切全屏、怎么消费按键仍由使用方决定，本包只回答“这一按是不是这个绑定 / 落在哪个区域”。
