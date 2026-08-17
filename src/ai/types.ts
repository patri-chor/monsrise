// 阵型/阵型树类型（AI 先验结构，与 ai-bundle.iife.js 中 formation_library 数据结构一致）

export interface FormationTreePlacement {
  monsterId: number;
  badgeIds: number[];
  x: number;
  y: number;
}

export interface FormationTree {
  id: string;
  round: number;
  label: string;
  comment: string;
  placement: FormationTreePlacement[];
  children: FormationTree[];
}

export interface FormationTeamSlot {
  monsterId: number;
  badgeIds: number[];
}

export interface Formation {
  id: string;
  name: string;
  archetype: string;
  signatureCards: number[];
  hasFourCost: boolean;
  fourCostName?: string;
  team: FormationTeamSlot[];
  tree: FormationTree;
  /** 允许使用的变体列表（缺省 = 全部 7 种变体等概率，含 original） */
  variants?: string[];
}
