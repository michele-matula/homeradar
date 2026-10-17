import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('schema del report', () => {
  it('estensione e Worker usano lo stesso file', () => {
    expect(read('worker/src/schema.ts')).toBe(read('src/shared/report-schema.ts'));
  });
});
