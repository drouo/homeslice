import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBrowserUrl } from '../giturl.mjs';

test('converts scp-style SSH remote to https and strips .git', () => {
  assert.equal(toBrowserUrl('git@github.com:drouo/HODLER.git'), 'https://github.com/drouo/HODLER');
});

test('handles scp-style without .git suffix', () => {
  assert.equal(toBrowserUrl('git@github.com:drouo/HODLER'), 'https://github.com/drouo/HODLER');
});

test('strips .git from an https remote', () => {
  assert.equal(toBrowserUrl('https://github.com/drouo/HODLER.git'), 'https://github.com/drouo/HODLER');
});

test('leaves a clean https URL untouched', () => {
  assert.equal(toBrowserUrl('https://github.com/drouo/HODLER'), 'https://github.com/drouo/HODLER');
});

test('converts ssh:// URL form', () => {
  assert.equal(toBrowserUrl('ssh://git@github.com/drouo/HODLER.git'), 'https://github.com/drouo/HODLER');
});

test('works for non-github hosts', () => {
  assert.equal(toBrowserUrl('git@gitlab.com:group/proj.git'), 'https://gitlab.com/group/proj');
});

test('returns null for empty/missing input', () => {
  assert.equal(toBrowserUrl(null), null);
  assert.equal(toBrowserUrl(''), null);
  assert.equal(toBrowserUrl('   '), null);
});

test('returns null for a value that cannot become an http(s) URL', () => {
  assert.equal(toBrowserUrl('not a url'), null);
});
