import { sampleOffice } from '../src/model/sample';
import { validate } from '../src/engine/validate';

test('sample office builds with every hallway connected and no validation issues', () => {
  const d = sampleOffice();
  expect(Object.values(d.corridors).every((c) => c.status === 'ok')).toBe(true);
  expect(validate(d)).toEqual([]);
});
