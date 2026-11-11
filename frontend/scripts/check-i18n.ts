import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';

type Tree = { [key: string]: unknown };

function flatten(tree: Tree, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Tree, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const a = flatten(ar as unknown as Tree);
const e = flatten(en as unknown as Tree);
const problems: string[] = [];
for (const key of e.keys()) if (!a.has(key)) problems.push(`missing in ar: ${key}`);
for (const key of a.keys()) if (!e.has(key)) problems.push(`missing in en: ${key}`);
for (const [key, value] of e) {
  const other = a.get(key);
  if (other === undefined) continue;
  if (typeof value !== typeof other) problems.push(`different kind: ${key}`);
  else if (typeof value === 'function' && value.length !== (other as (...args: unknown[]) => unknown).length) {
    problems.push(`different parameters: ${key}`);
  } else if (typeof value === 'string' && (value.trim() === '') !== ((other as string).trim() === '')) {
    problems.push(`empty translation: ${key}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n: ar and en match (${e.size} keys)`);
