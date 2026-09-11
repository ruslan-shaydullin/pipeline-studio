import test from 'node:test';
import assert from 'node:assert/strict';
import { localPorts } from '../lib/local-config.mjs';

test('local ports default and override independently', () => {
  assert.deepEqual(localPorts({}), { web: 3000, runner: 4317 });
  assert.deepEqual(
    localPorts({ PIPELINE_WEB_PORT: '3100', PIPELINE_PORT: '4400' }),
    { web: 3100, runner: 4400 },
  );
});

test('rejects invalid ports before starting either server', () => {
  for (const value of [
    '',
    '0',
    '65536',
    '1.5',
    '-1',
    '3000junk',
    'https://example.com',
  ]) {
    assert.throws(() => localPorts({ PIPELINE_WEB_PORT: value }));
    assert.throws(() => localPorts({ PIPELINE_PORT: value }));
  }
  assert.throws(() => localPorts({ PIPELINE_WEB_PORT: '4317' }), /must differ/);
});
