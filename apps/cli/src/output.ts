export type OutputWriter = { stdout(value: string): void; stderr(value: string): void };

export class CliOutput {
  constructor(
    private readonly json: boolean,
    private readonly writer: OutputWriter = {
      stdout: (value) => process.stdout.write(`${value}\n`),
      stderr: (value) => process.stderr.write(`${value}\n`),
    },
  ) {}
  data(value: unknown, human: string) {
    this.writer.stdout(this.json ? JSON.stringify({ ok: true, data: value }) : human);
  }
  notice(human: string) {
    if (!this.json) this.writer.stdout(human);
  }
  table(rows: Array<Record<string, unknown>>, columns: string[]) {
    if (this.json) {
      this.data(rows, '');
      return;
    }
    if (!rows.length) {
      this.writer.stdout('没有匹配记录。');
      return;
    }
    const widths = columns.map((column) =>
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)),
    );
    this.writer.stdout(columns.map((column, index) => column.padEnd(widths[index] ?? 0)).join('  '));
    this.writer.stdout(widths.map((width) => '─'.repeat(width)).join('  '));
    for (const row of rows)
      this.writer.stdout(
        columns.map((column, index) => String(row[column] ?? '').padEnd(widths[index] ?? 0)).join('  '),
      );
  }
  error(error: unknown, code = 1) {
    const message = error instanceof Error ? error.message : '未知错误';
    this.writer.stderr(this.json ? JSON.stringify({ ok: false, error: { code, message } }) : `错误：${message}`);
  }
}
