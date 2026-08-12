// ============================================================
// 阵型库（AI 先验）：7 套卡组 + 阵型分支树（round 0 为根）
// 说明：坐标为 AI 侧（p2，x 6-10）视角，p1 侧使用时由调用方镜像
// 来源：从 ai-bundle.iife.js 恢复（原 src/ai/strategy/formation_library.ts）
// ============================================================

import type { Formation } from './types';

export const FORMATION_LIBRARY: Formation[] = [
  {
    "id": "springsword",
    "name": "泉水剑",
    "archetype": "prayer",
    "signatureCards": [
      110,
      103,
      105,
      102
    ],
    "hasFourCost": true,
    "fourCostName": "祭祀",
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          8
        ]
      },
      {
        "monsterId": 105,
        "badgeIds": [
          8,
          17
        ]
      },
      {
        "monsterId": 103,
        "badgeIds": [
          8,
          18
        ]
      },
      {
        "monsterId": 112,
        "badgeIds": [
          8,
          6
        ]
      },
      {
        "monsterId": 102,
        "badgeIds": [
          3,
          22,
          21
        ]
      },
      {
        "monsterId": 104,
        "badgeIds": [
          8,
          4
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          32,
          24
        ]
      }
    ],
    "tree": {
      "id": "n1",
      "round": 0,
      "label": "开局",
      "comment": "",
      "placement": [],
      "children": [
        {
          "id": "n2",
          "round": 1,
          "label": "局1",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                8
              ],
              "x": 9,
              "y": 3
            },
            {
              "monsterId": 105,
              "badgeIds": [
                8,
                17
              ],
              "x": 10,
              "y": 3
            }
          ],
          "children": [
            {
              "id": "n3",
              "round": 2,
              "label": "局2",
              "comment": "",
              "placement": [
                {
                  "monsterId": 102,
                  "badgeIds": [
                    3,
                    22,
                    21
                  ],
                  "x": 9,
                  "y": 2
                }
              ],
              "children": [
                {
                  "id": "n4",
                  "round": 3,
                  "label": "局3",
                  "comment": "",
                  "placement": [
                    {
                      "monsterId": 112,
                      "badgeIds": [
                        8,
                        6
                      ],
                      "x": 10,
                      "y": 4
                    },
                    {
                      "monsterId": 103,
                      "badgeIds": [
                        8,
                        12
                      ],
                      "x": 9,
                      "y": 4
                    }
                  ],
                  "children": [
                    {
                      "id": "n5",
                      "round": 4,
                      "label": "局4",
                      "comment": "用冲锋哥反制冲锋哥，对顶",
                      "placement": [
                        {
                          "monsterId": 106,
                          "badgeIds": [
                            32,
                            24
                          ],
                          "x": 7,
                          "y": 3
                        }
                      ],
                      "children": [
                        {
                          "id": "n6",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 104,
                              "badgeIds": [
                                8,
                                4
                              ],
                              "x": 10,
                              "y": 2
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "nutsavior",
    "name": "坚果救星",
    "archetype": "half_rush",
    "signatureCards": [
      110,
      105,
      108
    ],
    "hasFourCost": true,
    "fourCostName": "救星",
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          16
        ]
      },
      {
        "monsterId": 105,
        "badgeIds": [
          8,
          17
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 108,
        "badgeIds": [
          3,
          22,
          21
        ]
      },
      {
        "monsterId": 125,
        "badgeIds": [
          27,
          9
        ]
      },
      {
        "monsterId": 104,
        "badgeIds": [
          27,
          35
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          3,
          32
        ]
      }
    ],
    "tree": {
      "id": "n7",
      "round": 0,
      "label": "开局",
      "comment": "",
      "placement": [],
      "children": [
        {
          "id": "n8",
          "round": 1,
          "label": "局1",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                16
              ],
              "x": 9,
              "y": 2
            },
            {
              "monsterId": 105,
              "badgeIds": [
                8,
                17
              ],
              "x": 10,
              "y": 2
            }
          ],
          "children": [
            {
              "id": "n9",
              "round": 2,
              "label": "局2",
              "comment": "可以放在帝国上面，也可以在下面",
              "placement": [
                {
                  "monsterId": 108,
                  "badgeIds": [
                    3,
                    22,
                    21
                  ],
                  "x": 9,
                  "y": 1
                }
              ],
              "children": [
                {
                  "id": "n10",
                  "round": 3,
                  "label": "局3",
                  "comment": "没有三振王就先上冲锋",
                  "placement": [
                    {
                      "monsterId": 104,
                      "badgeIds": [
                        27,
                        35
                      ],
                      "x": 10,
                      "y": 3
                    },
                    {
                      "monsterId": 106,
                      "badgeIds": [
                        32,
                        24
                      ],
                      "x": 6,
                      "y": 1
                    }
                  ],
                  "children": [
                    {
                      "id": "n11",
                      "round": 4,
                      "label": "局4",
                      "comment": "突突怼脸",
                      "placement": [
                        {
                          "monsterId": 114,
                          "badgeIds": [
                            3,
                            32
                          ],
                          "x": 6,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n12",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 116,
                              "badgeIds": [
                                32,
                                24
                              ],
                              "x": 7,
                              "y": 2
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                },
                {
                  "id": "n15",
                  "round": 3,
                  "label": "如果对面有三振王",
                  "comment": "战壕克制三振王",
                  "placement": [
                    {
                      "monsterId": 125,
                      "badgeIds": [
                        27,
                        9
                      ],
                      "x": 10,
                      "y": 1
                    },
                    {
                      "monsterId": 104,
                      "badgeIds": [
                        27,
                        35
                      ],
                      "x": 10,
                      "y": 3
                    }
                  ],
                  "children": [
                    {
                      "id": "n16",
                      "round": 4,
                      "label": "局4",
                      "comment": "之后就上冲锋和钻头",
                      "placement": [
                        {
                          "monsterId": 106,
                          "badgeIds": [
                            32,
                            24
                          ],
                          "x": 6,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n17",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 116,
                              "badgeIds": [
                                32,
                                24
                              ],
                              "x": 6,
                              "y": 1
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "all2rush",
    "name": "全二冲",
    "archetype": "full_rush",
    "signatureCards": [
      110,
      107,
      113,
      116
    ],
    "hasFourCost": false,
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          30
        ]
      },
      {
        "monsterId": 117,
        "badgeIds": [
          8,
          3
        ]
      },
      {
        "monsterId": 107,
        "badgeIds": [
          20,
          1
        ]
      },
      {
        "monsterId": 113,
        "badgeIds": [
          3,
          20
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          3,
          32
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          3,
          5
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 104,
        "badgeIds": [
          3,
          4
        ]
      }
    ],
    "tree": {
      "id": "n18",
      "round": 0,
      "label": "开局",
      "comment": "如果对方是盾流，早点上散弹",
      "placement": [],
      "children": [
        {
          "id": "n19",
          "round": 1,
          "label": "对方是祷徒",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                30
              ],
              "x": 7,
              "y": 2
            },
            {
              "monsterId": 117,
              "badgeIds": [
                8,
                3
              ],
              "x": 6,
              "y": 2
            }
          ],
          "children": [
            {
              "id": "n20",
              "round": 2,
              "label": "局2",
              "comment": "目标秒杀祈祷",
              "placement": [
                {
                  "monsterId": 106,
                  "badgeIds": [
                    32,
                    24
                  ],
                  "x": 6,
                  "y": 3
                },
                {
                  "monsterId": 113,
                  "badgeIds": [
                    3,
                    20
                  ],
                  "x": 7,
                  "y": 3
                }
              ],
              "children": [
                {
                  "id": "n21",
                  "round": 3,
                  "label": "局3",
                  "comment": "咒法防钻头，钻头瞄准祈祷",
                  "placement": [
                    {
                      "monsterId": 116,
                      "badgeIds": [
                        3,
                        5
                      ],
                      "x": 7,
                      "y": 4
                    },
                    {
                      "monsterId": 107,
                      "badgeIds": [
                        20,
                        1
                      ],
                      "x": 8,
                      "y": 3
                    }
                  ],
                  "children": [
                    {
                      "id": "n22",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 114,
                          "badgeIds": [
                            3,
                            32
                          ],
                          "x": 9,
                          "y": 3
                        }
                      ],
                      "children": [
                        {
                          "id": "n23",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 104,
                              "badgeIds": [
                                3,
                                4
                              ],
                              "x": 7,
                              "y": 1
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "id": "n29",
          "round": 1,
          "label": "对方是全冲",
          "comment": "全冲用盾钻开",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                30
              ],
              "x": 7,
              "y": 2
            },
            {
              "monsterId": 116,
              "badgeIds": [
                3,
                5
              ],
              "x": 6,
              "y": 0
            }
          ],
          "children": [
            {
              "id": "n30",
              "round": 2,
              "label": "局2",
              "comment": "在帝国边上放射手",
              "placement": [
                {
                  "monsterId": 104,
                  "badgeIds": [
                    3,
                    4
                  ],
                  "x": 7,
                  "y": 1
                },
                {
                  "monsterId": 113,
                  "badgeIds": [
                    3,
                    20
                  ],
                  "x": 8,
                  "y": 2
                }
              ],
              "children": [
                {
                  "id": "n31",
                  "round": 3,
                  "label": "局3",
                  "comment": "铁甲可后置为战士",
                  "placement": [
                    {
                      "monsterId": 114,
                      "badgeIds": [
                        3,
                        32
                      ],
                      "x": 9,
                      "y": 3
                    },
                    {
                      "monsterId": 117,
                      "badgeIds": [
                        8,
                        3
                      ],
                      "x": 10,
                      "y": 1
                    }
                  ],
                  "children": [
                    {
                      "id": "n32",
                      "round": 4,
                      "label": "局4",
                      "comment": "冲锋吸引火力",
                      "placement": [
                        {
                          "monsterId": 106,
                          "badgeIds": [
                            32,
                            24
                          ],
                          "x": 6,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n33",
                          "round": 5,
                          "label": "局5",
                          "comment": "咒法要有攻击对象",
                          "placement": [
                            {
                              "monsterId": 107,
                              "badgeIds": [
                                20,
                                1
                              ],
                              "x": 10,
                              "y": 2
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "classicsavior",
    "name": "经典救星",
    "archetype": "full_rush",
    "signatureCards": [
      110,
      108,
      107,
      116,
      117
    ],
    "hasFourCost": true,
    "fourCostName": "救星",
    "team": [
      {
        "monsterId": 117,
        "badgeIds": [
          3,
          9
        ]
      },
      {
        "monsterId": 110,
        "badgeIds": [
          11,
          28
        ]
      },
      {
        "monsterId": 108,
        "badgeIds": [
          3,
          22,
          21
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          3,
          1
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          3,
          5
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 107,
        "badgeIds": [
          20,
          1
        ]
      },
      {
        "monsterId": 119,
        "badgeIds": [
          3,
          5
        ]
      }
    ],
    "tree": {
      "id": "n34",
      "round": 0,
      "label": "开局",
      "comment": "",
      "placement": [],
      "children": [
        {
          "id": "n35",
          "round": 1,
          "label": "局1",
          "comment": "救星开可以杀死盾祷",
          "placement": [
            {
              "monsterId": 108,
              "badgeIds": [
                3,
                22,
                21
              ],
              "x": 9,
              "y": 1
            }
          ],
          "children": [
            {
              "id": "n36",
              "round": 2,
              "label": "局2",
              "comment": "",
              "placement": [
                {
                  "monsterId": 117,
                  "badgeIds": [
                    3,
                    9
                  ],
                  "x": 6,
                  "y": 2
                },
                {
                  "monsterId": 110,
                  "badgeIds": [
                    11,
                    28
                  ],
                  "x": 7,
                  "y": 2
                }
              ],
              "children": [
                {
                  "id": "n37",
                  "round": 3,
                  "label": "局3",
                  "comment": "突突和咒法要放在有敌人的一行",
                  "placement": [
                    {
                      "monsterId": 114,
                      "badgeIds": [
                        3,
                        1
                      ],
                      "x": 8,
                      "y": 2
                    },
                    {
                      "monsterId": 107,
                      "badgeIds": [
                        20,
                        1
                      ],
                      "x": 9,
                      "y": 2
                    }
                  ],
                  "children": [
                    {
                      "id": "n38",
                      "round": 4,
                      "label": "局4",
                      "comment": "祷徒上冲锋，非祷徒用忍猴",
                      "placement": [
                        {
                          "monsterId": 106,
                          "badgeIds": [
                            32,
                            24
                          ],
                          "x": 7,
                          "y": 3
                        }
                      ],
                      "children": [
                        {
                          "id": "n39",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 116,
                              "badgeIds": [
                                3,
                                5
                              ],
                              "x": 7,
                              "y": 0
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "all2prayer",
    "name": "全二永平",
    "archetype": "prayer",
    "signatureCards": [
      110,
      103,
      105,
      116
    ],
    "hasFourCost": false,
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          8
        ]
      },
      {
        "monsterId": 105,
        "badgeIds": [
          8,
          17
        ]
      },
      {
        "monsterId": 103,
        "badgeIds": [
          8,
          12
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          3,
          5
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          27,
          35
        ]
      },
      {
        "monsterId": 104,
        "badgeIds": [
          8,
          4
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          8,
          3
        ]
      },
      {
        "monsterId": 112,
        "badgeIds": [
          8,
          6
        ]
      }
    ],
    "tree": {
      "id": "n54",
      "round": 0,
      "label": "开局",
      "comment": "",
      "placement": [],
      "children": [
        {
          "id": "n55",
          "round": 1,
          "label": "局1",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                8
              ],
              "x": 6,
              "y": 1
            },
            {
              "monsterId": 116,
              "badgeIds": [
                3,
                5
              ],
              "x": 8,
              "y": 0
            }
          ],
          "children": [
            {
              "id": "n56",
              "round": 2,
              "label": "局2",
              "comment": "",
              "placement": [
                {
                  "monsterId": 103,
                  "badgeIds": [
                    8,
                    12
                  ],
                  "x": 7,
                  "y": 1
                },
                {
                  "monsterId": 105,
                  "badgeIds": [
                    8,
                    17
                  ],
                  "x": 8,
                  "y": 1
                }
              ],
              "children": [
                {
                  "id": "n57",
                  "round": 3,
                  "label": "局3",
                  "comment": "冲锋放祈祷边上（接力）",
                  "placement": [
                    {
                      "monsterId": 112,
                      "badgeIds": [
                        8,
                        6
                      ],
                      "x": 7,
                      "y": 2
                    },
                    {
                      "monsterId": 106,
                      "badgeIds": [
                        27,
                        35
                      ],
                      "x": 8,
                      "y": 2
                    }
                  ],
                  "children": [
                    {
                      "id": "n58",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 104,
                          "badgeIds": [
                            8,
                            4
                          ],
                          "x": 7,
                          "y": 0
                        }
                      ],
                      "children": [
                        {
                          "id": "n59",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 114,
                              "badgeIds": [
                                8,
                                3
                              ],
                              "x": 9,
                              "y": 2
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "suqing",
    "name": "肃清",
    "archetype": "half_rush",
    "signatureCards": [
      110,
      105,
      101,
      124
    ],
    "hasFourCost": true,
    "fourCostName": "肃清",
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          8
        ]
      },
      {
        "monsterId": 124,
        "badgeIds": [
          10,
          25
        ]
      },
      {
        "monsterId": 101,
        "badgeIds": [
          23,
          3,
          2
        ]
      },
      {
        "monsterId": 105,
        "badgeIds": [
          8,
          17
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          3,
          5
        ]
      },
      {
        "monsterId": 107,
        "badgeIds": [
          20,
          1
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          3,
          2
        ]
      }
    ],
    "tree": {
      "id": "n40",
      "round": 0,
      "label": "开局",
      "comment": "DOF 结合全冲速战速决",
      "placement": [],
      "children": [
        {
          "id": "n41",
          "round": 1,
          "label": "局1",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                8
              ],
              "x": 7,
              "y": 2
            },
            {
              "monsterId": 124,
              "badgeIds": [
                10,
                25
              ],
              "x": 8,
              "y": 2
            }
          ],
          "children": [
            {
              "id": "n42",
              "round": 2,
              "label": "局2",
              "comment": "肃清避伤：对方上半→放下半",
              "placement": [
                {
                  "monsterId": 101,
                  "badgeIds": [
                    23,
                    3,
                    2
                  ],
                  "x": 9,
                  "y": 3
                }
              ],
              "children": [
                {
                  "id": "n43",
                  "round": 3,
                  "label": "局3",
                  "comment": "无盾炮时早出冲锋防巫毒",
                  "placement": [
                    {
                      "monsterId": 106,
                      "badgeIds": [
                        32,
                        24
                      ],
                      "x": 6,
                      "y": 3
                    },
                    {
                      "monsterId": 114,
                      "badgeIds": [
                        3,
                        2
                      ],
                      "x": 8,
                      "y": 1
                    }
                  ],
                  "children": [
                    {
                      "id": "n44",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 105,
                          "badgeIds": [
                            8,
                            17
                          ],
                          "x": 9,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n45",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 107,
                              "badgeIds": [
                                20,
                                1
                              ],
                              "x": 10,
                              "y": 1
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                },
                {
                  "id": "n48",
                  "round": 3,
                  "label": "如果对方上钻头",
                  "comment": "上祈祷保护三振王",
                  "placement": [
                    {
                      "monsterId": 105,
                      "badgeIds": [
                        8,
                        17
                      ],
                      "x": 9,
                      "y": 2
                    },
                    {
                      "monsterId": 114,
                      "badgeIds": [
                        3,
                        2
                      ],
                      "x": 8,
                      "y": 1
                    }
                  ],
                  "children": [
                    {
                      "id": "n49",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 106,
                          "badgeIds": [
                            32,
                            24
                          ],
                          "x": 7,
                          "y": 3
                        }
                      ],
                      "children": [
                        {
                          "id": "n50",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 116,
                              "badgeIds": [
                                3,
                                5
                              ],
                              "x": 9,
                              "y": 1
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                },
                {
                  "id": "n51",
                  "round": 3,
                  "label": "如果对方是祷徒",
                  "comment": "用突突和咒法",
                  "placement": [
                    {
                      "monsterId": 114,
                      "badgeIds": [
                        3,
                        2
                      ],
                      "x": 7,
                      "y": 3
                    },
                    {
                      "monsterId": 107,
                      "badgeIds": [
                        20,
                        1
                      ],
                      "x": 10,
                      "y": 3
                    }
                  ],
                  "children": [
                    {
                      "id": "n52",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 116,
                          "badgeIds": [
                            3,
                            5
                          ],
                          "x": 8,
                          "y": 4
                        }
                      ],
                      "children": [
                        {
                          "id": "n53",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 106,
                              "badgeIds": [
                                32,
                                24
                              ],
                              "x": 6,
                              "y": 3
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  {
    "id": "laddersel",
    "name": "梯子塞雷",
    "archetype": "full_rush",
    "signatureCards": [
      110,
      118,
      116,
      117
    ],
    "hasFourCost": true,
    "fourCostName": "塞雷",
    "team": [
      {
        "monsterId": 110,
        "badgeIds": [
          23,
          8
        ]
      },
      {
        "monsterId": 116,
        "badgeIds": [
          3,
          5
        ]
      },
      {
        "monsterId": 117,
        "badgeIds": [
          8,
          3
        ]
      },
      {
        "monsterId": 118,
        "badgeIds": [
          11,
          28,
          30
        ]
      },
      {
        "monsterId": 107,
        "badgeIds": [
          20,
          1
        ]
      },
      {
        "monsterId": 113,
        "badgeIds": [
          3,
          20
        ]
      },
      {
        "monsterId": 106,
        "badgeIds": [
          32,
          24
        ]
      },
      {
        "monsterId": 114,
        "badgeIds": [
          3,
          32
        ]
      }
    ],
    "tree": {
      "id": "n60",
      "round": 0,
      "label": "开局",
      "comment": "",
      "placement": [],
      "children": [
        {
          "id": "n61",
          "round": 1,
          "label": "局1",
          "comment": "",
          "placement": [
            {
              "monsterId": 110,
              "badgeIds": [
                23,
                8
              ],
              "x": 7,
              "y": 2
            },
            {
              "monsterId": 116,
              "badgeIds": [
                3,
                5
              ],
              "x": 6,
              "y": 0
            }
          ],
          "children": [
            {
              "id": "n62",
              "round": 2,
              "label": "局2",
              "comment": "双射手+助跑输出",
              "placement": [
                {
                  "monsterId": 113,
                  "badgeIds": [
                    3,
                    20
                  ],
                  "x": 8,
                  "y": 2
                },
                {
                  "monsterId": 114,
                  "badgeIds": [
                    3,
                    32
                  ],
                  "x": 7,
                  "y": 1
                }
              ],
              "children": [
                {
                  "id": "n63",
                  "round": 3,
                  "label": "局3",
                  "comment": "",
                  "placement": [
                    {
                      "monsterId": 118,
                      "badgeIds": [
                        11,
                        28,
                        30
                      ],
                      "x": 7,
                      "y": 3
                    }
                  ],
                  "children": [
                    {
                      "id": "n64",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 107,
                          "badgeIds": [
                            20,
                            1
                          ],
                          "x": 9,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n65",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 106,
                              "badgeIds": [
                                32,
                                24
                              ],
                              "x": 6,
                              "y": 3
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              "id": "n66",
              "round": 2,
              "label": "方法二",
              "comment": "",
              "placement": [
                {
                  "monsterId": 118,
                  "badgeIds": [
                    11,
                    28,
                    30
                  ],
                  "x": 7,
                  "y": 3
                }
              ],
              "children": [
                {
                  "id": "n67",
                  "round": 3,
                  "label": "局3",
                  "comment": "铁甲盾炮",
                  "placement": [
                    {
                      "monsterId": 117,
                      "badgeIds": [
                        8,
                        3
                      ],
                      "x": 6,
                      "y": 3
                    },
                    {
                      "monsterId": 106,
                      "badgeIds": [
                        32,
                        24
                      ],
                      "x": 8,
                      "y": 3
                    }
                  ],
                  "children": [
                    {
                      "id": "n68",
                      "round": 4,
                      "label": "局4",
                      "comment": "",
                      "placement": [
                        {
                          "monsterId": 107,
                          "badgeIds": [
                            20,
                            1
                          ],
                          "x": 9,
                          "y": 2
                        }
                      ],
                      "children": [
                        {
                          "id": "n69",
                          "round": 5,
                          "label": "局5",
                          "comment": "",
                          "placement": [
                            {
                              "monsterId": 113,
                              "badgeIds": [
                                3,
                                20
                              ],
                              "x": 8,
                              "y": 2
                            }
                          ],
                          "children": []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
] as Formation[];
