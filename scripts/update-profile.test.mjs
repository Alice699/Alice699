import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  createSnapshot, fetchProfileData, refreshProfile, renderReadme, renderSvg,
} from './update-profile.mjs';

const config = JSON.parse(await readFile(new URL('../profile.config.json', import.meta.url), 'utf8'));
const templates = await Promise.all(['dark', 'light'].map((theme) => readFile(new URL(`../templates/${theme}_mode.svg`, import.meta.url), 'utf8')));
const now = new Date('2026-10-10T01:17:00Z');
const profile = { login: 'Alice699', name: 'Robbian', location: 'Indonesia', public_repos: 107, public_gists: 3, followers: 12, following: 9 };
const repo = (name, extra = {}) => ({
  name, owner: { login: 'Alice699' }, private: false, fork: false,
  archived: false, disabled: false, size: 10, language: 'TypeScript',
  stargazers_count: 2, pushed_at: '2026-10-01T00:00:00Z', description: '',
  ...extra,
});
const response = (data) => ({ ok: true, json: async () => data });

test('fetches every repository page and uses the token only in API headers', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (!url.includes('/repos?')) return response(profile);
    return response(url.endsWith('page=1')
      ? Array.from({ length: 100 }, (_, index) => repo(`project-${index}`))
      : [repo('last-page', { stargazers_count: 11 })]);
  };
  const data = await fetchProfileData('Alice699', { fetchImpl, token: 'test-token' });
  assert.equal(data.repos.length, 101);
  assert.equal(createSnapshot(data.profile, data.repos, config, now).statistics.stars, 211);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, options }) => !url.includes('test-token') && options.headers.Authorization === 'Bearer test-token'));
});

test('recent work skips the profile, forks, archives, empty/private repos, and other owners', () => {
  const repos = [
    repo('Alice699', { pushed_at: '2026-10-11T00:00:00Z' }),
    repo('fork', { fork: true, language: 'Rust', pushed_at: '2026-10-11T00:00:00Z' }),
    repo('archive', { archived: true }),
    repo('empty', { size: 0 }),
    repo('private', { private: true, stargazers_count: 999 }),
    repo('other-owner', { owner: { login: 'SomeoneElse' }, stargazers_count: 999 }),
    repo('older', { language: 'Python' }),
    repo('newer', { language: null, pushed_at: '2026-10-09T00:00:00Z' }),
  ];
  const snapshot = createSnapshot(profile, repos, config, now);
  assert.deepEqual(snapshot.recentRepositories.map((item) => item.name), ['newer', 'older']);
  assert.deepEqual(snapshot.languages, ['Python']);
  assert.equal(snapshot.statistics.publicRepositories, 107);
  assert.equal(snapshot.statistics.stars, 12);
  assert.equal(snapshot.statistics.publicGists, 3);
});

test('both SVG themes escape API text, fit long names, and render missing repo slots', () => {
  const snapshot = createSnapshot({ ...profile, name: 'Robbian & <script>"\'\u0001' }, [
    repo('a-very-long-project-name-with-many-extra-characters', { language: null }),
  ], config, now);
  for (const template of templates) {
    const svg = renderSvg(template, snapshot, config);
    assert.match(svg, /Robbian &amp; &lt;script&gt;&quot;&apos;/u);
    assert.doesNotMatch(svg, /<script>|\u0001|\{\{[A-Z0-9_]+\}\}/u);
    assert.match(svg, /a-very-long-project-name-with-m…/u);
    assert.match(svg, /10 OCT 2026/u);
    assert.match(svg, /08:17 WIB/u);
    assert.match(svg, /No public project/u);
    assert.match(svg, /<animateTransform/u);
  }
});

test('README updates are repeatable and preserve all manually written content', () => {
  const snapshot = createSnapshot(profile, [repo('test-project', { description: '<script>\n**test** | [link]' })], config, now);
  const initial = '# My intro\n\nA manually maintained paragraph.\n';
  const first = renderReadme(initial, snapshot, config) + '\nMy custom footer.\n';
  const second = renderReadme(first, snapshot, config);
  assert.equal(second, first);
  assert.ok(second.startsWith(initial));
  assert.ok(second.endsWith('My custom footer.\n'));
  assert.match(second, /https:\/\/github.com\/Alice699\/test-project/u);
  assert.doesNotMatch(second, /<script>/u);
  assert.match(second, /&lt;script&gt;/u);
  assert.throws(() => renderReadme('<!-- profile:recent:start -->', snapshot, config), /markers/u);
  assert.throws(() => renderSvg('{{UNKNOWN}}', snapshot, config), /Unknown SVG/u);
});

test('API errors and malformed counts leave every existing output untouched', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'profile-updater-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('profile-updater-test-'));
    return rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'templates'));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'profile.config.json'), JSON.stringify(config));
  await Promise.all(['dark', 'light'].map((theme, index) => writeFile(join(root, `templates/${theme}_mode.svg`), templates[index])));
  const names = ['README.md', 'dark_mode.svg', 'light_mode.svg', 'data/profile.json'];
  await Promise.all(names.map((name) => writeFile(join(root, name), `last-valid-${name}`)));
  for (const fetchImpl of [
    async () => ({ ok: false, status: 403 }),
    async (url) => response(url.includes('/repos?') ? [repo('valid')] : { ...profile, followers: undefined }),
  ]) {
    await assert.rejects(refreshProfile({ root, fetchImpl, now }));
    assert.deepEqual(await Promise.all(names.map((name) => readFile(join(root, name), 'utf8'))), names.map((name) => `last-valid-${name}`));
  }
});
