# Automatic profile updates

The terminal card keeps its animated cat and light/dark themes. GitHub Actions
refreshes both SVG files and `data/profile.json` daily at **08:17 WIB**
(`01:17 UTC`). Updates also run after
changes to the updater, templates, configuration, or update workflow on `main`.

For an immediate update, open [Update GitHub profile](https://github.com/Alice699/Alice699/actions/workflows/update-profile.yml)
in the Actions tab and choose **Run workflow** on `main`.

## Data that updates automatically

- Name, username, and location come from the public GitHub user profile.
- Repositories, followers, following, and public gists use GitHub's public counts.
  The repository total can differ from the count shown while signed in because
  private repositories are excluded.
- Stars are the total stars **received** by owned public repositories, including
  forks. They are not the number of repositories the user has starred.
- Languages are the four most common primary languages among active, nonempty,
  original public projects, ranked by repository count with alphabetical ties.
  They describe the public projects rather than every language the author knows.
- The card lists the three most recently pushed public projects. Forks,
  archived/disabled/empty repositories, and the profile repository itself are
  excluded, so the updater's own commits do not become recent work.
- The refresh timestamp uses `Asia/Jakarta` and is shown as WIB.

Every repository page is fetched before generation. If the API fails, data is
incomplete, or rendering fails, the previous profile files are kept and the
workflow reports a failure. GitHub-sourced strings are escaped before they are
placed inside SVG.

## Editing the profile

Edit `profile.config.json` to change the role, the four focus lines, the web
frameworks, or the Web3 stack. These are personal choices and are maintained
manually. The GitHub bio and pinned repositories are managed through GitHub's
profile settings.

Edit the SVG files in `templates/` to change the card's design. The root
`dark_mode.svg` and `light_mode.svg` files are generated outputs. The README
embeds the card and is maintained manually; the updater does not modify it.

## Running locally

Requires Node.js 24. There are no npm dependencies to install.

```sh
node --test scripts/update-profile.test.mjs
node scripts/update-profile.mjs
```

Local updates can read public data without authentication. In GitHub Actions,
the updater uses the automatically supplied `GITHUB_TOKEN`, and only the update
job has `contents: write` permission to commit generated files. No personal
access token or extra repository secret is required. Action revisions
are pinned to full commit hashes.

The validation workflow runs on pushes and pull requests with read-only access.
The update workflow runs only in `Alice699/Alice699` and serializes updates to
avoid competing updater commits. A push from the automatic workflow does not
trigger another automatic run, and generated files are excluded from its push
path filters.

GitHub may delay scheduled runs during periods of high load. Public repositories
can have schedules disabled after 60 days without repository activity; re-enable
the workflow in Actions if GitHub disables it. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
