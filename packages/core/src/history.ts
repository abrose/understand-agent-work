import { Project } from 'ts-morph';
import * as path from 'path';
import * as crypto from 'crypto';
import type { GraphDB } from './builder.js';
import type { ParsedFile, CommitNode } from './types.js';
import { Parser } from './parser.js';

export interface GitBackend {
  log(opts: { maxCount: number }): Promise<{ all: GitCommit[] }>;
  raw(args: string[]): Promise<string>;
  show(args: string[]): Promise<string>;
}

export interface GitCommit {
  hash: string;
  message: string;
  author_name: string;
  date: string;
}

export class HistoryBuilder {
  constructor(
    private db: GraphDB,
    private rootDir: string
  ) {}

  async backfill(git: GitBackend, n: number): Promise<number> {
    const log = await git.log({ maxCount: n });
    let processedCount = 0;

    for (const commit of log.all) {
      const shortHash = commit.hash.substring(0, 7);
      console.log(`[history] Processing commit ${shortHash}: ${commit.message.substring(0, 60)}`);

      // Create the Commit node
      await this.db.query(
        `CREATE (c:Commit {
          hash: $hash,
          message: $message,
          author: $author,
          date: timestamp($date)
        })`,
        {
          hash: shortHash,
          message: commit.message,
          author: commit.author_name,
          date: new Date(commit.date).toISOString(),
        }
      );

      // Get the list of files at this commit
      const filesRaw = await git.raw(['ls-tree', '-r', '--name-only', commit.hash]);
      const sourceFiles = filesRaw
        .split('\n')
        .filter((f) => f.trim().length > 0)
        .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));

      // Parse each file from its content at that commit
      for (const filePath of sourceFiles) {
        try {
          const content = await git.show([`${commit.hash}:${filePath}`]);
          const contentHash = crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 12);

          // Create a SNAPSHOT edge from Commit to File (if File exists)
          // We link to File nodes that already exist in the current graph
          await this.db.query(
            `MATCH (c:Commit {hash: $hash}), (f:File {id: $fileId})
             CREATE (c)-[:SNAPSHOT {content_hash: $contentHash}]->(f)`,
            {
              hash: shortHash,
              fileId: filePath,
              contentHash,
            }
          );
        } catch {
          // File may not parse or may not exist in current graph — skip
        }
      }

      processedCount++;
    }

    return processedCount;
  }
}
