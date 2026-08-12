# -*- coding: utf-8 -*-
"""
双头网络：网格 CNN（棋盘）+ 全局特征 → 策略头（怪兽 π_m + 格子 π_c）+ 价值头 v。
策略输出为 log_softmax；训练时用掩码重归一化到合法动作空间。
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from .state import GRID_CH, GRID_H, GRID_W, GLOBAL_DIM, MONSTER_COUNT, CELL_COUNT


class ResBlock(nn.Module):
    """AlphaZero/NNUE 风格残差块：2 层 3x3 卷积 + BatchNorm + 跨层跳跃连接"""
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out += residual
        return F.relu(out)


class SpatialAttention(nn.Module):
    """55 格全场空间自注意力机制：计算 11x5 棋盘全场全局关联与注意力矩阵"""
    def __init__(self, channels: int):
        super().__init__()
        self.query = nn.Conv2d(channels, channels // 4, 1)
        self.key = nn.Conv2d(channels, channels // 4, 1)
        self.value = nn.Conv2d(channels, channels, 1)
        self.gamma = nn.Parameter(torch.zeros(1))

    def forward(self, x):
        B, C, H, W = x.size()
        proj_query = self.query(x).view(B, -1, H * W).permute(0, 2, 1)
        proj_key = self.key(x).view(B, -1, H * W)
        energy = torch.bmm(proj_query, proj_key)
        attention = F.softmax(energy, dim=-1)
        proj_value = self.value(x).view(B, -1, H * W)

        out = torch.bmm(proj_value, attention.permute(0, 2, 1))
        out = out.view(B, C, H, W)
        return x + self.gamma * out


class DualNet(nn.Module):
    """AlphaZero / LCZero 风格特化深度残差+全场空间自注意力网络：
    残差块 (ResBlock) 拟合局部协同 + SpatialAttention 全局关联 + 策略/价值深层解耦。"""
    def __init__(self, hidden: int = 256, num_res_blocks: int = 2):
        super().__init__()
        self.conv_in = nn.Conv2d(GRID_CH, 64, 3, padding=1, bias=False)
        self.bn_in = nn.BatchNorm2d(64)
        self.res_blocks = nn.ModuleList([ResBlock(64) for _ in range(num_res_blocks)])
        self.attn = SpatialAttention(64)
        self.global_fc = nn.Linear(GLOBAL_DIM, 128)
        self.fc = nn.Linear(64 * GRID_H * GRID_W + 128, hidden)
        # 兼容旧参数权重的映射转换别名
        self.conv1 = self.conv_in
        
        # 策略头 (Policy Head)：两阶段因子化 (Autoregressive Conditioned Policy)
        self.monster_head = nn.Linear(hidden, MONSTER_COUNT)
        self.mon_embed = nn.Embedding(MONSTER_COUNT, 32)
        self.cell_fc = nn.Linear(hidden + 32, hidden)
        self.cell_head = nn.Linear(hidden, CELL_COUNT)
        
        # 价值头 (Value Head)
        self.value_head = nn.Sequential(
            nn.Linear(hidden, 64),
            nn.ReLU(),
            nn.Linear(64, 1)
        )

    def forward(self, grid, g, selected_mon=None):
        # grid: (B, 28, 5, 11)
        x = F.relu(self.bn_in(self.conv_in(grid)))
        for block in self.res_blocks:
            x = block(x)
        x = self.attn(x)  # 全局 55 格 Spatial Self-Attention 空间增强
        x = x.flatten(1)
        # 处理全局特征维数适配
        if g.shape[1] < GLOBAL_DIM:
            pad = torch.zeros(g.shape[0], GLOBAL_DIM - g.shape[1], device=g.device, dtype=g.dtype)
            g = torch.cat([g, pad], dim=1)
        elif g.shape[1] > GLOBAL_DIM:
            g = g[:, :GLOBAL_DIM]
        gg = F.relu(self.global_fc(g))
        h = F.relu(self.fc(torch.cat([x, gg], dim=1)))
        
        log_pm = F.log_softmax(self.monster_head(h), dim=1)
        
        # 条件化站位预测 (Conditioned Cell Head)
        if selected_mon is None:
            # 训练/未指定时，用概率加权的期望怪兽 embedding 融合
            pm_prob = torch.exp(log_pm)
            m_emb = torch.matmul(pm_prob, self.mon_embed.weight)
        else:
            m_emb = self.mon_embed(selected_mon)
            
        h_cell = F.relu(self.cell_fc(torch.cat([h, m_emb], dim=1)))
        log_pc = F.log_softmax(self.cell_head(h_cell), dim=1)
        
        v = torch.tanh(self.value_head(h)).squeeze(-1)
        return log_pm, log_pc, v

    @torch.no_grad()
    def eval_state(self, s, device='cpu'):
        """单状态前向（MCTS 用）：返回 (log_pm, log_pc, v)，均 masked 到合法动作。"""
        import numpy as np
        from .state import encode_state, action_mask
        grid, g = encode_state(s)
        m_mask, c_mask = action_mask(s)
        gt = torch.from_numpy(grid).unsqueeze(0).to(device)
        gv = torch.from_numpy(g).unsqueeze(0).to(device)
        log_pm, log_pc, v = self(gt, gv)
        lp_m = log_pm[0].cpu().numpy()
        lp_c = log_pc[0].cpu().numpy()
        # 掩码：非法动作概率置 -inf，重归一化
        lp_m = np.where(m_mask > 0, lp_m, -1e9)
        lp_c = np.where(c_mask > 0, lp_c, -1e9)
        pm = np.exp(lp_m)
        pc = np.exp(lp_c)
        # 若全被掩掉（无合法动作，如预算/手牌用尽），回退均匀分布（避免 0/0=NaN）
        if pm.sum() <= 0:
            pm[:] = 1.0 / MONSTER_COUNT
        if pc.sum() <= 0:
            pc[:] = 1.0 / CELL_COUNT
        pm = pm / pm.sum()
        pc = pc / pc.sum()
        return pm, pc, float(v[0].item())

    @torch.no_grad()
    def embed(self, grid, g):
        """局面 embedding 向量（经验库 ANN 检索预留接口）。
        当前启用特征工程向量（state_feat），网络学好后可切换到本接口
        （CNN 融合层 h，L2 归一化，相似局面向量接近）。"""
        x = F.relu(self.conv1(grid))
        y = F.relu(self.conv2(x))
        x = F.relu(y + self.conv3(y))
        x = x.flatten(1)
        gg = F.relu(self.global_fc(g))
        h = F.relu(self.fc(torch.cat([x, gg], dim=1)))
        return F.normalize(h, dim=1)
