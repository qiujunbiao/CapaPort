export type ConflictDiffLine = {
  kind: 'context' | 'add' | 'remove';
  content: string;
  oldLine?: number;
  newLine?: number;
};

export function componentTypeForPath(path: string): 'skill' | 'prompt' | 'context' | undefined {
  const root = path.replaceAll('\\', '/').split('/')[0];
  if (root === 'skills') return 'skill';
  if (root === 'commands' || root === 'prompts') return 'prompt';
  if (root === 'rules' || root === 'context') return 'context';
  return undefined;
}

export function createConflictDiff(localContent: string, organizationContent: string): ConflictDiffLine[] {
  const oldLines = localContent.replaceAll('\r\n', '\n').split('\n');
  const newLines = organizationContent.replaceAll('\r\n', '\n').split('\n');
  const lengths = Array.from({ length: oldLines.length + 1 }, () => new Array<number>(newLines.length + 1).fill(0));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    const row = lengths[oldIndex];
    if (!row) continue;
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      row[newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? (lengths[oldIndex + 1]?.[newIndex + 1] ?? 0) + 1
          : Math.max(lengths[oldIndex + 1]?.[newIndex] ?? 0, lengths[oldIndex]?.[newIndex + 1] ?? 0);
    }
  }
  const result: ConflictDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({
        kind: 'context',
        content: oldLines[oldIndex] ?? '',
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (newIndex >= newLines.length ||
        (lengths[oldIndex + 1]?.[newIndex] ?? 0) >= (lengths[oldIndex]?.[newIndex + 1] ?? 0))
    ) {
      result.push({ kind: 'remove', content: oldLines[oldIndex] ?? '', oldLine: oldIndex + 1 });
      oldIndex += 1;
    } else {
      result.push({ kind: 'add', content: newLines[newIndex] ?? '', newLine: newIndex + 1 });
      newIndex += 1;
    }
  }
  return result;
}
