import fs from 'node:fs';
import path from 'node:path';

export interface DependencyManifestEntry {
  name: string;
  version: string;
  source:
    | 'package.json'
    | 'go.mod'
    | 'Cargo.toml'
    | 'requirements.txt'
    | '.csproj'
    | 'pom.xml'
    | 'build.gradle'
    | 'composer.json'
    | 'pubspec.yaml'
    | 'Package.swift'
    | 'Gemfile'
    | 'CMakeLists.txt';
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
   * Scans workspace manifest files across 16 supported languages.
   */
  public loadWorkspaceManifest(): Map<string, DependencyManifestEntry> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    const map = new Map<string, DependencyManifestEntry>();

    // 1. package.json (Node/TS/JS)
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

    // 2. go.mod (Go)
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

    // 3. Cargo.toml (Rust)
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

    // 4. requirements.txt (Python)
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

    // 5. *.csproj (C# / .NET)
    try {
      const files = fs.readdirSync(this.workspaceRoot);
      const csprojFile = files.find((f) => f.endsWith('.csproj'));
      if (csprojFile) {
        const content = fs.readFileSync(path.join(this.workspaceRoot, csprojFile), 'utf-8');
        const pkgRefRegex = /<PackageReference\s+Include=["']([^"']+)["'](?:\s+Version=["']([^"']+)["'])?/gi;
        let m: RegExpExecArray | null;
        while ((m = pkgRefRegex.exec(content)) !== null) {
          const name = m[1]!;
          const version = m[2] || 'latest';
          map.set(name.toLowerCase(), { name, version, source: '.csproj' });
        }
      }
    } catch {
      // ignore
    }

    // 6. pom.xml (Java / Maven)
    const pomPath = path.join(this.workspaceRoot, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      try {
        const content = fs.readFileSync(pomPath, 'utf-8');
        const depRegex = /<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>(?:[\s\S]*?<version>([^<]+)<\/version>)?[\s\S]*?<\/dependency>/gi;
        let m: RegExpExecArray | null;
        while ((m = depRegex.exec(content)) !== null) {
          const name = m[1]!.trim();
          const version = (m[2] || 'latest').trim();
          map.set(name.toLowerCase(), { name, version, source: 'pom.xml' });
        }
      } catch {
        // ignore
      }
    }

