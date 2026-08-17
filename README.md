# Number Connect Core Puzzle

从 Number Connect Web 迁移出的独立 Phaser、TypeScript、Vite 项目，产品入口仅保留以下模块：

- 大厅
- 拼图主玩法
- 算法 1 关卡编辑器
- 每日挑战
- 拼豆玩法与拼豆图鉴

算法 1 沿用原算法 8 的生成逻辑；旧关卡中的 `algorithm-8` 会在读取时兼容为算法 1。其他历史内部算法不作为编辑器选项暴露。无尽模式、收藏主导航和玩法 3/4/5 均不在当前产品入口中。

关卡编辑器的“批量跑关”可读取 `excel/批量跑关配置模板.xlsx`：按启用行批量生成算法 1 关卡、执行模拟，并导出带关卡 JSON、实际布局指标和跑关统计的 Tab 分隔结果文件。

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
