import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DependencyAnalyzer } from '../src/analyzer.js';
import { extractExportedSymbols } from '../src/cache.js';
import { extractSkeleton } from '../src/filter.js';

describe('Polyglot Multi-Language AST Support: Go, Rust & Python', () => {
  const tmpDir = path.resolve('tests/fixtures/polyglot_test');

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, 'pkg/auth'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src/models'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts exported Go symbols and resolves Go imports with go.mod', async () => {
    // 1. go.mod
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module myapp\n\ngo 1.22\n', 'utf-8');

    // 2. pkg/auth/auth.go
    const authCode = `
package auth

type UserSession struct {
  UserID string
}

func ValidateSession(s *UserSession) bool {
  return s != nil
}
    `;
    fs.writeFileSync(path.join(tmpDir, 'pkg/auth/auth.go'), authCode, 'utf-8');

    // 3. main.go
    const mainCode = `
package main

import (
  "fmt"
  "myapp/pkg/auth"
)

func Main() {
  fmt.Println("Starting...")
}
    `;
    fs.writeFileSync(path.join(tmpDir, 'main.go'), mainCode, 'utf-8');

    // Verify symbol extraction
    const symbols = extractExportedSymbols(authCode, '.go');
    expect(symbols).toContain('UserSession');
    expect(symbols).toContain('ValidateSession');

    // Verify analyzer dependency resolution
    const analyzer = new DependencyAnalyzer({ cwd: tmpDir, maxDepth: 2, noCache: true });
    const graph = await analyzer.analyze(['main.go']);

    expect(graph.nodes.has('main.go')).toBe(true);
    const hasAuth = graph.nodes.has('pkg/auth/auth.go') || graph.nodes.has('pkg\\auth\\auth.go');
    expect(hasAuth).toBe(true);
  });

  it('extracts exported Rust symbols and resolves mod and crate use declarations', async () => {
    // 1. src/models/user.rs
    const userCode = `
pub struct User {
    pub id: u64,
}

pub fn create_user(id: u64) -> User {
    User { id }
}
    `;
    fs.writeFileSync(path.join(tmpDir, 'src/models/user.rs'), userCode, 'utf-8');

    // 2. src/models/mod.rs
    fs.writeFileSync(path.join(tmpDir, 'src/models/mod.rs'), 'pub mod user;\n', 'utf-8');

    // 3. src/main.rs
    const mainRust = `
mod models;
use crate::models::user::User;

fn main() {
    let u = User { id: 1 };
}
    `;
    fs.writeFileSync(path.join(tmpDir, 'src/main.rs'), mainRust, 'utf-8');

    // Verify symbol extraction
    const symbols = extractExportedSymbols(userCode, '.rs');
    expect(symbols).toContain('User');
    expect(symbols).toContain('create_user');

    // Verify analyzer dependency resolution
    const analyzer = new DependencyAnalyzer({ cwd: tmpDir, maxDepth: 2, noCache: true });
    const graph = await analyzer.analyze(['src/main.rs']);

    expect(graph.nodes.has('src/main.rs') || graph.nodes.has('src\\main.rs')).toBe(true);
    const hasModels = graph.nodes.has('src/models/mod.rs') || graph.nodes.has('src\\models\\mod.rs');
    expect(hasModels).toBe(true);
  });

  it('skeletonizes Go, Rust, and Python code bodies while preserving signatures', () => {
    const goCode = `func CalculateTotal(a int, b int) int {\n\treturn a + b\n}`;
    const goSkeleton = extractSkeleton(goCode, '.go');
    expect(goSkeleton).toContain('/* [Implementation omitted for token efficiency] */');

    const rustCode = `pub fn verify_token(token: &str) -> bool {\n    token.len() > 10\n}`;
    const rustSkeleton = extractSkeleton(rustCode, '.rs');
    expect(rustSkeleton).toContain('/* [Implementation omitted for token efficiency] */');

    const pyCode = `def process_data(items):\n    # do heavy processing\n    return [x * 2 for x in items]`;
    const pySkeleton = extractSkeleton(pyCode, '.py');
    expect(pySkeleton).toContain('pass  # [Implementation omitted for token efficiency]');
    expect(pySkeleton).not.toContain('return [x * 2 for x in items]');
  });
});
