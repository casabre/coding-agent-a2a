import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpTaskManager } from './task-manager.js';
import type { CodingAgentAdapter } from '../adapters/base.js';
import type { Workspace } from '../context/workspace.js';
import { augmentTaskPrompt } from '../context/augment.js';

export function registerTools(
  server: McpServer,
  adapter: CodingAgentAdapter,
  taskManager: McpTaskManager,
  workspace?: Workspace,
): void {
  server.registerTool(
    'coding_agent_run',
    {
      description:
        'Submit a coding task to the active CLI agent (cursor, claude-code). ' +
        'Returns a job_id immediately. Use coding_agent_poll to check progress.',
      inputSchema: {
        task: z.string().describe('The coding task prompt'),
        repoPath: z.string().optional().describe('Absolute path to the repo (default: AGENT_REPO_PATH env)'),
        model: z.string().optional().describe('Model override (optional)'),
        force: z.boolean().optional().describe('Allow file writes (default: true)'),
        profile: z.string().optional().describe('Routing profile override: COMPLEX | MID | ROUTINE (optional; classifier decides when omitted)'),
      },
    },
    async (args) => {
      // Workspace context is best-effort: on failure, degrade to the plain task.
      let task = args.task;
      if (workspace) {
        try {
          task = augmentTaskPrompt(args.task, await workspace.getContextPack(args.task));
        } catch (err) {
          console.warn(`[mcp] workspace context unavailable: ${(err as Error).message}`);
        }
      }
      // startJob failures (e.g. repo-path confinement) are real errors — surface them.
      let jobId: string;
      try {
        jobId = taskManager.startJob(task, {
          model: args.model,
          repoPath: args.repoPath,
          force: args.force,
          profile: args.profile,
        });
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ job_id: jobId }) }] };
    },
  );

  server.registerTool(
    'coding_agent_poll',
    {
      description:
        'Poll progress of a running coding task. ' +
        'Returns new events since sinceLine, current state, and done flag.',
      inputSchema: {
        jobId: z.string(),
        sinceLine: z.number().optional().describe('Line offset from last poll (default: 0)'),
      },
    },
    (args) => {
      const result = taskManager.pollJob(args.jobId, args.sinceLine ?? 0);
      if (result === null) {
        return { isError: true, content: [{ type: 'text', text: `Unknown job: ${args.jobId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'coding_agent_result',
    {
      description:
        'Retrieve the final result of a completed coding task. ' +
        'Returns summary, stats. Cleans up the job.',
      inputSchema: {
        jobId: z.string(),
      },
    },
    (args) => {
      const result = taskManager.getResult(args.jobId);
      if (result === null) {
        return { isError: true, content: [{ type: 'text', text: `Unknown job: ${args.jobId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'coding_agent_cancel',
    {
      description: 'Cancel a running coding task.',
      inputSchema: {
        jobId: z.string(),
      },
    },
    (args) => {
      const ok = taskManager.cancelJob(args.jobId);
      if (!ok) {
        return { isError: true, content: [{ type: 'text', text: `Unknown job: ${args.jobId}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true }) }] };
    },
  );

  server.registerTool(
    'coding_agent_info',
    {
      description: 'Return the active adapter name, capabilities, and server version.',
    },
    () => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              adapter: adapter.name,
              capabilities: adapter.capabilities,
              version: process.env['npm_package_version'] ?? '0.1.0',
            }),
          },
        ],
      };
    },
  );
}
