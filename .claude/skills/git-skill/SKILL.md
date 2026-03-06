---
name: git-skill
description:
  Expert Git workflows for Claude Code. Use this skill whenever the user asks about Git operations,
  version control, branching, merging, rebasing, resolving conflicts, writing commit messages,
  setting up repositories, undoing mistakes, managing remotes, squashing commits, cherry-picking,
  bisecting bugs, tagging releases, handling submodules, configuring Git hooks, or any other
  Git-related task — even if they just say "commit this", "push my changes", "clean up my history",
  or "I messed up in git". Always use this skill before running any git commands so that operations
  are safe, correct, and follow best practices.
---

# Git Skill for Claude Code

This skill guides Claude through safe, correct, and professional Git operations in a Claude Code
(terminal/agentic) context. Always read this skill before running git commands on behalf of a user.

## Core Principles

1. **Safety first** — Never force-push to shared branches (`main`, `master`, `develop`) without
   explicit user confirmation. Always warn before destructive operations.
2. **Verify before acting** — Run `git status` and/or `git log --oneline -10` before making changes
   so you understand the current state.
3. **Atomic commits** — Each commit should represent one logical unit of work. Avoid mixing
   unrelated changes.
4. **Clear communication** — Explain what you're about to do and why, especially for multi-step or
   risky operations.
5. **No silent data loss** — Never `git checkout -- <file>`, `git reset --hard`, `git clean -fd`, or
   `git push --force` without warning the user that changes will be lost.

---

## Commit Message Convention

Follow the **Conventional Commits** specification unless the repo already has its own convention
(check `git log` for existing style).

```
<type>(<optional scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`

**Rules:**

- Summary line ≤ 72 characters, imperative mood ("add feature" not "added feature")
- Body wrapped at 72 characters, explaining _why_ not _what_
- Reference issues/PRs in footer: `Closes #123`, `Refs #456`

**Examples:**

```
feat(auth): add JWT refresh token rotation

fix(api): handle null response from payment gateway

docs: update README with docker-compose instructions

refactor(utils): extract date formatting to shared helper
Closes #89
```

---

## Common Workflows

### 1. Starting Work

```bash
# Always start from an up-to-date base
git checkout main
git pull origin main

# Create a feature branch
git checkout -b feat/your-feature-name

# Or for fixes
git checkout -b fix/issue-description
```

**Branch naming conventions:**

- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance, dependency updates
- `docs/` — documentation only
- `release/` — release preparation
- `hotfix/` — urgent production fixes

---

### 2. Staging and Committing

```bash
# Review what changed first
git diff
git status

# Stage specific files (preferred over git add .)
git add src/components/Button.jsx src/styles/button.css

# Stage interactively (best for partial file staging)
git add -p

# Commit
git commit -m "feat(ui): add loading state to Button component"
```

**When to use `git add .`:** Only when all unstaged changes belong to the same logical commit.
Otherwise use targeted `git add <file>` or `git add -p`.

---

### 3. Syncing with Remote

```bash
# Fetch without merging (safe, always OK)
git fetch origin

# Pull with rebase (preferred over merge pull for linear history)
git pull --rebase origin main

# Push new branch for the first time
git push -u origin feat/your-feature-name

# Push subsequent changes
git push
```

**Prefer `--rebase` on pull** to avoid unnecessary merge commits in feature branches.

---

### 4. Merging Strategies

| Strategy              | When to use                                                     |
| --------------------- | --------------------------------------------------------------- |
| `--no-ff` merge       | Merging feature branches into `main` — preserves branch history |
| `--squash` merge      | Collapsing a messy feature branch into one clean commit         |
| Rebase + fast-forward | Keeping a linear history on small, clean branches               |

```bash
# Merge feature branch preserving history
git checkout main
git merge --no-ff feat/your-feature-name

# Squash merge
git merge --squash feat/your-feature-name
git commit -m "feat: add user authentication flow"
```

---

### 5. Rebasing

```bash
# Rebase feature branch onto latest main
git checkout feat/your-feature-name
git fetch origin
git rebase origin/main

# Interactive rebase to clean up last N commits
git rebase -i HEAD~5
```

**Interactive rebase commands:**

- `pick` — keep commit as-is
- `reword` — keep commit, edit message
- `squash` / `s` — combine with previous commit
- `fixup` / `f` — combine with previous, discard message
- `drop` / `d` — delete commit

⚠️ **Only rebase commits that haven't been pushed to a shared remote.** Rebasing pushed commits
rewrites history and requires force-pushing.

---

### 6. Resolving Merge Conflicts

```bash
# After a conflict is reported
git status   # Shows conflicted files

# Open each conflicted file and resolve markers:
# <<<<<<< HEAD
# your changes
# =======
# their changes
# >>>>>>> branch-name

# After resolving all files
git add <resolved-file>
git rebase --continue   # or git merge --continue

# To abort and go back to original state
git rebase --abort   # or git merge --abort
```

**Tip:** Use `git diff --diff-filter=U` to list only unresolved conflict files.