    // 7. build.gradle / build.gradle.kts (Java / Kotlin / Android)
    const gradleFiles = ['build.gradle', 'build.gradle.kts'];
    for (const gFile of gradleFiles) {
      const gPath = path.join(this.workspaceRoot, gFile);
      if (fs.existsSync(gPath)) {
        try {
          const content = fs.readFileSync(gPath, 'utf-8');
          const depRegex = /\b(?:implementation|api|compileOnly)\s*\(?['"]([^:'"]+):([^:'"]+):([^'"]+)['"]\)?/g;
          let m: RegExpExecArray | null;
          while ((m = depRegex.exec(content)) !== null) {
            const name = m[2]!;
            const version = m[3]!;
            map.set(name.toLowerCase(), { name, version, source: 'build.gradle' });
          }
        } catch {
          // ignore
        }
      }
    }

    // 8. composer.json (PHP)
    const composerPath = path.join(this.workspaceRoot, 'composer.json');
    if (fs.existsSync(composerPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
        const allDeps = { ...(parsed.require || {}), ...(parsed['require-dev'] || {}) };
        for (const [name, version] of Object.entries(allDeps)) {
          if (typeof version === 'string' && name !== 'php') {
            map.set(name.toLowerCase(), { name, version, source: 'composer.json' });
          }
        }
      } catch {
        // ignore
      }
    }

    // 9. pubspec.yaml (Dart / Flutter)
    const pubspecPath = path.join(this.workspaceRoot, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      try {
        const content = fs.readFileSync(pubspecPath, 'utf-8');
        const lines = content.split('\n');
        let inDeps = false;
        for (const line of lines) {
          if (/^(?:dependencies|dev_dependencies):/.test(line)) {
            inDeps = true;
            continue;
          }
          if (/^[a-zA-Z0-9_-]+:/.test(line)) {
            inDeps = false;
          }
          if (inDeps) {
            const m = line.match(/^\s+([a-zA-Z0-9_-]+):\s*([^\s#]+)/);
            if (m && m[1] && m[2] && m[1] !== 'flutter' && m[1] !== 'sdk') {
              map.set(m[1].toLowerCase(), { name: m[1], version: m[2], source: 'pubspec.yaml' });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 10. Package.swift (Swift)
    const swiftPkgPath = path.join(this.workspaceRoot, 'Package.swift');
    if (fs.existsSync(swiftPkgPath)) {
      try {
        const content = fs.readFileSync(swiftPkgPath, 'utf-8');
        const pkgRegex = /\.package\s*\(\s*(?:url:\s*["'][^"']*\/([^/"']+?)(?:\.git)?["']|name:\s*["']([^"']+)["'])\s*,\s*(?:from:\s*["']([^"']+)["']|exact:\s*["']([^"']+)["'])/g;
        let m: RegExpExecArray | null;
        while ((m = pkgRegex.exec(content)) !== null) {
          const name = m[1] || m[2];
          const version = m[3] || m[4] || 'latest';
          if (name) {
            map.set(name.toLowerCase(), { name, version, source: 'Package.swift' });
          }
        }
      } catch {
        // ignore
      }
    }

    // 11. Gemfile (Ruby)
    const gemfilePath = path.join(this.workspaceRoot, 'Gemfile');
    if (fs.existsSync(gemfilePath)) {
      try {
        const content = fs.readFileSync(gemfilePath, 'utf-8');
        const gemRegex = /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm;
        let m: RegExpExecArray | null;
        while ((m = gemRegex.exec(content)) !== null) {
          const name = m[1]!;
          const version = m[2] || 'latest';
          map.set(name.toLowerCase(), { name, version, source: 'Gemfile' });
        }
      } catch {
        // ignore
      }
    }

    // 12. CMakeLists.txt (C / C++)
    const cmakePath = path.join(this.workspaceRoot, 'CMakeLists.txt');
    if (fs.existsSync(cmakePath)) {
      try {
        const content = fs.readFileSync(cmakePath, 'utf-8');
        const cmakeRegex = /find_package\s*\(\s*([a-zA-Z0-9_-]+)(?:\s+([0-9.]+))?/gi;
        let m: RegExpExecArray | null;
        while ((m = cmakeRegex.exec(content)) !== null) {
          const name = m[1]!;
          const version = m[2] || 'latest';
          map.set(name.toLowerCase(), { name, version, source: 'CMakeLists.txt' });
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
      const jsImports = code.matchAll(/(?:from\s+['"]|import\s*\(?['"]|require\s*\(\s*['"])(@[a-zA-Z0-9-_/]+|[a-zA-Z0-9-_/]+)/g);
      for (const m of jsImports) {
        const rawPkg = m[1]!.toLowerCase();
        let basePkg = rawPkg;
        if (basePkg.startsWith('@')) {
          const parts = basePkg.split('/');
          if (parts.length >= 2) {
            basePkg = `${parts[0]}/${parts[1]}`;
          }
        } else {
          basePkg = basePkg.split('/')[0]!;
        }

        if (manifest.has(basePkg)) {
          const entry = manifest.get(basePkg)!;
          matched.set(entry.name, entry);
        } else if (manifest.has(rawPkg)) {
          const entry = manifest.get(rawPkg)!;
          matched.set(entry.name, entry);
        }
      }

      // Match Python imports: import foo, from foo import
      const pyImports = code.matchAll(/(?:import\s+|from\s+)([a-zA-Z0-9_]+)/g);
      for (const m of pyImports) {
        const pkgName = m[1]!.toLowerCase();
        const hyphenated = pkgName.replace(/_/g, '-');
        if (manifest.has(pkgName)) {
          const entry = manifest.get(pkgName)!;
          matched.set(entry.name, entry);
        } else if (manifest.has(hyphenated)) {
          const entry = manifest.get(hyphenated)!;
          matched.set(entry.name, entry);
        }
      }

      // Match Go / Rust / PHP / C# / Java / Dart / Swift / Ruby / C++
      const polyglotTokens = code.matchAll(/(?:use\s+|import\s+|using\s+|require\s+|gem\s+|#include\s+<?|package:)([a-zA-Z0-9_\-./\\]+)/g);
      for (const m of polyglotTokens) {
        const raw = m[1]!.toLowerCase().replace(/\\/g, '/');
        const firstSegment = raw.split(/[/.]/)[0]!;
        const lastSegment = raw.split(/[/.]/).pop()!;

        if (manifest.has(raw)) {
          const entry = manifest.get(raw)!;
          matched.set(entry.name, entry);
        } else if (manifest.has(firstSegment)) {
          const entry = manifest.get(firstSegment)!;
          matched.set(entry.name, entry);
        } else if (manifest.has(lastSegment)) {
          const entry = manifest.get(lastSegment)!;
          matched.set(entry.name, entry);
        } else {
          // Check if any package has vendor prefix, e.g. "guzzlehttp/guzzle" matching "guzzlehttp"
          for (const [key, entry] of manifest.entries()) {
            if (key.startsWith(firstSegment + '/') || key.endsWith('/' + firstSegment)) {
              matched.set(entry.name, entry);
            }
          }
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
