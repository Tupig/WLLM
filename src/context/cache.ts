/**
 * 工具结果缓存
 *
 * 缓存重复的工具调用结果，减少不必要的执行。
 * 特别适用于 Read、Glob、Grep 等只读操作。
 */
import { createHash } from "crypto";

export interface CacheEntry<T = unknown> {
  /** 缓存键 */
  key: string;
  /** 缓存值 */
  value: T;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间（毫秒） */
  ttl?: number;
  /** 访问次数 */
  hits: number;
}

export interface CacheStats {
  /** 总请求数 */
  totalRequests: number;
  /** 缓存命中数 */
  cacheHits: number;
  /** 缓存未命中数 */
  cacheMisses: number;
  /** 当前缓存条目数 */
  entryCount: number;
  /** 命中率 */
  hitRate: number;
}

/**
 * LRU 缓存实现
 */
export class ToolCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private defaultTtl: number;
  private stats = { hits: 0, misses: 0 };

  constructor(options?: { maxSize?: number; defaultTtl?: number }) {
    this.maxSize = options?.maxSize ?? 100;
    this.defaultTtl = options?.defaultTtl ?? 5 * 60 * 1000; // 5 分钟
  }

  /**
   * 生成缓存键
   */
  static generateKey(toolName: string, input: Record<string, unknown>): string {
    const sorted = Object.keys(input)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = input[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );

    const data = JSON.stringify({ tool: toolName, input: sorted });
    return createHash("md5").update(data).digest("hex");
  }

  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查过期
    if (entry.ttl && Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.hits++;
    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * 设置缓存
   */
  set<T>(key: string, value: T, ttl?: number): void {
    // 如果缓存已满，删除最久未访问的条目
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, {
      key,
      value,
      createdAt: Date.now(),
      ttl: ttl ?? this.defaultTtl,
      hits: 0,
    });
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 淘汰过期或最少访问的条目
   */
  private evict(): void {
    // 先淘汰过期条目
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.ttl && now - entry.createdAt > entry.ttl) {
        this.cache.delete(key);
      }
    }

    // 如果仍然满，淘汰访问次数最少的
    if (this.cache.size >= this.maxSize) {
      let minHits = Infinity;
      let minKey = "";
      for (const [key, entry] of this.cache) {
        if (entry.hits < minHits) {
          minHits = entry.hits;
          minKey = key;
        }
      }
      if (minKey) this.cache.delete(minKey);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    return {
      totalRequests,
      cacheHits: this.stats.hits,
      cacheMisses: this.stats.misses,
      entryCount: this.cache.size,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
    };
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * 只读工具列表（可缓存）
 */
const CACHEABLE_TOOLS = new Set(["Read", "Glob", "Grep", "GitStatus", "GitDiff"]);

/**
 * 检查工具结果是否可缓存
 */
export function isCacheable(toolName: string, input: Record<string, unknown>): boolean {
  if (!CACHEABLE_TOOLS.has(toolName)) return false;

  // Read 文件：如果文件可能变化，不缓存
  if (toolName === "Read") return true;

  // Glob/Grep：不缓存（结果可能随文件变化）
  return false;
}

/**
 * 创建默认缓存实例
 */
export function createDefaultCache(): ToolCache {
  return new ToolCache({
    maxSize: 100,
    defaultTtl: 5 * 60 * 1000, // 5 分钟
  });
}
