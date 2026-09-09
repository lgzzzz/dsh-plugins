# dsh-no-right-sidebar

关闭 DSH Web 右侧边栏:**直接停用右侧边栏插件的加载**(而非 CSS 隐藏或运行时
收起)。停用后右侧边栏完全不渲染——面板席位、会话头部的展开按钮、guide 页、
工作区文件树页、文本预览页全部消失,对话区不再为右栏保留任何空间。

## 做了什么

`cordis.patch.yml` 停用 dsh-web-app 组合中右侧边栏的全部三行:

| 行 id | 包 | 作用 |
| --- | --- | --- |
| `ui-sidebar-right` | `@deepseek-ai/dsh-client-ui-sidebar-right` | 右栏面板/展开按钮/guide 页,提供 `sidebarRight` 服务 |
| `ui-sidebar-textpreview` | `@deepseek-ai/dsh-client-ui-sidebar-textpreview` | 右栏「文本预览」页类型 |
| `ui-sidebar-files` | `@deepseek-ai/dsh-client-ui-sidebar-files` | 右栏「工作区文件树」页类型 |

## 为什么还带一个浏览器半部(sidebarRight 桩)

**只停用 `ui-sidebar-right` 会瘫痪主聊天界面。** `ui-chat` 的浏览器半部 inject
声明了 `sidebarRight` 服务(点击对话中的文件链接时调用
`ctx.sidebarRight.openResource(…)`),而 cordis 对 inject 未满足的插件保持
INACTIVE、永不 apply——`sidebarRight` 的提供者被停用后,`ui-chat` 会整体
停摆(对话区空白)。

因此本插件的浏览器半部(`src/client.ts`)注册一个 **no-op 桩服务**:

- `ctx.reflect.provide('sidebarRight', stub)`,与原插件同名同席位;
- 桩只实现 `ui-chat` 实际消费的最小接口 `openResource` / `openTab`,行为为
  静默忽略(输出一条 `console.debug` 便于诊断);
- provide 挂在本插件 fiber 上,卸载时由 cordis 自动回收。

已核实(以 0.1.5-alpha.1 内置包源码为准):全组合中 `sidebarRight` 服务的
消费者只有 `ui-chat`;`sidebarRightTabs` 服务的消费者只有被一并停用的
textpreview / files 两行;模块加载器对缺失的包级 inject 依赖容忍跳过
(`arriveGraphRow`),不会因停用而报错。

### 已知副作用

- 点击对话消息里的文件链接不再打开右栏预览(桩静默忽略,控制台有
  `[dsh-no-right-sidebar]` debug 日志)。这是关闭右栏的必然结果。
- 会话头部右上角的「展开右栏」按钮消失(由被停用的 `ui-sidebar-right`
  注册)。

## 加载(用户操作)

```sh
# 方式一:仓库根安装脚本(会安装全部插件,含本插件)
./install.sh        # 或 Windows: powershell -ExecutionPolicy Bypass -File .\install.ps1

# 方式二:单独安装
cd <仓库根>/dsh-no-right-sidebar && dsh plugin --profile web add link:.

# 重启 App 生效(bundle 层为常驻挂载,不支持热重载)
```

卸载:

```sh
dsh plugin --profile web remove dsh-no-right-sidebar
# 重启 App 后右侧边栏恢复
```

生效验证:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/plugins/dsh-no-right-sidebar/client.js
```

## 构建

浏览器半部为 TypeScript 源码(`src/client.ts`),经 esbuild 打包为
`lib/client.js`(入仓,禁止手改);宿主半部 `index.ts` 为占位空宿主,由
Node 22+ Type Stripping 直接加载。

```sh
npm install          # 首次:安装 devDependencies(esbuild / typescript)
npm run typecheck    # tsc --noEmit(index.ts + src/**)
npm run build        # esbuild → lib/client.js
npm run check        # node --check 产物与宿主入口
```

改动 `src/` 后必须 `npm run build` 重新构建,再重启 App——未重新构建是插件
改动未生效的最常见原因。

## 结构

```
dsh-no-right-sidebar/
├── package.json          # dsh.client.platform=web + immediately;bundle.patch
├── index.ts              # 宿主半部(占位空宿主,Type Stripping 直载)
├── cordis.patch.yml      # 停用右栏三行 + 挂载本插件行
├── src/client.ts         # 浏览器半部真源(sidebarRight no-op 桩)
├── scripts/build-client.mjs
├── lib/client.js         # 构建产物(入仓)
└── tsconfig.json
```
