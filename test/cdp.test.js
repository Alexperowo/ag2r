import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTarget } from '../src/cdp.js';

test('selectTarget prefers the Antigravity workbench over its loading page', () => {
  const loadingPage = {
    id: 'loading',
    type: 'page',
    title: 'Loading Antigravity',
    url: 'data:text/html,<title>Loading Antigravity</title>',
  };
  const workbench = {
    id: 'workbench',
    type: 'page',
    title: 'Antigravity',
    url: 'https://127.0.0.1:58401/',
  };

  assert.equal(selectTarget([loadingPage, workbench]), workbench);
});

test('selectTarget ignores internal pages and returns null without a usable page', () => {
  assert.equal(selectTarget([
    { type: 'page', title: 'Loading Antigravity', url: 'data:text/html,loading' },
    { type: 'page', title: '', url: '' },
    { type: 'other', title: 'Antigravity', url: 'https://127.0.0.1:58401/' },
  ]), null);
});

test('selectTarget keeps supported fallback targets', () => {
  const launchpad = {
    type: 'page',
    title: 'Launchpad',
    url: 'http://127.0.0.1:3000/jetski',
  };

  assert.equal(selectTarget([launchpad]), launchpad);
});
