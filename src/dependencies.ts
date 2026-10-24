import fs from 'node:fs';
import path from 'node:path';

export interface DependencyManifestEntry {
  name: string;
  version: string;
  source: 'package.json' | 'go.mod' | 'Cargo.toml' | 'requirements.txt';
}

/**
 * Extracts and maps active third-party framework and library versions.
 */
export class DependencyManifestResolver {
  private workspaceRoot: string;
  private manifestCache: Map<string, DependencyManifestEntry> | null = null;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Scans workspace manifest files (package.json, go.mod, Cargo.toml, requirements.txt).
   */
  public loadWorkspaceManifest(): Map<string, DependencyManifestEntry> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    const map = new Map<string, DependencyManifestEntry>();

    // 1. package.json
    const pkgPath = path.join(this.workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
          ...(pkg.peerDependencies || {}),
        };
        for (const [name, version] of Object.entries(allDeps)) {
          if (typeof version === 'string') {
            map.set(name.toLowerCase(), { name, version, source: 'package.json' });
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // 2. go.mod
    const goModPath = path.join(this.workspaceRoot, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        const content = fs.readFileSync(goModPath, 'utf-8');
        const requireLines = content.matchAll(/^\s*([a-zA-Z0-9.\-_/]+)\s+([vV0-9.\-+a-zA-Z]+)/gm);
        for (const m of requireLines) {
          const name = m[1]!;
          const version = m[2]!;
          if (name !== 'module' && name !== 'go') {
            map.set(name.toLowerCase(), { name, version, source: 'go.mod' });
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Cargo.toml
    const cargoPath = path.join(this.workspaceRoot, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      try {
        const content = fs.readFileSync(cargoPath, 'utf-8');
        const inDeps = content.split(/\[(?:.*dependencies)\]/);
        if (inDeps.length > 1) {
          for (let i = 1; i < inDeps.length; i++) {
            const section = inDeps[i]!.split(/\[/)[0]!;
            const lines = section.split('\n');
            for (const line of lines) {
              const m = line.match(/^\s*([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]+)"|'([^']+)'|{[^}]*version\s*=\s*"([^"]+)")/);
              if (m) {
                const name = m[1]!;
                const version = m[2] || m[3] || m[4] || 'latest';
                map.set(name.toLowerCase(), { name, version, source: 'Cargo.toml' });
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 4. requirements.txt
    const reqPath = path.join(this.workspaceRoot, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        const content = fs.readFileSync(reqPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split(/(==|>=|<=|~=)/);
            if (parts.length >= 3) {
              const name = parts[0]!.trim();
              const version = (parts[1]! + parts[2]!).trim();
              map.set(name.toLowerCase(), { name, version, source: 'requirements.txt' });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    this.manifestCache = map;
    return map;
  }

  /**
   * Identifies which external packages are referenced inside source contents.
   */
  public resolveActiveDependencies(fileContents: string[]): DependencyManifestEntry[] {
    const manifest = this.loadWorkspaceManifest();
    if (manifest.size === 0) return [];

    const matched = new Map<string, DependencyManifestEntry>();

    for (const code of fileContents) {
      if (!code) continue;

      // Match JS/TS imports: from 'foo', require('foo')
      const jsImports = code.matchAll(/(?:from\s+['"]|import\s*\(?['"]|require\s*\(\s*['"])(@[a-zA-Z0-9-_/]+|[a-zA-Z0-9-_]+)/g);
      for (const m of jsImports) {
        const pkgName = m[1]!.toLowerCase();
        if (manifest.has(pkgName)) {
          const entry = manifest.get(pkgName)!;
          matched.set(entry.name, entry);
        }
      }

      // Match Python imports: import foo, from foo import
      const pyImports = code.matchAll(/(?:import\s+|from\s+)([a-zA-Z0-9_]+)/g);
      for (const m of pyImports) {
        const pkgName = m[1]!.toLowerCase();
        if (manifest.has(pkgName)) {
          const entry = manifest.get(pkgName)!;
          matched.set(entry.name, entry);
        }
      }

      // Match Go / Rust imports
      const goRustImports = code.matchAll(/(?:use\s+|import\s+['"]?)([a-zA-Z0-9_\-/]+)/g);
      for (const m of goRustImports) {
        const pkgName = m[1]!.toLowerCase();
        if (manifest.has(pkgName)) {
          const entry = manifest.get(pkgName)!;
          matched.set(entry.name, entry);
        }
      }
    }

    return Array.from(matched.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Formats the active dependencies into a clean Markdown header block.
   */
  public static formatManifestSection(entries: DependencyManifestEntry[]): string {
    if (!entries || entries.length === 0) return '';
    const lines = [
      '## 📦 Active Frameworks & Dependencies',
      '> Grounded in workspace manifests to prevent AI hallucination of incompatible or deprecated APIs.',
    ];
    for (const dep of entries) {
      lines.push(`- \`${dep.name}\`: \`${dep.version}\` (${dep.source})`);
    }
    return lines.join('\n');
  }
}
