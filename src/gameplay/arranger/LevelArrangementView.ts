export const mountLevelArrangementView = (host: HTMLElement): void => {
  host.setAttribute('aria-labelledby', 'arranger-screen-title');
  host.innerHTML = `
    <header class="arranger-screen-header">
      <button id="arranger-back-button" class="icon-button" type="button" aria-label="返回大厅">←</button>
      <div class="arranger-screen-heading">
        <small>LEVEL LAYOUT</small>
        <h2 id="arranger-screen-title">关卡排布工具</h2>
      </div>
      <div class="arranger-file-actions">
        <span id="arranger-file-status">尚未读取关卡库</span>
        <button id="arranger-open-file" class="button button--primary button--small" type="button">读取跑关结果.xlsx</button>
        <input id="arranger-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </div>
    </header>
    <div class="arranger-layout">
      <aside class="arranger-panel arranger-groups-panel" aria-labelledby="arranger-groups-title">
        <header><div><small>关卡列表</small><h3 id="arranger-groups-title">游戏关卡</h3></div><div class="arranger-group-actions"><button id="arranger-auto-layout" type="button" disabled>自动排布</button><button id="arranger-copy-groups" type="button" disabled>复制</button><button id="arranger-add-group" type="button">＋ 新增</button></div></header>
        <div id="arranger-group-list" class="arranger-group-list"></div>
      </aside>
      <section class="arranger-panel arranger-library-panel" aria-labelledby="arranger-library-title">
        <header><div><small>棋盘 ＞ 路径 ＞ 难度</small><h3 id="arranger-library-title">棋盘阵型</h3></div><strong id="arranger-library-count">0 个棋盘</strong></header>
        <div class="arranger-library-toolbar">
          <input id="arranger-search" type="search" placeholder="搜索 level_编号、原关卡名或配置ID" aria-label="搜索关卡库" disabled>
          <button id="arranger-add-selected" class="button button--primary button--small" type="button" disabled>加入当前关卡</button>
        </div>
        <div class="arranger-library-content">
          <div id="arranger-library-list" class="arranger-library-list"><p class="arranger-empty-copy">读取跑关结果后，这里会显示关卡库。</p></div>
          <aside class="arranger-library-parameters" aria-labelledby="arranger-library-parameters-title">
            <header>
              <small>参数展示</small>
              <strong id="arranger-library-parameters-title">未选择</strong>
            </header>
            <div id="arranger-library-parameters-body" class="arranger-library-parameters-body">
              <p class="arranger-empty-copy">将鼠标移到左侧层级上查看对应参数。</p>
            </div>
          </aside>
        </div>
        <footer class="arranger-library-pagination">
          <button id="arranger-page-previous" type="button" disabled>← 上一页</button>
          <span id="arranger-page-label">0 / 0</span>
          <button id="arranger-page-next" type="button" disabled>下一页 →</button>
        </footer>
      </section>
      <aside class="arranger-panel arranger-preview-panel" aria-labelledby="arranger-preview-title">
        <header>
          <div><small>棋盘预览</small><h3 id="arranger-preview-title">未选择</h3></div>
          <div class="arranger-preview-actions">
            <div class="arranger-preview-toggles" aria-label="预览显示选项">
              <label><input id="arranger-show-trend" type="checkbox" checked><span>趋势</span></label>
              <label><input id="arranger-show-connection" type="checkbox"><span>连线</span></label>
            </div>
            <button id="arranger-playtest-button" class="button button--primary button--small" type="button" disabled>试玩</button>
          </div>
        </header>
        <div id="arranger-preview" class="arranger-preview"><p class="arranger-empty-copy">从关卡库或左侧列表选择一个棋盘。</p></div>
      </aside>
    </div>
    <dialog id="arranger-auto-dialog" class="arranger-auto-dialog" aria-labelledby="arranger-auto-dialog-title">
      <section class="arranger-auto-dialog__card">
        <header>
          <div><small>AUTO LAYOUT</small><h3 id="arranger-auto-dialog-title">自动排布编辑</h3></div>
          <button id="arranger-auto-close" class="icon-button" type="button" aria-label="关闭">×</button>
        </header>
        <div class="arranger-auto-fields">
          <label><span>每关棋盘数量</span><input id="arranger-auto-board-count" type="number" min="1" max="20" step="1" value="1"></label>
          <label><span>相同路径重复出现间隔</span><input id="arranger-auto-path-gap" type="number" min="0" step="1" value="100"></label>
        </div>
        <section class="arranger-auto-stages">
          <header><div><strong>阶段配置</strong><small>阵型范围支持 1-20,25,30-35</small></div><button id="arranger-auto-add-stage" type="button">＋ 添加阶段</button></header>
          <div class="arranger-auto-stage-head"><span>阶段</span><span>起始关</span><span>结束关</span><span>阵型 ID 范围</span><span></span></div>
          <div id="arranger-auto-stage-list" class="arranger-auto-stage-list"></div>
        </section>
        <p id="arranger-auto-status" class="arranger-auto-status" aria-live="polite"></p>
        <footer><button id="arranger-auto-cancel" class="button button--secondary" type="button">取消</button><button id="arranger-auto-generate" class="button button--primary" type="button">生成并替换关卡列表</button></footer>
      </section>
    </dialog>
  `;
};
