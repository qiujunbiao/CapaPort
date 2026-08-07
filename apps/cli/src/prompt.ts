import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { CancelledError, UsageError } from './parser.js';

export type Prompter = { ask(question: string): Promise<string>; confirm(question: string): Promise<boolean> };
export const terminalPrompter: Prompter = {
  async ask(question) {
    if (!stdin.isTTY) throw new UsageError(`${question}：非交互模式必须通过参数或环境变量提供`);
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      return (await reader.question(`${question}: `)).trim();
    } finally {
      reader.close();
    }
  },
  async confirm(question) {
    if (!stdin.isTTY) throw new CancelledError('非交互模式需要 --yes 才能执行写入操作');
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      return /^y(es)?$/i.test((await reader.question(`${question} [y/N] `)).trim());
    } finally {
      reader.close();
    }
  },
};
