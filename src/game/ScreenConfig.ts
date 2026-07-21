// Shared screen/grid config — extracted to break circular dependency between
// VfxManager, BattleSystem, and VfxPresets.

export const screenConfig = {
  width: 2556,
  height: 1179,
  leftOffset: 588,
  topOffset: 266,
  gridW: 1380,
  gridH: 620,
  gridCols: 11,
  gridRows: 5,
  cellGap: 10,
  get cellW() { return (this.gridW - this.cellGap * (this.gridCols - 1)) / this.gridCols + this.cellGap; },
  get cellH() { return (this.gridH - this.cellGap * (this.gridRows - 1)) / this.gridRows + this.cellGap; },
  get cellContentW() { return (this.gridW - this.cellGap * (this.gridCols - 1)) / this.gridCols; },
  get cellContentH() { return (this.gridH - this.cellGap * (this.gridRows - 1)) / this.gridRows; },
};

export function gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  const cfg = screenConfig;
  return {
    x: cfg.leftOffset + gridX * cfg.cellW + cfg.cellContentW / 2,
    y: cfg.topOffset + gridY * cfg.cellH + cfg.cellContentH / 2
  };
}
