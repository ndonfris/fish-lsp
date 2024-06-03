---
name: Bug Report
about: Report a bug you're experiencing
title: BUG
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior.

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Please complete the following information:**
 - OS: [e.g. Ubuntu, macOS, etc...] `uname -o`
 - yarn version: [e.g. yarn@1.22.22] `yarn --version`
 - node version: [e.g., node@20.0.0] `node --version` 
 - fish version [e.g., fish@3.7.1] `fish --version`
 - fish-lsp version [e.g, fish-lsp@1.0.4] `fish-lsp --version`
> You can run the following in your shell: 
```fish
echo "OS NAME: $(uname -o)"
echo "YARN VERSION: $(yarn --version)"
echo "NODE VERSION: $(node --version)"
echo "FISH VERSION: $(fish --version)"
echo "FISH-LSP VERSION: $(fish-lsp --version)"
```

**Additional context**
Any other context about the problem here.
  - fish-lsp configuration (Include if relevant to the issue)
 - relevant `logs.txt` output: `cat (fish-lsp info --logs-file)`
