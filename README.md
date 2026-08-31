# Number Connect Core Puzzle

从 Number Connect Web 迁移出的独立 Phaser、TypeScript、Vite 项目，产品入口仅保留以下模块：

- 大厅
- 拼图主玩法
- 算法 1 关卡编辑器
- 每日挑战
- 拼豆玩法与拼豆图鉴

算法 1 沿用原算法 8 的生成逻辑；旧关卡中的 `algorithm-8` 会在读取时兼容为算法 1。其他历史内部算法不作为编辑器选项暴露。无尽模式、收藏主导航和玩法 3/4/5 均不在当前产品入口中。

关卡编辑器提供两个独立的批量功能。“批量生成路径”读取 `excel/批量生成路径配置模板.xlsx`，以仅含 `0/999` 的棋盘造型生成路径，导出路径 JSON、交叉、拐弯、方向和起终点统计；“批量生成隐藏”读取 `excel/批量生成隐藏配置模板.xlsx`，以不含 `999` 的连续编号路径生成隐藏布局并模拟跑关，导出隐藏、难度和低/中/高错误统计。两者的棋盘宽高都直接由“关卡数据”二维数组推导。

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

## 三模式关卡数据

`public/levels/three-mode-level-library.json` 是玩法 3、4、5 共用的关卡库。普通阵型 ID 使用
`level_阵型_路径_难度`，最后一段为 1–10 档难度；`guide_*` 为引导关卡。

`public/levels/three-mode-level-config.txt` 保存三模式正式关卡配置。每行是一关，方括号中的阵型 ID
按顺序分别代表这一关的各个阶段；普通 ID 的尾段同时是该阶段的默认难度。例如：

```text
id  "levelName"
1   [guide_41_1,guide_33_1]
11  [level_55_210_4,level_55_95_3,level_57_189_4,level_710_569_6]
```

解析与按难度取变体的入口位于 `src/gameplay/adaptive/threeModeLevelData.ts`。未传目标难度时使用配置
ID 的默认档；传入动态难度时只替换 ID 的最后一段，并从同一个阵型/路径家族中取对应的 1–10 档数据。
