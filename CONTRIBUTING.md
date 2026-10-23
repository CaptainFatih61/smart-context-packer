# Contributing to `smart-context-packer`

Thank you for your interest in contributing to **`smart-context-packer`** (`scp`)! We welcome contributions of all kinds: bug fixes, new language analyzers, token optimization heuristics, documentation improvements, and feature requests.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **Git**

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/CaptainFatih61/smart-context-packer.git
cd smart-context-packer
npm install
```

### Common Commands
- **Run tests**:
  ```bash
  npm test
  ```
- **Run tests in watch mode**:
  ```bash
  npm run test:watch
  ```
- **Typecheck**:
  ```bash
  npm run typecheck
  ```
- **Build**:
  ```bash
  npm run build
  ```

---

## 🧪 Testing Guidelines

- Write clean, focused unit tests in the `tests/` directory for any new features or bug fixes.
- Ensure all tests pass (`npm test`) and typecheck passes with zero errors (`npm run typecheck`) before submitting a pull request.
- If adding support for a new language or framework, add a test fixture under `tests/fixtures/`.

---

## 📐 Architecture Principles

1. **Zero Native Compiler Dependencies**: The core package should run purely in Node.js without requiring native C++ build tools (`node-gyp`) or heavy binary blobs, ensuring cross-platform stability.
2. **Security by Default**: All sensitive tokens (API keys, connection strings, private keys) must be redacted before outputting prompts.
3. **Token Efficiency**: Respect context windows. Strive for maximum signal-to-noise ratio in AI prompts.
4. **Deterministic Output**: For identical input graphs, outputs should be structured, reproducible, and clean.

---

## 📝 Pull Request Workflow

1. Fork the repo and create your feature branch: `git checkout -b feature/my-cool-feature`.
2. Commit your changes with conventional commit messages: `git commit -m 'feat(analyzer): support python imports'`.
3. Push to your branch: `git push origin feature/my-cool-feature`.
4. Open a Pull Request on GitHub.

Thank you for helping make AI developer tooling better!
