# Git Submodules Reference

## Adding a Submodule

```bash
git submodule add https://github.com/org/repo.git path/to/submodule
git commit -m "chore: add <repo> as submodule"
```

## Cloning a Repo with Submodules

```bash
# Clone and initialize all submodules in one step
git clone --recurse-submodules https://github.com/org/main-repo.git

# Or after a plain clone
git submodule update --init --recursive
```

## Updating Submodules

```bash
# Update all submodules to their latest remote commit
git submodule update --remote --merge

# Update a specific submodule
git submodule update --remote path/to/submodule
```

## Removing a Submodule

```bash
git submodule deinit path/to/submodule
git rm path/to/submodule
rm -rf .git/modules/path/to/submodule
git commit -m "chore: remove <submodule> submodule"
```

## Common Gotchas

- After pulling upstream changes that add/modify submodules, always run
  `git submodule update --init --recursive`
- Submodule pointers are SHA-pinned — updating the pointer requires a commit in the parent repo
- Use `git diff --submodule` to see submodule changes clearly