---

### 7. Undoing Mistakes

> Read this section carefully and always confirm with user before destructive operations.

```bash
# Undo last commit but keep changes staged
git reset --soft HEAD~1

# Undo last commit and unstage changes (keeps files)
git reset HEAD~1

# Undo last commit and DISCARD all changes (DESTRUCTIVE)
git reset --hard HEAD~1   # ⚠️ Warn user before running

# Revert a pushed commit (safe — creates new commit)
git revert <commit-sha>

# Discard changes in a specific file (DESTRUCTIVE)
git checkout -- <file>   # ⚠️ Warn user before running

# Remove untracked files (DESTRUCTIVE)
git clean -fd   # ⚠️ Warn user; use git clean -nfd first to preview
```

**Recovery with reflog:**

```bash
# See recent HEAD positions (lifeline after accidental resets)
git reflog

# Recover to a previous state
git reset --hard HEAD@{3}
```

---

### 8. Stashing

```bash
# Stash current work (tracked files)
git stash

# Stash including untracked files
git stash -u

# Stash with a description
git stash push -m "WIP: half-done auth refactor"

# List stashes
git stash list

# Apply most recent stash (keeps it in stash list)
git stash apply

# Apply and remove from stash list
git stash pop

# Apply a specific stash
git stash apply stash@{2}

# Drop a stash
git stash drop stash@{0}
```

---

### 9. Cherry-picking

```bash
# Apply a specific commit to current branch
git cherry-pick <commit-sha>

# Cherry-pick without auto-committing (to review first)
git cherry-pick -n <commit-sha>

# Cherry-pick a range of commits
git cherry-pick A^..B
```

---

### 10. Tagging Releases

```bash
# Annotated tag (preferred for releases)
git tag -a v1.2.0 -m "Release v1.2.0: adds dark mode and performance fixes"

# Push tag to remote
git push origin v1.2.0

# Push all tags
git push origin --tags

# List tags
git tag -l "v1.*"

# Delete a tag locally and remotely
git tag -d v1.2.0
git push origin --delete v1.2.0
```

---

### 11. Inspecting History

```bash
# Compact log with graph
git log --oneline --graph --decorate --all

# Log for a specific file
git log --follow -p -- path/to/file.js

# Show what changed in a commit
git show <commit-sha>

# Find which commit introduced a string
git log -S "functionName" --source --all

# Compare branches
git diff main...feat/your-feature-name
```

---

### 12. Bisecting (Bug Hunting)

```bash
# Start bisect session
git bisect start

# Mark current state as bad
git bisect bad

# Mark a known good commit
git bisect good v1.0.0

# Git checks out midpoint — test it, then mark:
git bisect good   # or git bisect bad

# Git narrows down until it finds the first bad commit
# When done:
git bisect reset
```

---

### 13. Git Hooks (via Claude Code)

Common hooks to set up in `.git/hooks/` (or via Husky for npm projects):

| Hook         | Use                               |
| ------------ | --------------------------------- |
| `pre-commit` | Run linter, formatter, type check |
| `commit-msg` | Validate commit message format    |
| `pre-push`   | Run test suite before push        |

```bash
# Example: pre-commit hook to run ESLint
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
npm run lint --silent
EOF
chmod +x .git/hooks/pre-commit
```

For team-shared hooks, prefer **Husky** + **lint-staged** in `package.json`.

---

### 14. Cleaning Up

```bash
# Delete local branch after merge
git branch -d feat/your-feature-name

# Force delete unmerged branch
git branch -D feat/abandoned-experiment

# Delete remote branch
git push origin --delete feat/your-feature-name

# Prune remote-tracking refs that no longer exist on remote
git fetch --prune

# Remove all local branches already merged into main
git branch --merged main | grep -v "^\*\|main\|master\|develop" | xargs git branch -d
```

---

## Safety Checklist Before Destructive Commands

Before running any of these, pause and confirm with the user:

- [ ] `git reset --hard` — will discard uncommitted changes permanently
- [ ] `git push --force` or `git push -f` — rewrites remote history
- [ ] `git push --force-with-lease` — safer force push (fails if remote has new commits); prefer
      this over `--force`
- [ ] `git clean -fd` — permanently deletes untracked files
- [ ] `git checkout -- <file>` — discards file changes permanently
- [ ] Deleting branches with `-D` — branch may not be merged

---

## Detecting Repo Context

Before running commands, gather context:

```bash
git remote -v          # Identify remote (GitHub, GitLab, etc.)
git branch -a          # See all branches
git log --oneline -5   # See recent history style
cat .gitignore         # Understand what's excluded
ls .husky/ 2>/dev/null # Check for Husky hooks
```

---

## Reference Files

For advanced topics, read the appropriate reference file:

- `references/submodules.md` — Working with Git submodules
- `references/monorepo.md` — Git strategies for monorepos
- `references/github-workflows.md` — GitHub-specific: PRs, Actions, branch protection

Read these only when the user's task specifically requires them.
