// Shared screen/grid config — extracted to break circular dependency between
// VfxManager, BattleSystem, and VfxPresets.

export const screenConfig = {
  width: 2556,
  height: 1179,
  leftOffset: 588,
  topOffset: 236,
  gridW: 1380,
  gridH: 707,
  cellW: 125.4,
  cellH: 141.4
};

export function gridToScreen(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: screenConfig.leftOffset + (gridX + 0.5) * screenConfig.cellW,
    y: screenConfig.topOffset + (gridY + 0.5) * screenConfig.cellH
  };
}
