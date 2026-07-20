import { describe, it, expect, afterEach } from 'vitest';
import { buildSpawnInvocation } from '../../src/cli-spawn.js';

const originalPlatform = process.platform;

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  delete process.env['ComSpec'];
});

describe('buildSpawnInvocation', () => {
  it('passes through Unix binaries unchanged', () => {
    mockPlatform('linux');
    expect(buildSpawnInvocation('/usr/bin/cursor-agent', ['--print', 'task'])).toEqual({
      command: '/usr/bin/cursor-agent',
      argv: ['--print', 'task'],
    });
  });

  it('passes through macOS binaries unchanged', () => {
    mockPlatform('darwin');
    expect(buildSpawnInvocation('/opt/homebrew/bin/claude', ['run'])).toEqual({
      command: '/opt/homebrew/bin/claude',
      argv: ['run'],
    });
  });

  it('wraps Windows .cmd scripts in the system shell', () => {
    mockPlatform('win32');
    process.env['ComSpec'] = 'C:\\Windows\\System32\\cmd.exe';
    const binary = 'C:\\Users\\me\\AppData\\Local\\cursor-agent\\cursor-agent.cmd';

    expect(buildSpawnInvocation(binary, ['--print', 'task'])).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      argv: ['/d', '/s', '/c', binary, '--print', 'task'],
    });
  });

  it('wraps Windows .bat scripts in the system shell', () => {
    mockPlatform('win32');
    const binary = 'C:\\tools\\agent.bat';

    expect(buildSpawnInvocation(binary, ['run'])).toEqual({
      command: 'cmd.exe',
      argv: ['/d', '/s', '/c', binary, 'run'],
    });
  });

  it('does not wrap bare command names on Windows', () => {
    mockPlatform('win32');
    expect(buildSpawnInvocation('cursor-agent', ['task'])).toEqual({
      command: 'cursor-agent',
      argv: ['task'],
    });
  });
});
