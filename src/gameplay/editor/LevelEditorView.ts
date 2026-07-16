export const mountLevelEditorView = (host: HTMLElement): void => {
  if (host.childElementCount > 0) return;
  host.setAttribute('aria-labelledby', 'editor-title');
  host.innerHTML = `
    <header class="editor-header">
      <button id="editor-back-button" class="icon-button" aria-label="返回大厅">←</button>
      <div>
        <p class="eyebrow">LEVEL WORKSHOP</p>
        <h2 id="editor-title">关卡编辑器</h2>
      </div>
      <div id="editor-save-id" class="save-chip">下次保存：6</div>
    </header>

    <div class="editor-layout">
      <aside class="editor-info-panel" aria-labelledby="editor-info-title">
        <div class="editor-info-panel__header">
          <p class="eyebrow">LEVEL INSIGHTS</p>
          <h3 id="editor-info-title">关卡信息</h3>
        </div>
        <div class="editor-info-size">
          <span>关卡尺寸</span>
          <strong id="editor-info-size">8 × 8</strong>
        </div>
        <section class="editor-info-group" aria-labelledby="editor-info-path-title">
          <h4 id="editor-info-path-title">路径结构</h4>
          <dl>
            <div><dt>直角拐弯次数</dt><dd id="editor-info-right-turns">0</dd></div>
            <div><dt>锐角拐弯次数</dt><dd id="editor-info-acute-turns">0</dd></div>
            <div><dt>钝角拐弯次数</dt><dd id="editor-info-obtuse-turns">0</dd></div>
            <div><dt>直线次数</dt><dd id="editor-info-straight">0</dd></div>
            <div><dt>路径交叉次数</dt><dd id="editor-info-crossings">0</dd></div>
          </dl>
        </section>
        <section class="editor-info-group" aria-labelledby="editor-info-visibility-title">
          <h4 id="editor-info-visibility-title">显示与隐藏</h4>
          <dl>
            <div class="editor-info-row--stacked"><dt>隐藏占比</dt><dd id="editor-info-hidden-ratio">0% · 0/0</dd></div>
            <div><dt>最长隐藏长度</dt><dd id="editor-info-hidden-run">0</dd></div>
            <div><dt>最长显示长度</dt><dd id="editor-info-visible-run">0</dd></div>
          </dl>
        </section>
        <p class="editor-info-note">统计以当前数字路径为准，并随编辑实时更新。</p>
      </aside>

      <section class="editor-board-pane" aria-label="棋盘区域">
        <div class="editor-workspace">
          <div id="editor-preview" class="editor-preview" aria-hidden="true"></div>
          <svg id="editor-path-lines" class="editor-path-lines" aria-hidden="true"></svg>
          <div id="editor-grid" class="editor-grid" aria-label="关卡绘制网格"></div>
        </div>
        <p id="editor-status" class="editor-status" aria-live="polite">在网格上拖动，绘制需要一笔覆盖的形状。</p>
      </section>

      <div id="editor-resizer" class="editor-resizer" role="separator" tabindex="0" aria-label="调整棋盘和配置区域宽度" aria-orientation="vertical"></div>

      <aside class="editor-sidebar" aria-label="关卡配置">
        <div class="editor-sidebar__heading">
          <div>
            <p class="eyebrow">LEVEL CONFIG</p>
            <h3>关卡配置</h3>
          </div>
          <label class="editor-algorithm-select">算法
            <select id="editor-algorithm">
              <option value="algorithm-1">算法1</option>
              <option value="algorithm-2" selected>算法2</option>
            </select>
          </label>
        </div>
        <div id="editor-algorithm-parameters" class="editor-algorithm-parameters"></div>
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
          <div class="stepper"><span>尺寸</span><button id="editor-size-minus">−</button><b id="editor-size-value">8 × 8</b><button id="editor-size-plus">＋</button></div>
          <div class="editor-image-import">
            <div class="editor-image-import__group">
              <div class="editor-image-import__heading"><b>精准识别</b><small>先完整关卡，再识别隐藏</small></div>
              <div class="editor-image-import__actions">
                <button id="editor-image-level-button" class="button button--secondary" type="button">识别完整关卡</button>
                <button id="editor-image-hidden-button" class="button button--secondary" type="button">识别隐藏</button>
              </div>
            </div>
            <div class="editor-image-import__group">
              <div class="editor-image-import__heading"><b>快捷识别</b><small>会推测未显示的路径</small></div>
              <button id="editor-image-formation-button" class="button button--secondary" type="button">识别初始阵型</button>
            </div>
            <small class="editor-image-import__shortcut">直接 Ctrl+V 使用上次选择，默认为完整关卡</small>
          </div>
          <div class="editor-board-actions">
            <button id="editor-fill-button" class="button button--secondary button--small">填满棋盘</button>
            <button id="editor-clear-button" class="button button--secondary button--small">清空棋盘</button>
            <button id="editor-undo-delete-button" class="button button--secondary button--small" title="Ctrl+Z" disabled>撤销删除</button>
          </div>
        </div>
        <div class="editor-actions">
          <button id="editor-playtest-button" class="button button--secondary" disabled>试玩关卡</button>
          <button id="editor-generate-path-button" class="button button--secondary">生成路径</button>
          <button id="editor-save-button" class="button button--primary" disabled>添加到列表</button>
        </div>
      </aside>

      <aside class="editor-level-panel" aria-label="关卡列表">
        <div class="editor-level-panel__header">
          <div>
            <p class="eyebrow">LEVEL LIBRARY</p>
            <h3>关卡列表</h3>
          </div>
          <span id="editor-level-count" class="editor-level-count">0 关</span>
        </div>
        <div class="editor-level-actions">
          <button id="editor-level-add" class="button button--primary button--small" disabled>添加当前</button>
          <button id="editor-level-import" class="button button--secondary button--small">读取 JSON</button>
          <button id="editor-level-export" class="button button--secondary button--small">导出 JSON</button>
        </div>
        <div id="editor-level-list" class="editor-level-list"></div>
        <input id="editor-level-file" type="file" accept=".json,application/json" hidden>
      </aside>
    </div>

    <div id="editor-level-preview" class="editor-level-preview" role="tooltip" hidden></div>
  `;
};
