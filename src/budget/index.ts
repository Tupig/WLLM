/**
 * Token 预算与成本追踪
 *
 * 追踪 Token 使用量，计算成本，支持预算限制。
 */

export interface TokenUsage {
  /** 输入 Token */
  input: number;
  /** 输出 Token */
  output: number;
  /** 缓存创建 Token */
  cacheCreation?: number;
  /** 缓存读取 Token */
  cacheRead?: number;
}

export interface CostEstimate {
  /** 输入成本（美元） */
  inputCost: number;
  /** 输出成本（美元） */
  outputCost: number;
  /** 总成本（美元） */
  totalCost: number;
}

export interface BudgetConfig {
  /** 每次会话最大成本（美元） */
  maxCostPerSession?: number;
  /** 每次请求最大 Token */
  maxTokensPerRequest?: number;
  /** 每日最大成本（美元） */
  maxDailyCost?: number;
}

/**
 * 模型定价（每 1M Token，美元）
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
};

/**
 * 获取模型定价
 */
export function getModelPricing(model: string): { input: number; output: number } | null {
  return MODEL_PRICING[model] ?? null;
}

/**
 * 计算成本
 */
export function calculateCost(
  usage: TokenUsage,
  model: string,
): CostEstimate | null {
  const pricing = getModelPricing(model);
  if (!pricing) return null;

  const inputCost = (usage.input / 1_000_000) * pricing.input;
  const outputCost = (usage.output / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Token 预算管理器
 */
export class TokenBudgetManager {
  private usage: TokenUsage = { input: 0, output: 0 };
  private model: string;
  private budget: BudgetConfig;
  private sessionStartTime: number;

  constructor(model: string, budget: BudgetConfig = {}) {
    this.model = model;
    this.budget = budget;
    this.sessionStartTime = Date.now();
  }

  /** 记录 Token 使用 */
  recordUsage(usage: Partial<TokenUsage>): void {
    this.usage.input += usage.input ?? 0;
    this.usage.output += usage.output ?? 0;
  }

  /** 获取当前使用量 */
  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  /** 获取成本估算 */
  getCost(): CostEstimate | null {
    return calculateCost(this.usage, this.model);
  }

  /** 检查是否超出预算 */
  isOverBudget(): boolean {
    const cost = this.getCost();
    if (!cost) return false;

    if (this.budget.maxCostPerSession && cost.totalCost > this.budget.maxCostPerSession) {
      return true;
    }

    return false;
  }

  /** 获取剩余预算 */
  getRemainingBudget(): number | null {
    if (!this.budget.maxCostPerSession) return null;
    const cost = this.getCost();
    if (!cost) return this.budget.maxCostPerSession;
    return Math.max(0, this.budget.maxCostPerSession - cost.totalCost);
  }

  /** 格式化使用报告 */
  formatReport(): string {
    const cost = this.getCost();
    const lines: string[] = [
      "Token 使用报告：",
      `  输入：${this.usage.input.toLocaleString()} tokens`,
      `  输出：${this.usage.output.toLocaleString()} tokens`,
    ];

    if (cost) {
      lines.push(`  输入成本：$${cost.inputCost.toFixed(4)}`);
      lines.push(`  输出成本：$${cost.outputCost.toFixed(4)}`);
      lines.push(`  总成本：$${cost.totalCost.toFixed(4)}`);
    }

    if (this.budget.maxCostPerSession) {
      const remaining = this.getRemainingBudget();
      lines.push(`  预算剩余：$${remaining?.toFixed(4) ?? "N/A"}`);
    }

    const elapsed = Date.now() - this.sessionStartTime;
    lines.push(`  会话时长：${Math.round(elapsed / 1000)}s`);

    return lines.join("\n");
  }

  /** 重置使用量 */
  reset(): void {
    this.usage = { input: 0, output: 0 };
    this.sessionStartTime = Date.now();
  }
}

/**
 * 创建默认预算管理器
 */
export function createDefaultBudgetManager(model: string): TokenBudgetManager {
  return new TokenBudgetManager(model, {
    maxCostPerSession: 10.0, // 默认 10 美元
  });
}
