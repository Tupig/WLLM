/**
 * 简单测试框架
 *
 * 提供基础的测试运行能力。
 */
import chalk from "chalk";

export interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
  timeout?: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export class TestRunner {
  private tests: TestCase[] = [];
  private results: TestResult[] = [];

  /**
   * 添加测试
   */
  test(name: string, fn: () => Promise<void> | void, timeout?: number): void {
    this.tests.push({ name, fn, timeout });
  }

  /**
   * 运行所有测试
   */
  async run(): Promise<{ passed: number; failed: number; total: number }> {
    console.log(chalk.cyan(`\n运行 ${this.tests.length} 个测试...\n`));

    for (const t of this.tests) {
      const start = Date.now();
      try {
        await Promise.race([
          t.fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("超时")), t.timeout ?? 5000),
          ),
        ]);
        const duration = Date.now() - start;
        this.results.push({ name: t.name, passed: true, duration });
        console.log(chalk.green(`  ✓ ${t.name} (${duration}ms)`));
      } catch (err) {
        const duration = Date.now() - start;
        const error = err instanceof Error ? err.message : String(err);
        this.results.push({ name: t.name, passed: false, duration, error });
        console.log(chalk.red(`  ✗ ${t.name} (${duration}ms)`));
        console.log(chalk.gray(`    ${error}`));
      }
    }

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;

    console.log(chalk.cyan(`\n结果：${passed} 通过, ${failed} 失败, 共 ${this.tests.length} 个`));

    return { passed, failed, total: this.tests.length };
  }

  /**
   * 获取结果
   */
  getResults(): TestResult[] {
    return [...this.results];
  }
}

/**
 * 断言函数
 */
export const assert = {
  equal(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) {
      throw new Error(message ?? `期望 ${expected}，实际 ${actual}`);
    }
  },

  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message ?? `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
    }
  },

  ok(value: unknown, message?: string): void {
    if (!value) {
      throw new Error(message ?? `期望值为真，实际为 ${value}`);
    }
  },

  throws(fn: () => void, message?: string): void {
    let threw = false;
    try {
      fn();
    } catch (err) {
      threw = true;
      // 如果指定了错误消息，验证是否匹配
      if (message && err instanceof Error && err.message !== message) {
        throw new Error(`期望错误「${message}」，实际错误「${err.message}」`);
      }
      // 函数抛出了错误，断言通过
      return;
    }
    if (!threw) {
      throw new Error(message ?? "期望抛出错误，但没有");
    }
  },

  rejects(fn: () => Promise<void>, message?: string): Promise<void> {
    return fn().then(
      () => {
        throw new Error(message ?? "期望拒绝，但没有");
      },
      () => {},
    );
  },
};

/**
 * 创建测试运行器
 */
export function createTestRunner(): TestRunner {
  return new TestRunner();
}
