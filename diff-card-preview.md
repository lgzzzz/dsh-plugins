# Diff 卡片样式预览

用于确认 DSH GUI 中文件变更卡片的渲染效果。

- 第一行：新增文件时的 diff 卡片形态
- 第二行：已修改，用于观察「修改」形态的增删配色与行号
- 第三行：观察行号与上下文行（context lines）的对比度

代码片段也要能正常显示：

```ts
export function previewDiffCard(title: string): string {
  return `diff: ${title}`;
}
```
