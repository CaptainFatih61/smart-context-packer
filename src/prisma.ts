import fs from 'node:fs';
import path from 'node:path';

export interface PrismaModel {
  name: string;
  block: string;
  relations: string[];
  enums: string[];
}

export interface PrismaEnum {
  name: string;
  block: string;
}

export interface ParsedPrisma {
  datasources: string[];
  generators: string[];
  models: Map<string, PrismaModel>;
  enums: Map<string, PrismaEnum>;
}

const PRISMA_SCALARS = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
  'Unsupported',
]);

/**
 * Locates schema.prisma within the workspace.
 */
export function locatePrismaSchema(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'prisma', 'schema.prisma'),
    path.join(cwd, 'schema.prisma'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parses a Prisma schema into models, enums, datasources, and generators.
 */
export function parsePrismaSchema(schemaContent: string): ParsedPrisma {
  const datasources: string[] = [];
  const generators: string[] = [];
  const models = new Map<string, PrismaModel>();
  const enums = new Map<string, PrismaEnum>();

  // Extract blocks: model, enum, datasource, generator
  const blockRegex = /\b(model|enum|datasource|generator)\s+([a-zA-Z0-9_]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(schemaContent)) !== null) {
    const type = match[1]!;
    const name = match[2]!;
    const body = match[3]!;
    const fullBlock = match[0]!;

    if (type === 'datasource') {
      datasources.push(fullBlock);
    } else if (type === 'generator') {
      generators.push(fullBlock);
    } else if (type === 'enum') {
      enums.set(name, { name, block: fullBlock });
    } else if (type === 'model') {
      // Analyze fields to detect related models and enums
      const relations: string[] = [];
      const usedEnums: string[] = [];

      const lines = body.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
        const tokens = trimmed.split(/\s+/);
        if (tokens.length >= 2) {
          let fieldType = tokens[1]!;
          // Clean field type: strip ?, [], and attributes
          fieldType = fieldType.replace(/[?\[\]]/g, '');

          if (!PRISMA_SCALARS.has(fieldType)) {
            relations.push(fieldType);
          }
        }
      }

      models.set(name, {
        name,
        block: fullBlock,
        relations,
        enums: usedEnums,
      });
    }
  }

  return { datasources, generators, models, enums };
}

/**
 * Detects referenced Prisma models and whether Prisma is used.
 */
export function findPrismaReferences(
  codeContents: string[],
  availableModels: string[]
): { hasPrisma: boolean; referencedModels: Set<string> } {
  const referencedModels = new Set<string>();
  let hasPrisma = false;

  const modelLookup = new Map<string, string>();
  for (const m of availableModels) {
    modelLookup.set(m.toLowerCase(), m);
  }

  for (const code of codeContents) {
    if (!code) continue;

    if (code.includes('@prisma/client') || code.includes('PrismaClient') || /\bprisma\./.test(code)) {
      hasPrisma = true;
    }

    // 1. Detect prisma.<model> (e.g. prisma.user.findUnique -> 'User')
    const prismaCallRegex = /\bprisma\.([a-zA-Z0-9_]+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = prismaCallRegex.exec(code)) !== null) {
      const prop = match[1]!;
      const matchedModel = modelLookup.get(prop.toLowerCase());
      if (matchedModel) {
        referencedModels.add(matchedModel);
      }
    }

    // 2. Detect type imports from @prisma/client (e.g. import { User, Post } from '@prisma/client')
    const importRegex =
      /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]@prisma\/client['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      const symbols = match[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!);
      for (const sym of symbols) {
        const matchedModel = modelLookup.get(sym.toLowerCase());
        if (matchedModel) {
          referencedModels.add(matchedModel);
        }
      }
    }

    // 3. Detect type annotations e.g. User, User[]
    for (const [, actual] of modelLookup) {
      const typeRegex = new RegExp(`\\b${actual}\\b`);
      if (typeRegex.test(code)) {
        referencedModels.add(actual);
      }
    }
  }

  return { hasPrisma, referencedModels };
}

/**
 * Extracts a minimal subset of schema.prisma containing referenced models,
 * direct 1-level relations, and used enums.
 */
export function extractRelevantPrismaSchema(
  schemaContent: string,
  codeContents: string[]
): string | null {
  const parsed = parsePrismaSchema(schemaContent);
  if (parsed.models.size === 0) {
    return null;
  }

  const availableModelNames = Array.from(parsed.models.keys());
  const { hasPrisma, referencedModels } = findPrismaReferences(codeContents, availableModelNames);

  if (!hasPrisma || referencedModels.size === 0) {
    return null;
  }

  // Collect primary models + 1-level relations
  const selectedModels = new Set<string>();
  const selectedEnums = new Set<string>();

  for (const modelName of referencedModels) {
    const model = parsed.models.get(modelName);
    if (!model) continue;

    selectedModels.add(modelName);

    // Add 1-level relations
    for (const rel of model.relations) {
      if (parsed.models.has(rel)) {
        selectedModels.add(rel);
      } else if (parsed.enums.has(rel)) {
        selectedEnums.add(rel);
      }
    }
  }

  // Also check if any other model points to selected models (bidirectional relation)
  for (const [name, model] of parsed.models) {
    if (selectedModels.has(name)) continue;
    for (const rel of model.relations) {
      if (referencedModels.has(rel)) {
        selectedModels.add(name);
        break;
      }
    }
  }

  // Check enums used in any of the selected models
  for (const modelName of selectedModels) {
    const model = parsed.models.get(modelName);
    if (!model) continue;
    for (const rel of model.relations) {
      if (parsed.enums.has(rel)) {
        selectedEnums.add(rel);
      }
    }
  }

  const output: string[] = [];
  output.push('// [smart-context-packer] Extracted Prisma Models & Relations (Subset)');
  output.push('// Generated automatically to prevent database schema hallucinations.\n');

  if (parsed.datasources.length > 0) {
    output.push(parsed.datasources[0]!);
    output.push('');
  }

  // Output sorted models
  const sortedModels = Array.from(selectedModels).sort();
  for (const mName of sortedModels) {
    const m = parsed.models.get(mName);
    if (m) {
      output.push(m.block);
      output.push('');
    }
  }

  // Output enums
  const sortedEnums = Array.from(selectedEnums).sort();
  for (const eName of sortedEnums) {
    const e = parsed.enums.get(eName);
    if (e) {
      output.push(e.block);
      output.push('');
    }
  }

  return output.join('\n').trimEnd();
}
