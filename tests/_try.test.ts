import { test } from 'vitest';
import { sampleOffice } from '../src/model/sample';
import { interpret } from '../src/ai/parser';
import { applyOps } from '../src/engine/ops';
import { validate } from '../src/engine/validate';
const cmds = [
  'Add a librarian archive terminal against the back wall',
  'Add a tube station beside every research desk',
  'Replace the executive desk with a wider black titanium desk',
  'Add a lounge beside the engineering lab',
  'Make the lighting warmer and the floor dark graphite',
  'Arrange the desks in two aligned rows in the research lab',
  'Add plants without blocking doors',
];
test('try', () => {
  for (const c of cmds) {
    const d = sampleOffice();
    const p = interpret(c, { doc: d, selection: { kind: 'none' }, idleAgentIds: [] });
    if (p.kind !== 'plan') { console.log(c, '=>', p.kind, JSON.stringify(p).slice(0, 300)); continue; }
    const r = applyOps(d, p.ops);
    const before = validate(d).length;
    console.log(c, '=>', p.label, '|', p.explanation.slice(0, 4).join(' / '), '| errors', r.errors, '| issues', before, '->', validate(r.doc).map((i) => i.message).slice(0, 3));
  }
});
