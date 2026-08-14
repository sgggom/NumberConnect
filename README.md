# Number Connect Core Puzzle

从 Number Connect Web 迁移出的独立 Phaser、TypeScript、Vite 项目，产品入口仅保留以下模块：

- 大厅
- 拼图主玩法
- 算法 8 关卡编辑器
- 每日挑战
- 拼豆玩法与拼豆图鉴

算法 8 仍复用原项目的底层路径生成器；这些内部模块不作为编辑器算法选项暴露。无尽模式、收藏主导航和玩法 3/4/5 均不在当前产品入口中。

## 本地运行

```bash
npm install
npm run dev
```

Vite 默认会输出本地访问地址。

## 验证与构建

```bash
npm test
npm run build
```

生产文件生成在 `dist/`。

## 拼豆数据

`public/bead-patterns/patterns.json` 保存图案索引；各图案 JSON 使用 `data` 二维数组，颜色为 `#RRGGBB`，空格为 `null`。
