# Git Strategies for Monorepos

## Sparse Checkout (only check out part of the repo)

```bash
git clone --filter=blob:none --sparse https://github.com/org/monorepo.git
cd monorepo
git sparse-checkout set packages/my-app packages/shared-utils
```

## Partial Clone (faster clones for large repos)

```bash
# Blobless clone — fetches commits and trees, blobs on demand
git clone --filter=blob:none https://github.com/org/monorepo.git

# Treeless clone — even faster, fetches only commits
git clone --filter=tree:0 https://github.com/org/monorepo.git
```

## Scoped Commits in a Monorepo

Use conventional commit scopes that match package names:

```
feat(payments): add Stripe webhook handler
fix(auth): correct token expiry calculation
chore(deps): upgrade React to 19 in all packages
```

## Tagging in a Monorepo

Use package-prefixed tags for independent versioning:

```bash
git tag payments/v2.1.0
git tag auth/v1.4.2
git push origin --tags
```

## Log for a Specific Package

```bash
# Only show commits that touched a specific directory
git log --oneline -- packages/payments/

# Show diff for that package only
git diff main...HEAD -- packages/payments/
```

## Avoiding Cross-Package Conflicts

- Use `git add packages/my-app/` to scope staging to one package
- Run `git log --oneline -- packages/my-app/` before rebasing to understand your package's history
- Keep inter-package changes in the same commit when they're coupled

## Tools That Help

- **Turborepo** / **Nx** — affected package detection (`--filter`, `--affected`)
- **Changesets** — changelog + versioning across packages
- Both integrate with GitHub Actions for CI on changed packages only
