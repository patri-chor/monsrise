// ============================================================
// src/ui/L1ChallengeHistoryUI.ts
// T046 玩家 L1 挑战历史记录弹窗面板 (复古像素风 DOM 覆盖层)
// ============================================================

import { L1MeleeChallengeManager } from './L1MeleeChallengeManager';
import { t } from '../game/LanguageManager';

export class L1ChallengeHistoryUI {
  private static _panelEl: HTMLElement | null = null;

  public static show(): void {
    if (this._panelEl) {
      this._panelEl.remove();
      this._panelEl = null;
    }

    const mgr = L1MeleeChallengeManager.getInstance();
    const summary = mgr.getHistorySummary();
    const recent = mgr.getHistory().slice(0, 20);

    const overlay = document.createElement('div');
    overlay.id = 'l1ChallengeHistoryModal';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';

    const panel = document.createElement('div');
    panel.style.width = '780px';
    panel.style.maxHeight = '80vh';
    panel.style.backgroundColor = '#181425';
    panel.style.border = '4px solid #8b9bb4';
    panel.style.padding = '20px';
    panel.style.color = '#fff';
    panel.style.fontFamily = 'monospace, sans-serif';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    panel.style.gap = '15px';
    panel.style.boxSizing = 'border-box';

    // 头部
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.borderBottom = '2px solid #5a6988';
    header.style.paddingBottom = '10px';

    const title = document.createElement('h2');
    title.style.margin = '0';
    title.style.fontSize = '24px';
    title.style.color = '#ffcc00';
    title.textContent = t('L1 人机挑战对战记录', 'L1 VS AI Challenge History');

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'pixel-btn';
    closeBtn.style.padding = '4px 12px';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = () => this.hide();

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 统计总览
    const statsBox = document.createElement('div');
    statsBox.style.display = 'grid';
    statsBox.style.gridTemplateColumns = 'repeat(5, 1fr)';
    statsBox.style.gap = '10px';
    statsBox.style.backgroundColor = '#262b44';
    statsBox.style.padding = '12px';
    statsBox.style.border = '2px solid #3a4466';
    statsBox.style.textAlign = 'center';

    statsBox.innerHTML = `
      <div><div style="color:#8b9bb4;font-size:12px;">总场次</div><div style="font-size:20px;font-weight:bold;">${summary.total}</div></div>
      <div><div style="color:#63c74d;font-size:12px;">胜场 (W)</div><div style="font-size:20px;font-weight:bold;color:#63c74d;">${summary.wins}</div></div>
      <div><div style="color:#e43b44;font-size:12px;">败场 (L)</div><div style="font-size:20px;font-weight:bold;color:#e43b44;">${summary.losses}</div></div>
      <div><div style="color:#fee761;font-size:12px;">平局 (D)</div><div style="font-size:20px;font-weight:bold;color:#fee761;">${summary.draws}</div></div>
      <div><div style="color:#00e436;font-size:12px;">胜率</div><div style="font-size:20px;font-weight:bold;color:#00e436;">${(summary.winRate * 100).toFixed(1)}%</div></div>
    `;
    panel.appendChild(statsBox);

    // 战报列表容器
    const listContainer = document.createElement('div');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.maxHeight = '360px';
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';
    listContainer.style.gap = '8px';
    listContainer.style.paddingRight = '5px';

    if (recent.length === 0) {
      listContainer.innerHTML = `<div style="text-align:center;color:#8b9bb4;padding:40px 0;">暂无挑战对战记录，快去点击【人机对战】体验吧！</div>`;
    } else {
      for (const r of recent) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.backgroundColor = '#1f2438';
        row.style.padding = '8px 12px';
        row.style.border = '1px solid #3a4466';

        const outcomeColor = r.outcome === 'WIN' ? '#63c74d' : r.outcome === 'LOSS' ? '#e43b44' : '#fee761';
        const outcomeText = r.outcome === 'WIN' ? '胜利' : r.outcome === 'LOSS' ? '战败' : '平局';

        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-weight:bold;color:${outcomeColor};font-size:16px;width:40px;">${outcomeText}</span>
            <div>
              <div style="color:#fff;font-size:14px;">${r.opponentDisplayName} <span style="color:#8b9bb4;font-size:12px;">(${r.rootT0SourceId})</span></div>
              <div style="color:#5a6988;font-size:11px;">Rev: ${r.meleeRevision.slice(0, 8)} | ${new Date(r.completedAt).toLocaleString()}</div>
            </div>
          </div>
          <div style="font-size:16px;font-weight:bold;color:#ffcc00;">
            ${r.playerScore} - ${r.opponentScore}
          </div>
        `;
        listContainer.appendChild(row);
      }
    }
    panel.appendChild(listContainer);

    // 底部控制按钮
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'space-between';
    footer.style.alignItems = 'center';
    footer.style.borderTop = '1px solid #5a6988';
    footer.style.paddingTop = '10px';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空记录';
    clearBtn.className = 'pixel-btn';
    clearBtn.style.padding = '6px 16px';
    clearBtn.style.backgroundColor = '#8b0000';
    clearBtn.style.color = '#fff';
    clearBtn.style.cursor = 'pointer';
    clearBtn.onclick = () => {
      if (confirm('确定要清空所有本地挑战历史记录吗？')) {
        mgr.clearHistory();
        this.show(); // 重新刷新
      }
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确定';
    confirmBtn.className = 'pixel-btn';
    confirmBtn.style.padding = '6px 24px';
    confirmBtn.style.cursor = 'pointer';
    confirmBtn.onclick = () => this.hide();

    footer.appendChild(clearBtn);
    footer.appendChild(confirmBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this._panelEl = overlay;
  }

  public static hide(): void {
    if (this._panelEl) {
      this._panelEl.remove();
      this._panelEl = null;
    }
  }
}
