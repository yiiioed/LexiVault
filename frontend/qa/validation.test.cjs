const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('./load-validation.cjs');

test('institutional emails, aliases, whitespace normalization, and malformed addresses', () => {
  for (const email of ['researcher@institute.edu', 'first.last+lab@dept.example.ac.uk', 'a@b.io']) assert.equal(V.validEmail(email), true, email);
  assert.equal(V.normalizeEmail('  researcher@institute.edu  '), 'researcher@institute.edu');
  for (const email of ['', 'a@', '@example.com', 'a@@b.com', '.a@b.com', 'a..b@c.edu', 'a b@c.edu', 'a@-c.edu', 'a@c..edu', 'a@localhost', `${'x'.repeat(65)}@example.com`]) assert.equal(V.validEmail(email), false, email);
});
test('existing account passwords are not subjected to new-account policy', () => {
  assert.deepEqual(V.validate({email:'a@b.edu', password:'old', mode:'login'}), {});
  assert.deepEqual(V.validate({email:'a@b.edu', password:'', mode:'login'}), {password:'passwordRequired'});
});
test('new-account password boundaries, Unicode letters, confirmation, and upper limit', () => {
  assert.equal(V.validNewPassword('abc12345'), true);
  assert.equal(V.validNewPassword('科研笔记1234'), true);
  assert.equal(V.validNewPassword('a1'+'x'.repeat(126)), true);
  for (const value of ['abc1234', 'abcdefgh', '12345678', 'a1'+'x'.repeat(127)]) assert.equal(V.validNewPassword(value), false);
  assert.deepEqual(V.validate({email:'a@b.edu', password:'abc12345', confirmPassword:'abc12346', mode:'register'}), {confirm:'passwordMismatch'});
  assert.deepEqual(V.validate({email:'a@b.edu', password:'abc12345', confirmPassword:'abc12345', mode:'register'}), {});
});
