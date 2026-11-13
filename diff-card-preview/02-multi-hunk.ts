export interface HunkOptions {
  title: string;
}

export function firstHunk(opts: HunkOptions): string {
  const label = `first: ${opts.title}`;
  const normalized = label.trim();
  return normalized.toLowerCase();
}

// 下面这一大段用于制造两处相距较远的改动，
// 让 diff 卡片出现两个独立的 hunk（中间用省略号折叠）。
// 填充行 1
// 填充行 2
// 填充行 3
// 填充行 4
// 填充行 5
// 填充行 6
// 填充行 7
// 填充行 8
// 填充行 9
// 填充行 10
// 填充行 11
// 填充行 12
// 填充行 13
// 填充行 14
// 填充行 15
// 填充行 16
// 填充行 17
// 填充行 18
// 填充行 19
// 填充行 20

export function secondHunk(opts: HunkOptions): string {
  const label = `second: ${opts.title}`;
  return label.toUpperCase();
}
