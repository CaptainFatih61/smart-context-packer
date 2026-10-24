import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyAnalyzer } from '../src/analyzer.js';
import { extractExportedSymbols } from '../src/cache.js';
import { extractSkeleton } from '../src/filter.js';
import { DependencyManifestResolver } from '../src/dependencies.js';

describe('Polyglot Expanded Engine (v2.3.0)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-polyglot-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('extracts exported symbols across C#, Java, Kotlin, C++, PHP, Dart, Swift, Ruby, and Svelte', () => {
    // C#
    const csCode = `
      public class OrderService { }
      public interface IRepository { }
      internal record UserRecord(string Name);
    `;
    expect(extractExportedSymbols(csCode, '.cs')).toEqual(['OrderService', 'IRepository', 'UserRecord']);

    // Java & Kotlin
    const javaCode = `
      public class PaymentGateway { }
      public interface Tokenizer { }
    `;
    expect(extractExportedSymbols(javaCode, '.java')).toEqual(['PaymentGateway', 'Tokenizer']);

    const ktCode = `
      class UserViewModel { }
      fun calculateHash() { }
    `;
    expect(extractExportedSymbols(ktCode, '.kt')).toEqual(['UserViewModel', 'calculateHash']);

    // C / C++
    const cppCode = `
      class EngineCore { };
      struct Matrix4x4 { };
    `;
    expect(extractExportedSymbols(cppCode, '.cpp')).toEqual(['EngineCore', 'Matrix4x4']);

    // PHP
    const phpCode = `
      class AuthController { }
      interface TokenSigner { }
    `;
    expect(extractExportedSymbols(phpCode, '.php')).toEqual(['AuthController', 'TokenSigner']);

    // Dart
    const dartCode = `
      class UserProfileWidget { }
      abstract class BaseBloc { }
    `;
    expect(extractExportedSymbols(dartCode, '.dart')).toEqual(['UserProfileWidget', 'BaseBloc']);

    // Swift
    const swiftCode = `
      public class NetworkClient { }
      struct ConfigPayload { }
    `;
    expect(extractExportedSymbols(swiftCode, '.swift')).toEqual(['NetworkClient', 'ConfigPayload']);

    // Ruby
    const rbCode = `
      class AccountManager
        def verify_credentials
        end
      end
    `;
    expect(extractExportedSymbols(rbCode, '.rb')).toEqual(['AccountManager', 'verify_credentials']);

    // Svelte
    const svelteCode = `
      <script lang="ts">
        export const appTitle = 'Context Packer';
        export function refreshData() {}
      </script>
      <h1>{appTitle}</h1>
    `;
    expect(extractExportedSymbols(svelteCode, '.svelte')).toEqual(['appTitle', 'refreshData']);
  });

  it('skeletonizes method bodies in Ruby and Svelte', () => {
    const rbCode = [
      'class Calculator',
      '  def add(a, b)',
      '    result = a + b',
      '    return result',
      '  end',
      'end',
    ].join('\n');

    const rbSkel = extractSkeleton(rbCode, '.rb');
    expect(rbSkel).toContain('# [Implementation omitted for token efficiency]');
    expect(rbSkel).not.toContain('result = a + b');

    const svelteCode = [
      '<script>',
      '  export function computeTotal() {',
      '    const heavyCalc = 100 * 200;',
      '    return heavyCalc;',
      '  }',
      '</script>',
      '<template><div>Some complex UI</div></template>',
      '<style>.box { color: red; }</style>',
    ].join('\n');

    const svelteSkel = extractSkeleton(svelteCode, '.svelte');
    expect(svelteSkel).toContain('/* [Implementation omitted for token efficiency] */');
    expect(svelteSkel).not.toContain('heavyCalc');
  });

  it('parses and resolves dependencies for C#, PHP, Dart, and C++', async () => {
    // 1. C# files
    const csService = path.join(tmpDir, 'OrderService.cs');
    const csRepo = path.join(tmpDir, 'OrderRepository.cs');
    fs.writeFileSync(csRepo, 'public class OrderRepository {}');
    fs.writeFileSync(
      csService,
      'using System;\nusing OrderRepository;\npublic class OrderService {}'
    );

    const analyzer = new DependencyAnalyzer({ cwd: tmpDir, depth: 2, noCache: true });
    const graph = await analyzer.analyze(['OrderService.cs']);
    expect(graph.nodes.has('OrderRepository.cs')).toBe(true);

    // 2. PHP files
    const phpUser = path.join(tmpDir, 'User.php');
    const phpDb = path.join(tmpDir, 'Database.php');
    fs.writeFileSync(phpDb, '<?php class Database {}');
    fs.writeFileSync(
      phpUser,
      '<?php\nrequire_once "Database.php";\nclass User {}'
    );
    const phpGraph = await analyzer.analyze(['User.php']);
    expect(phpGraph.nodes.has('Database.php')).toBe(true);

    // 3. Dart files
    const dartLib = path.join(tmpDir, 'lib');
    fs.mkdirSync(dartLib, { recursive: true });
    const dartMain = path.join(dartLib, 'main.dart');
    const dartHelper = path.join(dartLib, 'helper.dart');
    fs.writeFileSync(dartHelper, 'class Helper {}');
    fs.writeFileSync(dartMain, "import 'helper.dart';\nvoid main() {}");

    const dartGraph = await analyzer.analyze(['lib/main.dart']);
    expect(dartGraph.nodes.has('lib/helper.dart')).toBe(true);

    // 4. C++ files
    const cppHeader = path.join(tmpDir, 'math_utils.h');
    const cppSource = path.join(tmpDir, 'main.cpp');
    fs.writeFileSync(cppHeader, '#pragma once\nint square(int x);');
    fs.writeFileSync(cppSource, '#include "math_utils.h"\nint main() { return 0; }');

    const cppGraph = await analyzer.analyze(['main.cpp']);
    expect(cppGraph.nodes.has('math_utils.h')).toBe(true);
  });

  it('scans and resolves polyglot workspace manifests (.csproj, composer.json, pubspec.yaml)', () => {
    // Write .csproj
    fs.writeFileSync(
      path.join(tmpDir, 'MyProject.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk">
        <ItemGroup>
          <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
        </ItemGroup>
      </Project>`
    );

    // Write composer.json
    fs.writeFileSync(
      path.join(tmpDir, 'composer.json'),
      JSON.stringify({
        require: {
          'guzzlehttp/guzzle': '^7.8',
        },
      })
    );

    // Write pubspec.yaml
    fs.writeFileSync(
      path.join(tmpDir, 'pubspec.yaml'),
      `name: test_app
dependencies:
  dio: ^5.4.0
`
    );

    const resolver = new DependencyManifestResolver(tmpDir);
    const manifest = resolver.loadWorkspaceManifest();

    expect(manifest.has('newtonsoft.json')).toBe(true);
    expect(manifest.get('newtonsoft.json')?.version).toBe('13.0.3');
    expect(manifest.get('newtonsoft.json')?.source).toBe('.csproj');

    expect(manifest.has('guzzlehttp/guzzle')).toBe(true);
    expect(manifest.get('guzzlehttp/guzzle')?.source).toBe('composer.json');

    expect(manifest.has('dio')).toBe(true);
    expect(manifest.get('dio')?.source).toBe('pubspec.yaml');

    // Test active resolution
    const active = resolver.resolveActiveDependencies([
      'using Newtonsoft.Json;\nclass Program {}',
      'use GuzzleHttp\\Client;\n$client = new Client();',
      "import 'package:dio/dio.dart';",
    ]);

    expect(active.map((a) => a.name)).toEqual(['dio', 'guzzlehttp/guzzle', 'Newtonsoft.Json']);
  });
});
