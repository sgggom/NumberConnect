# 关卡编辑器算法扩展

编辑器算法采用独立策略模块。算法可以拥有完全不同的参数结构和路径逻辑，不要求与算法1共享数值字段。

## 数据结构

关卡 JSON 使用以下字段保存算法选择：

```json
{
  "algorithm": {
    "id": "algorithm-1",
    "parameters": {
      "topology": "board-shape",
      "pathMode": "single-stroke",
      "targetCrossings": 0
    }
  }
}
```

旧关卡缺少 `algorithm` 时按算法1读取。

六边形蜂窝棋盘不产生交叉，算法1会强制将 `targetCrossings` 解析并保存为 `0`。

## 新增算法

1. 在 `types.ts` 定义独立参数接口和 selection，并加入 `EditorAlgorithmSelection` 联合类型。
2. 新建算法模块，实现默认参数和执行逻辑。
3. 在 `registry.ts` 注册名称、说明、兼容解析和运行分派。
4. 在 `parameterEditors.ts` 添加该算法专属的 DOM 参数面板。
5. 算法运行只接收 `EditorAlgorithmContext`，不要直接访问控制器、视图或 localStorage。

算法模块负责规则，参数编辑器负责 DOM，`LevelEditorModel` 只保存选择并调用注册表。
