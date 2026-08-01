# Contributing to AG2R

Thank you for your interest in contributing to AG2R (Antigravity 2.0 Remote)! This document provides guidelines and instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Requests](#pull-requests)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

---

## Getting Started

### Prerequisites

- Node.js 18+
- Git
- Antigravity CLI (for local testing)

### Setup

```bash
# Fork the repository
git clone git@github.com:your-username/ag2r.git
cd ag2r

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Generate secure credentials
echo "APP_PASSWORD=$(openssl rand -base64 16)" >> .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
```

---

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-voice-input`
- `fix/cdp-connection-timeout`
- `docs/update-readme`
- `refactor/state-management`

### Making Changes

1. Create a new branch from `main`
2. Make your changes
3. Run linter and tests
4. Commit with clear messages
5. Push and open a Pull Request

---

## Coding Standards

### JavaScript Style

- Use ES6+ features (const/let, arrow functions, async/await)
- Prefer functional programming patterns
- Avoid global state when possible
- Use JSDoc for public functions

### File Organization

```
ag2r/
├── server.js          # Main server logic
├── public/
│   ├── index.html     # HTML structure
│   ├── css/
│   │   └── style.css  # Styles (mobile-first)
│   └── js/
│       └── app.js     # Client-side logic
├── docs/              # Screenshots and assets
└── test/              # Tests (future)
```

### Accessibility (A11y)

All changes MUST maintain WCAG 2.1 AA compliance:
- Include ARIA attributes for interactive elements
- Ensure keyboard navigation works
- Maintain sufficient color contrast
- Test with screen readers when possible

### Security

- Never commit `.env` or certificates
- Sanitize all user inputs
- Use parameterized queries (if applicable)
- Follow principle of least privilege

---

## Testing

### Manual Testing Checklist

Before submitting a PR, verify:

- [ ] Works on mobile (iOS Safari, Android Chrome)
- [ ] Works on desktop (Chrome, Firefox, Safari)
- [ ] Keyboard navigation works
- [ ] Screen reader announces key actions
- [ ] No console errors
- [ ] Reconnection works after network loss
- [ ] Authentication flow works

### Running Tests (Future)

```bash
# Lint code
npm run lint

# Run tests
npm test

# Security audit
npm audit
```

---

## Pull Requests

### Before Submitting

1. Rebase on latest `main`
2. Squash commits if needed
3. Update documentation if applicable
4. Add screenshots for UI changes

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe how you tested this change

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] No console errors
- [ ] Accessibility maintained
- [ ] Documentation updated
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add voice input support
fix: resolve CDP connection timeout
docs: update setup instructions
refactor: improve state management
test: add unit tests for auth
chore: update dependencies
```

### Examples

✅ Good:
```
fix: prevent memory leak in WebSocket handler
feat: add high contrast mode support
refactor: extract capture logic to separate module
```

❌ Bad:
```
fixed stuff
updated code
minor changes
```

---

## Questions?

Open an issue for questions or discussions. We're happy to help!

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
