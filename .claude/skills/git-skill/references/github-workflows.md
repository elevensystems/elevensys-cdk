# GitHub-Specific Git Workflows

## Pull Requests

### Opening a PR via CLI (GitHub CLI)

```bash
# Install: https://cli.github.com
gh pr create --title "feat: add dark mode" --body "Closes #42" --base main

# Open in browser
gh pr view --web

# Check PR status / CI
gh pr status
gh pr checks
```

### PR Best Practices

- Keep PRs small and focused (< 400 lines changed is a good target)
- Link to the issue: `Closes #<issue-number>` in the PR body
- Add a summary of _what_ and _why_, not just _what_
- Request specific reviewers (`gh pr edit --add-reviewer username`)

---

## Branch Protection (for repo admins)

Recommended settings for `main`/`master`:

- Require pull request reviews before merging (at least 1)
- Require status checks to pass (CI, lint, tests)
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions

---

## GitHub Actions Integration

When Claude Code creates or modifies workflow files:

```yaml
# .github/workflows/ci.yml skeleton
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
```

Always use pinned action versions (`@v4` not `@latest`) for security and reproducibility.

---

## Useful GitHub-Specific Git Commands

```bash
# Fetch a PR branch locally (without knowing the branch name)
git fetch origin pull/<PR_NUMBER>/head:pr-<PR_NUMBER>
git checkout pr-<PR_NUMBER>

# Push to trigger CI without a code change
git commit --allow-empty -m "ci: trigger pipeline"
git push
```

---

## Secrets and .gitignore

Never commit secrets. If a secret was accidentally committed:

```bash
# Immediately rotate the secret (the git history is now compromised)
# Then use BFG Repo Cleaner or git filter-repo to scrub history
# Finally, force-push all branches and notify collaborators

# Prevention: use git-secrets or similar pre-commit tooling
git secrets --install
git secrets --register-aws
```

Canonical `.gitignore` additions for Node.js projects:

```
node_modules/
.env
.env.local
.env.*.local
dist/
build/
.DS_Store
*.log
```
