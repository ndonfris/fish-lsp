# Security Policy

## Supported Versions

| Version   | Supported          |
| --------- | ------------------ |
| >= 1.1.x  | :white_check_mark: |
| < 1.1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in fish-lsp, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities by emailing the maintainer directly or by using
[GitHub's private vulnerability reporting](https://github.com/ndonfris/fish-lsp/security/advisories/new).

### What to include

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (if applicable)

### Response timeline

- **Acknowledgment**: Within 48 hours of receiving your report
- **Assessment**: Within 7 days, we will assess the severity and provide an initial response
- **Fix**: Critical vulnerabilities will be prioritized and patched as soon as possible

## Scope

fish-lsp is a language server that runs locally and communicates with editors over stdio/TCP.
The primary security considerations include:

- **Code execution**: fish-lsp parses and analyzes fish shell scripts but does not execute them
- **File system access**: The server reads files within your workspace to provide language features
- **Dependencies**: Third-party npm packages are used and kept up to date

## Best Practices for Users

- Keep fish-lsp updated to the latest version
- Review workspace trust settings in your editor before opening untrusted projects
- Report any unexpected behavior that could indicate a security issue
