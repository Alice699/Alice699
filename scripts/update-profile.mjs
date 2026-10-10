import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startMarker = '<!-- profile:recent:start -->';
const endMarker = '<!-- profile:recent:end -->';

const singleLine = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const shorten = (value, length) => {
  const characters = Array.from(singleLine(value));
  return characters.length > length
    ? characters.slice(0, length - 1).join('') + '…'
    : characters.join('');
};

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
    .replace(/[&<>"']/gu, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    })[character]);
}

function markdown(value) {
  return escapeXml(singleLine(value)).replace(/[\\`*_[\]()|~]/gu, '\\$&');
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid GitHub count: ${label}`);
  }
  return value;
}

function validateConfig(config) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(config.username ?? '')) {
    throw new Error('profile.config.json must contain a valid GitHub username.');
  }
  if (typeof config.role !== 'string' || !config.role.trim()
    || !Array.isArray(config.focus) || config.focus.length !== 4
    || config.focus.some((value) => typeof value !== 'string')
    || !Array.isArray(config.web) || config.web.some((value) => typeof value !== 'string')
    || !Array.isArray(config.web3) || config.web3.some((value) => typeof value !== 'string')) {
    throw new Error('Profile config requires a role, four focus lines, and web/web3 arrays.');
  }
  if (typeof config.timeZone !== 'string' || !config.timeZone) {
    throw new Error('Profile config requires a timeZone.');
  }
  new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone });
}

export async function fetchProfileData(username, { fetchImpl = fetch, token } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'github-profile-updater',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function get(path) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}): ${path}`);
    }
    return response.json();
  }

  async function repositories() {
    const result = [];
    for (let page = 1; ; page += 1) {
      const items = await get(`/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=${page}`);
      if (!Array.isArray(items)) throw new Error('GitHub did not return a repository list.');
      result.push(...items);
      if (items.length < 100) return result;
    }
  }

  const [profile, repos] = await Promise.all([
    get(`/users/${encodeURIComponent(username)}`),
    repositories(),
  ]);
  return { profile, repos };
}

export function createSnapshot(profile, repos, config, now = new Date()) {
  validateConfig(config);
  if (typeof profile?.login !== 'string'
    || profile.login.toLowerCase() !== config.username.toLowerCase()) {
    throw new Error('GitHub returned a different or incomplete user profile.');
  }
  if (!Array.isArray(repos)) throw new Error('Invalid repository data.');
  for (const repo of repos) {
    if (typeof repo?.name !== 'string' || !repo.name
      || typeof repo.owner?.login !== 'string'
      || typeof repo.private !== 'boolean'
      || typeof repo.fork !== 'boolean'
      || (repo.language !== null && typeof repo.language !== 'string')) {
      throw new Error('GitHub returned incomplete repository data.');
    }
    count(repo.stargazers_count, `${repo.name} stars`);
  }

  const publicRepos = repos.filter((repo) => !repo.private
    && repo.owner.login.toLowerCase() === profile.login.toLowerCase());
  const projects = publicRepos.filter((repo) => !repo.fork && !repo.archived
    && !repo.disabled && repo.size > 0
    && repo.name.toLowerCase() !== profile.login.toLowerCase());

  const languages = new Map();
  for (const repo of projects) {
    if (repo.language) languages.set(repo.language, (languages.get(repo.language) ?? 0) + 1);
  }

  return {
    updatedAt: new Date(now).toISOString(),
    username: profile.login,
    name: singleLine(profile.name) || profile.login,
    location: singleLine(profile.location) || 'Not specified',
    statistics: {
      publicRepositories: count(profile.public_repos, 'public repositories'),
      stars: publicRepos.reduce((total, repo) => total + repo.stargazers_count, 0),
      followers: count(profile.followers, 'followers'),
      following: count(profile.following, 'following'),
      publicGists: count(profile.public_gists, 'public gists'),
    },
    languages: [...languages.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
      .slice(0, 4)
      .map(([language]) => language),
    recentRepositories: projects
      .sort((a, b) => (Date.parse(b.pushed_at) || 0) - (Date.parse(a.pushed_at) || 0)
        || a.name.localeCompare(b.name, 'en'))
      .slice(0, 3)
      .map((repo) => ({
        name: repo.name,
        fullName: `${profile.login}/${repo.name}`,
        url: `https://github.com/${encodeURIComponent(profile.login)}/${encodeURIComponent(repo.name)}`,
        language: repo.language,
        description: singleLine(repo.description),
        pushedAt: repo.pushed_at ?? null,
      })),
  };
}

