import fs from 'node:fs';
import path from 'node:path';
import type { MemoryEntry, ProjectMemory, MemoryCategory, MemoryOutcome } from './types.js';

const MEMORY_VERSION = '1.0';

export interface WorkMemoryLessons {
  preferredSources: Array<{
    pattern: string;
    uses: number;
    score: number;
    content: string;
  }>;
  deadEnds: Array<{
    question: string;
    relatedNodes: string[];
    content: string;
  }>;
  corrections: Array<{
    pattern: string;
    correction: string;
    content: string;
  }>;
}

/**
 * Checks whether a relative file path matches a memory pattern (exact, glob, or folder prefix).
 */
export function matchesPattern(pattern: string, filePath: string): boolean {
  const normPattern = pattern.replace(/\\/g, '/').trim();
  const normPath = filePath.replace(/\\/g, '/').trim();

  // 1. Exact match
  if (normPattern === normPath) return true;

  // 2. Wildcard all
  if (normPattern === '*' || normPattern === '**') return true;

  // 3. Folder prefix (e.g. "src/auth/" or "src/auth/**")
  const prefix = normPattern.replace(/\/?\*{1,2}$/, '');
  if (prefix && (normPath === prefix || normPath.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))) {
    return true;
  }

  // 4. Extension match (e.g. "*.prisma" or "**/*.prisma" or "*.test.ts")
  if (normPattern.includes('*.')) {
    const starDotIndex = normPattern.indexOf('*.');
    const ext = normPattern.substring(starDotIndex + 1);
    if (normPath.endsWith(ext)) return true;
    return false;
  }

  // 5. Simple glob regex conversion
  try {
    const escaped = normPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(normPath);
  } catch {
    return false;
  }
}

/**
 * Persistent Project Memory Manager storing conventions and decisions in .scp/memory.json.
 */
export class ProjectMemoryManager {
  public static matchesPattern(filePathOrPattern: string, patternOrFilePath: string): boolean {
    return (
      matchesPattern(patternOrFilePath, filePathOrPattern) ||
      matchesPattern(filePathOrPattern, patternOrFilePath)
    );
  }

  private memoryFile: string;

  constructor(workspaceRoot = process.cwd()) {
    this.memoryFile = path.resolve(workspaceRoot, '.scp', 'memory.json');
  }

  /**
   * Loads all registered project memories from .scp/memory.json.
   */
  public load(): MemoryEntry[] {
    try {
      if (fs.existsSync(this.memoryFile)) {
        const raw = fs.readFileSync(this.memoryFile, 'utf-8');
        const parsed = JSON.parse(raw) as ProjectMemory;
        return Array.isArray(parsed.memories) ? parsed.memories : [];
      }
    } catch {
      // Return empty list on parse error
    }
    return [];
  }

  /**
   * Adds and persists a new memory entry, or updates corroboration counters for useful outcomes.
   */
  public add(
    entry: {
      pattern: string;
      content: string;
      category?: MemoryCategory;
      tags?: string[];
      outcome?: MemoryOutcome;
      relatedNodes?: string[];
      question?: string;
      correction?: string;
    }
  ): MemoryEntry {
    const memories = this.load();

    // If outcome === 'useful', check if a memory with the same pattern & outcome already exists to increment uses
    if (entry.outcome === 'useful') {
      const existing = memories.find(
        (m) => m.pattern === entry.pattern && m.outcome === 'useful'
      );
      if (existing) {
        existing.uses = (existing.uses || 1) + 1;
        existing.score = Number(Math.min(1.0, (existing.score || 0.7) + 0.05).toFixed(2));
        existing.content = entry.content.trim();
        if (entry.relatedNodes && entry.relatedNodes.length > 0) {
          existing.relatedNodes = Array.from(
            new Set([...(existing.relatedNodes || []), ...entry.relatedNodes])
          );
        }
        this.saveAll(memories);
        return existing;
      }
    }

    const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(7)}`;

    const newEntry: MemoryEntry = {
      id,
      pattern: entry.pattern,
      category: entry.category || 'architecture',
      content: entry.content.trim(),
      createdAt: new Date().toISOString(),
      tags: entry.tags,
      outcome: entry.outcome,
      uses: entry.outcome === 'useful' ? 1 : undefined,
      score: entry.outcome === 'useful' ? 0.8 : entry.outcome === 'dead_end' ? 0.0 : undefined,
      relatedNodes: entry.relatedNodes,
      question: entry.question,
      correction: entry.correction,
    };

    memories.push(newEntry);
    this.saveAll(memories);
    return newEntry;
  }

  /**
   * Aggregates self-improving work-memory lessons (preferred sources, known dead ends, and corrections).
   */
  public getWorkMemoryLessons(): WorkMemoryLessons {
    const memories = this.load();
    const preferredSources: WorkMemoryLessons['preferredSources'] = [];
    const deadEnds: WorkMemoryLessons['deadEnds'] = [];
    const corrections: WorkMemoryLessons['corrections'] = [];

    for (const m of memories) {
      if (m.outcome === 'useful') {
        preferredSources.push({
          pattern: m.pattern,
          uses: m.uses || 1,
          score: m.score ?? 0.8,
          content: m.content,
        });
      } else if (m.outcome === 'dead_end') {
        deadEnds.push({
          question: m.question || m.pattern,
          relatedNodes: m.relatedNodes || [],
          content: m.content,
        });
      } else if (m.outcome === 'corrected' && m.correction) {
        corrections.push({
          pattern: m.pattern,
          correction: m.correction,
          content: m.content,
        });
      }
    }

    preferredSources.sort((a, b) => b.uses - a.uses || b.score - a.score);
    return { preferredSources, deadEnds, corrections };
  }

  /**
   * Deletes a memory entry by ID.
   */
  public delete(id: string): boolean {
    const memories = this.load();
    const initialLength = memories.length;
    const filtered = memories.filter((m) => m.id !== id);

    if (filtered.length !== initialLength) {
      this.saveAll(filtered);
      return true;
    }
    return false;
  }

  /**
   * Queries memories by keyword, category, or file pattern.
   */
  public query(filter: { pattern?: string; query?: string; category?: string }): MemoryEntry[] {
    const memories = this.load();

    return memories.filter((m) => {
      if (filter.category && m.category !== filter.category) {
        return false;
      }
      if (filter.pattern && !matchesPattern(m.pattern, filter.pattern)) {
        return false;
      }
      if (filter.query) {
        const q = filter.query.toLowerCase();
        const matchesContent = m.content.toLowerCase().includes(q);
        const matchesTag = m.tags?.some((t) => t.toLowerCase().includes(q));
        const matchesPat = m.pattern.toLowerCase().includes(q);
        if (!matchesContent && !matchesTag && !matchesPat) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Finds all memories relevant to a list of target/dependency file paths.
   */
  public getRelevantMemories(filePaths: string[]): MemoryEntry[] {
    const memories = this.load();
    const matched = new Set<MemoryEntry>();

    for (const mem of memories) {
      for (const fp of filePaths) {
        if (matchesPattern(mem.pattern, fp)) {
          matched.add(mem);
          break;
        }
      }
    }

    return Array.from(matched);
  }

  /**
   * Writes the full memory list to disk.
   */
  private saveAll(memories: MemoryEntry[]): void {
    const dir = path.dirname(this.memoryFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload: ProjectMemory = {
      version: MEMORY_VERSION,
      memories,
    };

    fs.writeFileSync(this.memoryFile, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
