# Number Connect Web

Unity 版 Number Connect 的浏览器移植版，使用 Phaser、TypeScript 和 Vite。

在线体验：https://sgggom.github.io/NumberConnect/

## 已移植功能

- 5 个内置图案关卡与完成图案展示
- 按顺序拖动连接、隐藏数字、下一数字提示和错误反馈
- 连击、错误和胜利音效
- 普通模式与无尽模式
- 无尽阶段难度成长和棋盘上下切换动画
- 正方形、菱形、长方形程序棋盘
- 隐藏比例、最长显示/隐藏、目标交叉数等设置
- 可绘制、验证、保存并游玩的关卡编辑器
- 设置和自制关卡通过 `localStorage` 保存在浏览器中
- 桌面与移动端响应式布局

## 本地运行

```bash
npm install
npm run dev
```

打开终端显示的本地地址，默认是 `http://localhost:4173/`。

## 验证与构建

```bash
npm test
npm run build
```

生产文件生成在 `dist/`。