function dates(snapshot, config) {
  const date = new Date(snapshot.updatedAt);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone, day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
  return {
    day,
    full: `${day}, ${time} ${config.timeZone === 'Asia/Jakarta' ? 'WIB' : config.timeZone}`,
  };
}

export function renderSvg(template, snapshot, config) {
  const updated = dates(snapshot, config);
  const values = {
    NAME: shorten(snapshot.name, 39),
    USERNAME: snapshot.username,
    TERMINAL_USER: snapshot.username.toLowerCase(),
    LOCATION: shorten(snapshot.location, 39),
    ROLE: shorten(config.role, 39),
    LANGUAGES: shorten(snapshot.languages.join(' / ') || 'Not available yet', 39),
    WEB: shorten(config.web.join(' / '), 39),
    WEB3: shorten(config.web3.join(' / '), 39),
    UPDATED_DATE: updated.day.toUpperCase(),
    UPDATED_AT: updated.full,
    REPOS: snapshot.statistics.publicRepositories,
    STARS: snapshot.statistics.stars,
    FOLLOWERS: snapshot.statistics.followers,
    FOLLOWING: snapshot.statistics.following,
    GISTS: snapshot.statistics.publicGists,
  };
  config.focus.forEach((value, index) => { values[`FOCUS_${index + 1}`] = shorten(value, 46); });
  for (let index = 0; index < 3; index += 1) {
    const repo = snapshot.recentRepositories[index];
    values[`REPO_${index + 1}_FULL_NAME`] = repo?.fullName ?? 'No public project';
    values[`REPO_${index + 1}_NAME`] = shorten(repo?.name ?? '—', 32);
    values[`REPO_${index + 1}_LANGUAGE`] = shorten(repo?.language ?? '—', 16);
  }

  return template.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (_match, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown SVG placeholder: ${key}`);
    return escapeXml(values[key]);
  });
}

export function renderReadme(existing, snapshot, config) {
  const rows = snapshot.recentRepositories.map((repo) => {
    const description = repo.description ? ` — ${markdown(shorten(repo.description, 220))}` : '';
    return `- **[${markdown(repo.name)}](${repo.url})** · ${markdown(repo.language ?? 'Language not detected')}${description}`;
  });
  const block = [
    startMarker,
    '### Recent work',
    '',
    ...(rows.length ? rows : ['No public projects to show yet.']),
    '',
    `<sub>Public GitHub data · refreshed ${escapeXml(dates(snapshot, config).full)}.</sub>`,
    endMarker,
  ].join('\n');
  const starts = existing.split(startMarker).length - 1;
  const ends = existing.split(endMarker).length - 1;
  if (starts === 0 && ends === 0) return `${existing.trimEnd()}\n\n${block}\n`;
  if (starts !== 1 || ends !== 1 || existing.indexOf(startMarker) >= existing.indexOf(endMarker)) {
    throw new Error('README update markers are missing, duplicated, or out of order.');
  }
  return existing.slice(0, existing.indexOf(startMarker))
    + block + existing.slice(existing.indexOf(endMarker) + endMarker.length);
}

export async function refreshProfile({
  root = projectRoot,
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  now = new Date(),
} = {}) {
  const config = JSON.parse(await readFile(join(root, 'profile.config.json'), 'utf8'));
  validateConfig(config);
  const [{ profile, repos }, darkTemplate, lightTemplate, readme] = await Promise.all([
    fetchProfileData(config.username, { fetchImpl, token }),
    readFile(join(root, 'templates/dark_mode.svg'), 'utf8'),
    readFile(join(root, 'templates/light_mode.svg'), 'utf8'),
    readFile(join(root, 'README.md'), 'utf8'),
  ]);
  const snapshot = createSnapshot(profile, repos, config, now);

  // Fetch, validate, and render every output before touching the last valid files.
  const outputs = [
    ['dark_mode.svg', renderSvg(darkTemplate, snapshot, config)],
    ['light_mode.svg', renderSvg(lightTemplate, snapshot, config)],
    ['README.md', renderReadme(readme, snapshot, config)],
    ['data/profile.json', JSON.stringify(snapshot, null, 2) + '\n'],
  ];
  await mkdir(join(root, 'data'), { recursive: true });
  for (const [name, content] of outputs) await writeFile(join(root, name), content, 'utf8');
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const snapshot = await refreshProfile();
    console.log(`Updated ${snapshot.username}: ${snapshot.statistics.publicRepositories} public repos, ${snapshot.statistics.followers} followers, ${snapshot.statistics.stars} stars.`);
  } catch (error) {
    console.error(`Profile update failed: ${error.message}`);
    process.exitCode = 1;
  }
}
