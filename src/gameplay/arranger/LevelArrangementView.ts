import { DEFAULT_AUTO_ARRANGEMENT_FORM } from './autoArrangement';

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
        <header>
          <div class="arranger-groups-heading">
            <small>关卡列表</small>
            <div class="arranger-groups-title-row">
              <h3 id="arranger-groups-title">游戏关卡</h3>
              <div id="arranger-config-switcher" class="arranger-config-switcher" role="tablist" aria-label="关卡配置模式">
                <button type="button" role="tab" data-arrangement-mode="main" aria-selected="true">主玩法配置</button>
                <button type="button" role="tab" data-arrangement-mode="daily" aria-selected="false">每日挑战配置</button>
                <button type="button" role="tab" data-arrangement-mode="bead" aria-selected="false">拼豆玩法配置</button>
              </div>
            </div>
          </div>
          <div class="arranger-group-actions"><button id="arranger-auto-layout" type="button" disabled>自动排布</button><button id="arranger-copy-groups" type="button" disabled>复制当前配置</button><button id="arranger-batch-calculate" type="button" disabled>计算配置</button><button id="arranger-copy-level-data" type="button" disabled>导出三模式关卡数据</button><button id="arranger-add-group" type="button">＋ 新增</button></div>
        </header>
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
          <div><small>棋盘预览 <span id="arranger-preview-lock-status">悬停预览 · 点击关卡锁定</span></small><h3 id="arranger-preview-title">未选择</h3></div>
          <div class="arranger-preview-actions">
            <div class="arranger-preview-toggles" aria-label="预览显示选项">
              <label><input id="arranger-show-trend" type="checkbox" checked><span>趋势</span></label>
              <label><input id="arranger-show-connection" type="checkbox"><span>连线</span></label>
            </div>
            <button id="arranger-playtest-button" class="button button--primary button--small" type="button" aria-pressed="false" title="点击切换到试玩模式" disabled>预览模式</button>
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
          <label><span>生成关卡数</span><input id="arranger-auto-level-count" type="number" min="1" step="1" value="${DEFAULT_AUTO_ARRANGEMENT_FORM.levelCount}"></label>
          <label><span>每关棋盘数量</span><input id="arranger-auto-board-count" type="number" min="1" max="20" step="1" value="${DEFAULT_AUTO_ARRANGEMENT_FORM.boardsPerLevel}"></label>
          <label><span>相同路径重复出现间隔</span><input id="arranger-auto-path-gap" type="number" min="0" step="1" value="${DEFAULT_AUTO_ARRANGEMENT_FORM.pathRepeatInterval}"></label>
          <label><span>相同造型出现间隔（仅带 n）</span><input id="arranger-auto-shape-gap" type="number" min="0" step="1" value="${DEFAULT_AUTO_ARRANGEMENT_FORM.shapeRepeatInterval}" aria-describedby="arranger-auto-shape-gap-help"></label>
          <div class="arranger-auto-preferences">
          <label><span>多个更大隐藏数字数量倾向（40%）</span><select id="arranger-auto-later-hidden-neighbor-preference"><option value="large">大</option><option value="medium">中</option><option value="small" selected>小</option><option value="random">随机</option></select></label>
          <label><span>交叉复杂度倾向（25%）</span><select id="arranger-auto-crossing-complexity-preference"><option value="large">大</option><option value="medium">中</option><option value="small" selected>小</option><option value="random">随机</option></select></label>
          <label><span>直行占比倾向（25%）</span><select id="arranger-auto-straight-preference"><option value="large">大</option><option value="medium">中</option><option value="small" selected>小</option><option value="random">随机</option></select></label>
          <label><span>连续遮挡计数倾向（10%）</span><select id="arranger-auto-occlusion-preference"><option value="large">大</option><option value="medium">中</option><option value="small" selected>小</option><option value="random">随机</option></select></label>
          </div>
        </div>
        <p class="arranger-auto-preference-help">综合评分：多个更大隐藏数字数量 40%＋交叉复杂度 25%＋直行占比 25%＋连续遮挡 10%。各项在当前候选中归一化后加权，选总分最高者，同分随机；大/小分别倾向高值/低值，中倾向中间值。随机或候选数据不完整的指标不参与评分，剩余权重按比例分配。</p>
        <p class="arranger-auto-preference-help">交叉复杂度＝交叉数量分×50%＋交叉密度分×50%，密度＝交叉次数÷（有效数字数−1）。直行占比＝不拐弯次数÷（有效数字数−2），首尾不参与转弯判断，少于 3 个数字时记为 0；由直角、锐角、钝角拐弯占比推导。路径与造型间隔仍严格执行。</p>
        <section class="arranger-auto-stages">
          <p class="arranger-auto-preference-help">前期大小递进：各阶段独立使用自己的范围，按有效数字格数分档。第 1～5 关优先最小档；6～10 关从偏小档随机选；11～20 关放宽至中等档；21 关起取消大小偏好。间隔限制导致无合适尺寸时，选最近的可用档；选定尺寸后仍按综合评分选关卡。</p>
          <p id="arranger-auto-shape-gap-help" class="arranger-auto-preference-help">造型间隔按关数计算，0 表示不限制。例如设为 3，n1 在第 1 关出现后最早可在第 4 关再次出现；同一造型的不同路径、难度及阶段共用间隔，非 n 造型不受此项限制。</p>
          <header><div><strong>棋盘阶段配置</strong><small>阶段数量随每关棋盘数量自动变化；支持 1-20,25 和造型区间混搭，如 44,[n1~n20],[n30~n40],55；每个造型区间算一个候选项，从中选一个棋盘</small></div></header>
          <div class="arranger-auto-stage-head"><span>棋盘阶段</span><span>可选阵型 ID 范围</span><span>难度范围</span></div>
          <div id="arranger-auto-stage-list" class="arranger-auto-stage-list"></div>
        </section>
        <p id="arranger-auto-status" class="arranger-auto-status" aria-live="polite"></p>
        <footer><button id="arranger-auto-read-layout" class="button button--secondary" type="button">读取剪贴板排布</button><button id="arranger-auto-cancel" class="button button--secondary" type="button">取消</button><button id="arranger-auto-generate" class="button button--primary" type="button">生成并替换关卡列表</button></footer>
      </section>
    </dialog>
  `;
};
