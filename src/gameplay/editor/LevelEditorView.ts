const LEVEL_EDITOR_VIEW_VERSION = '38';

export const mountLevelEditorView = (host: HTMLElement): void => {
  const hasCurrentView = host.dataset.editorViewVersion === LEVEL_EDITOR_VIEW_VERSION
    && host.querySelector('#editor-simulate-button') !== null;
  if (host.childElementCount > 0 && hasCurrentView) return;

  // Vite can hot-reload the controller while keeping the editor's old DOM.
  // Rebuild stale markup so newly added controls are available before binding.
  host.replaceChildren();
  host.dataset.editorViewVersion = LEVEL_EDITOR_VIEW_VERSION;
  host.setAttribute('aria-labelledby', 'editor-info-title');
  host.innerHTML = `
    <div class="editor-layout">
      <div class="editor-insights-column">
        <aside class="editor-info-panel" aria-labelledby="editor-info-title">
          <div class="editor-info-panel__header">
            <button id="editor-back-button" class="icon-button editor-info-back-button" aria-label="返回大厅">←</button>
            <h3 id="editor-info-title">关卡信息</h3>
          </div>
          <div class="editor-info-summary">
            <div class="editor-info-size">
              <span>关卡尺寸</span>
              <strong id="editor-info-size">8 × 8</strong>
            </div>
            <div class="editor-info-hidden">
              <span>隐藏占比</span>
              <strong id="editor-info-hidden-ratio">0% · 0/0</strong>
            </div>
            <div class="editor-info-run editor-info-visible-run">
              <span>最长连续显示</span>
              <strong id="editor-info-longest-visible-run">0 格</strong>
            </div>
            <div class="editor-info-run editor-info-hidden-run">
              <span>最长连续隐藏</span>
              <strong id="editor-info-longest-hidden-run">0 格</strong>
            </div>
          </div>

          <section class="editor-simulation-panel editor-simulation-panel--embedded" aria-labelledby="editor-simulation-title">
          <div class="editor-simulation-panel__header">
            <div class="editor-simulation-launcher-copy">
              <div class="editor-simulation-launcher-heading">
                <button
                  id="editor-simulation-open-button"
                  class="editor-simulation-open-button"
                  type="button"
                  aria-label="在新窗口打开模拟关卡"
                >
                  <span id="editor-simulation-title">模拟关卡</span>
                  <span class="editor-simulation-open-icon" aria-hidden="true">↗</span>
                </button>
                <button id="editor-simulate-button" class="button button--secondary button--small" type="button" disabled>开始模拟</button>
              </div>
              <p id="editor-simulation-launcher-state">点击标题，在独立窗口查看模拟数据</p>
            </div>
            <div class="editor-simulation-controls">
              <label class="editor-simulation-count">模拟次数
                <input id="editor-simulation-count" type="number" min="1" max="100" step="1" value="1" inputmode="numeric" />
              </label>
              <label class="editor-simulation-reasoning">推理能力
                <select id="editor-simulation-reasoning">
                  <option value="low">低</option>
                  <option value="medium" selected>中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <button id="editor-simulation-export-button" class="button button--secondary button--small" type="button" title="将当前关卡基础数据以 Tab 分隔格式复制到剪贴板" disabled>导出基础数据</button>
            </div>
          </div>
          <p class="editor-simulation-rule">每次从当前格连接到一个相邻格记为一步。七组曲线共享步数横轴，依次展示可连接数量、直接连接、距离下个显示数字、选择数量、路径推理分支数量、合法推理分支数量和每步难度分；红点表示连接错误。</p>
          <div id="editor-simulation-summary" class="editor-simulation-summary" hidden>
            <div><span id="editor-simulation-total-steps-label">总步数</span><strong id="editor-simulation-total-steps">0</strong></div>
            <div><span id="editor-simulation-error-count-label">错误次数</span><strong id="editor-simulation-error-count">0</strong></div>
          </div>
          <div id="editor-simulation-results" class="editor-simulation-results" aria-live="polite">
            <p class="editor-simulation-empty">生成完整路径后，即可模拟一次玩家体验。</p>
          </div>
          </section>
        </aside>

        <aside class="editor-level-panel" aria-label="关卡列表">
          <div class="editor-level-panel__header">
            <div>
              <h3>关卡列表</h3>
            </div>
            <span id="editor-level-count" class="editor-level-count">0 关</span>
          </div>
          <div class="editor-level-actions">
            <button id="editor-level-add" class="button button--primary button--small" disabled>添加当前</button>
            <button id="editor-level-import" class="button button--secondary button--small">读取 JSON</button>
            <button id="editor-level-export" class="button button--secondary button--small" title="按关卡 ID 导出仅包含 data 的 JSON 文本" disabled>导出 TXT</button>
            <button id="editor-level-clear" class="button button--secondary button--small" type="button" title="清空关卡列表" disabled>清空列表</button>
            <div class="editor-batch-playtest-row">
              <div class="editor-batch-playtest-actions">
                <button id="editor-batch-generate-path" class="button button--secondary button--small editor-batch-playtest" type="button" title="读取路径生成配置，批量生成并导出路径统计">批量生成路径</button>
                <button id="editor-batch-generate-hidden" class="button button--secondary button--small editor-batch-playtest" type="button" title="读取隐藏生成配置，批量生成隐藏并导出难度与错误统计">批量生成隐藏</button>
                <select id="editor-batch-hidden-difficulty-mode" class="editor-batch-hidden-difficulty-mode" aria-label="隐藏生成目标难度" title="选择单个难度时只生成该难度；全部难度会对 1–10 每个难度都按生成隐藏数执行">
                  <option value="1">难度 1</option>
                  <option value="2">难度 2</option>
                  <option value="3">难度 3</option>
                  <option value="4">难度 4</option>
                  <option value="5">难度 5</option>
                  <option value="6" selected>难度 6</option>
                  <option value="7">难度 7</option>
                  <option value="8">难度 8</option>
                  <option value="9">难度 9</option>
                  <option value="10">难度 10</option>
                  <option value="all">全部难度 1–10</option>
                </select>
              </div>
              <label class="editor-batch-playtest-header">
                <input id="editor-batch-playtest-header" type="checkbox">
                <span>输出表头</span>
              </label>
            </div>
          </div>
          <div id="editor-level-list" class="editor-level-list"></div>
          <input id="editor-level-file" type="file" accept=".json,application/json" hidden>
          <input id="editor-batch-playtest-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        </aside>
      </div>

      <section class="editor-board-pane" aria-label="棋盘区域">
        <div class="editor-workspace">
          <div id="editor-preview" class="editor-preview" aria-hidden="true"></div>
          <svg id="editor-path-lines" class="editor-path-lines" aria-hidden="true"></svg>
          <div id="editor-simulation-mask" class="editor-simulation-mask" aria-hidden="true"></div>
          <svg id="editor-simulation-overlay" class="editor-simulation-overlay" aria-hidden="true"></svg>
          <div id="editor-grid" class="editor-grid" aria-label="关卡绘制网格"></div>
        </div>
        <p id="editor-status" class="editor-status" aria-live="polite">在网格上拖动，绘制需要一笔覆盖的形状。</p>
      </section>

      <div id="editor-resizer" class="editor-resizer" role="separator" tabindex="0" aria-label="调整棋盘和配置区域宽度" aria-orientation="vertical"></div>

      <aside class="editor-sidebar" aria-label="关卡配置">
        <div class="editor-sidebar__heading">
          <div>
            <h3>关卡配置</h3>
          </div>
          <label class="editor-algorithm-select" aria-label="算法">
            <select id="editor-algorithm">
              <option value="algorithm-1" selected>算法1</option>
            </select>
          </label>
        </div>
        <div id="editor-algorithm-parameters" class="editor-algorithm-parameters"></div>
        <section class="editor-presets" aria-labelledby="editor-presets-title">
          <div class="editor-presets__header">
            <b id="editor-presets-title">配置预设</b>
            <small id="editor-preset-count">0 个</small>
          </div>
          <div class="editor-preset-picker">
            <select id="editor-preset-select" aria-label="选择配置预设" disabled>
              <option value="">暂无预设</option>
            </select>
            <button id="editor-preset-apply" class="button button--secondary button--small" type="button" disabled>应用</button>
            <button id="editor-preset-delete" class="editor-preset-delete" type="button" disabled>删除</button>
          </div>
          <div class="editor-preset-save">
            <input id="editor-preset-name" type="text" maxlength="30" autocomplete="off" placeholder="输入预设名称" aria-label="配置预设名称">
            <button id="editor-preset-save" class="button button--secondary button--small" type="button">保存当前</button>
          </div>
          <small class="editor-presets__hint">保存形状、尺寸、算法及其参数；选中预设后也可改名或更新。</small>
        </section>
        <div class="editor-toolbar">
          <label>手动编辑
            <select id="editor-manual-mode">
              <option value="off" selected>关闭</option>
              <option value="path">手动路径</option>
              <option value="hidden">手动隐藏</option>
            </select>
          </label>
          <label>形状
            <select id="editor-shape">
              <option value="square">正方形</option>
              <option value="diamond">菱形</option>
              <option value="rectangle">长方形</option>
              <option value="hex">六边形蜂窝</option>
            </select>
          </label>
          <div id="editor-uniform-size" class="stepper">
            <span>尺寸</span>
            <button id="editor-size-minus" type="button" aria-label="减小尺寸">−</button>
            <b id="editor-size-value">8 × 8</b>
            <button id="editor-size-plus" type="button" aria-label="增大尺寸">＋</button>
          </div>
          <div id="editor-rectangle-size" class="editor-size-pair" hidden>
            <div class="stepper">
              <span>宽度</span>
              <button id="editor-width-minus" type="button" aria-label="减小宽度">−</button>
              <b id="editor-width-value">5</b>
              <button id="editor-width-plus" type="button" aria-label="增大宽度">＋</button>
            </div>
            <div class="stepper">
              <span>高度</span>
              <button id="editor-height-minus" type="button" aria-label="减小高度">−</button>
              <b id="editor-height-value">8</b>
              <button id="editor-height-plus" type="button" aria-label="增大高度">＋</button>
            </div>
          </div>
          <div class="editor-image-import">
            <div class="editor-image-import__group">
              <div class="editor-image-import__heading"><b>精准识别</b><small>完整关卡支持图片或 JSON</small></div>
              <div class="editor-image-import__actions">
                <button id="editor-image-level-button" class="button button--secondary" type="button" title="从剪贴板读取关卡截图或单个关卡 JSON">识别完整关卡</button>
                <button id="editor-image-hidden-button" class="button button--secondary" type="button">识别隐藏</button>
              </div>
            </div>
            <div class="editor-image-import__group">
              <div class="editor-image-import__heading"><b>快捷识别</b><small>会推测未显示的路径</small></div>
              <button id="editor-image-formation-button" class="button button--secondary" type="button">识别初始阵型</button>
            </div>
            <small class="editor-image-import__shortcut">直接 Ctrl+V：图片使用上次选择，JSON 始终按完整关卡导入</small>
          </div>
        </div>
        <div class="editor-actions">
          <button id="editor-fill-button" class="button button--secondary button--small">填满棋盘</button>
          <button id="editor-clear-button" class="button button--secondary button--small">清空棋盘</button>
          <button id="editor-generate-path-button" class="button button--secondary" type="button">
            <span id="editor-generate-path-label">生成路径</span>
          </button>
          <button id="editor-calculate-hidden-button" class="button button--secondary" type="button" disabled>
            <span id="editor-calculate-hidden-label">计算隐藏</span>
          </button>
          <button id="editor-undo-delete-button" class="button button--secondary button--small" title="Ctrl+Z" disabled>撤销删除</button>
          <button id="editor-copy-formation-button" class="button button--secondary button--small" type="button" title="复制为批量生成路径的“关卡数据”：999 为阵型占位格" disabled>复制阵型</button>
          <button id="editor-playtest-button" class="button button--secondary" disabled>试玩关卡</button>
        </div>
      </aside>

    </div>

    <dialog id="editor-batch-playtest-dialog" class="editor-batch-playtest-dialog" aria-labelledby="editor-batch-playtest-dialog-title">
      <section class="editor-batch-playtest-dialog__card">
        <div class="editor-batch-playtest-dialog__heading">
          <div>
            <small>批量处理</small>
            <h3 id="editor-batch-playtest-dialog-title">正在准备…</h3>
          </div>
          <strong id="editor-batch-playtest-percent">0%</strong>
        </div>
        <progress id="editor-batch-playtest-progress" max="1" value="0" aria-label="批量处理进度"></progress>
        <div class="editor-batch-playtest-dialog__stats">
          <div><span>已完成</span><b id="editor-batch-playtest-completed">0 / 0</b></div>
          <div><span>运行中</span><b id="editor-batch-playtest-running">0</b></div>
          <div><span>失败</span><b id="editor-batch-playtest-failed">0</b></div>
        </div>
        <p id="editor-batch-playtest-detail" class="editor-batch-playtest-dialog__detail" aria-live="polite">正在读取配置…</p>
        <button id="editor-batch-playtest-cancel" class="button button--secondary" type="button">中止并保存已完成结果</button>
      </section>
    </dialog>

  `;
};
