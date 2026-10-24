import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DependencyManifestResolver } from '../src/dependencies.js';

describe('External Frameworks & Dependencies Manifest (src/dependencies.ts)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `scp_deps_test_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts versions from package.json and matches referenced imports', () => {
    const pkg = {
      name: 'demo-app',
      dependencies: {
        zod: '^3.23.8',
        express: '^4.19.2',
        unrelated: '1.0.0',
      },
      devDependencies: {
        vitest: '^2.1.8',
      },
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg), 'utf-8');

    const code = [
      `import { z } from 'zod';\nimport express from 'express';`,
      `import { describe, it } from 'vitest';`,
    ];

    const resolver = new DependencyManifestResolver(tempDir);
    const active = resolver.resolveActiveDependencies(code);

    expect(active).toHaveLength(3);
    const names = active.map((a) => a.name);
    expect(names).toContain('zod');
    expect(names).toContain('express');
    expect(names).toContain('vitest');
    expect(names).not.toContain('unrelated');

    const formatted = DependencyManifestResolver.formatManifestSection(active);
    expect(formatted).toContain('## 📦 Active Frameworks & Dependencies');
    expect(formatted).toContain('- `zod`: `^3.23.8` (package.json)');
  });

  it('extracts versions from go.mod and Cargo.toml', () => {
    const goMod = `
module example.com/app

go 1.22

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgo.uber.org/zap v1.26.0
)
`;
    fs.writeFileSync(path.join(tempDir, 'go.mod'), goMod, 'utf-8');

    const resolver = new DependencyManifestResolver(tempDir);
    const manifest = resolver.loadWorkspaceManifest();

    expect(manifest.has('github.com/gin-gonic/gin')).toBe(true);
    expect(manifest.get('github.com/gin-gonic/gin')?.version).toBe('v1.9.1');
  });

  it('correctly resolves subpath imports and hyphenated Python packages', () => {
    const pkg = {
      dependencies: {
        '@google/genai': '^0.1.0',
        lodash: '^4.17.21',
      },
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg), 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'scikit-learn==1.4.0\n', 'utf-8');

    const code = [
      `import { GoogleGenAI } from '@google/genai/web';\nconst get = require('lodash/get');`,
      `import scikit_learn`,
    ];

    const resolver = new DependencyManifestResolver(tempDir);
    const active = resolver.resolveActiveDependencies(code);

    const names = active.map((a) => a.name);
    expect(names).toContain('@google/genai');
    expect(names).toContain('lodash');
    expect(names).toContain('scikit-learn');
  });
});
