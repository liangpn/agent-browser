const ALLOWED_SUBCOMMANDS = [
  'open',
  'snapshot',
  'click',
  'dblclick',
  'fill',
  'type',
  'press',
  'wait',
  'screenshot',
  'pdf',
  'close',
  'get-title',
  'get-url',
  'back',
  'forward',
  'reload',
];

const BLOCKED_SUBCOMMANDS = [
  'eval',
  'evaluate',
  'upload',
  'download',
  'route',
  'unroute',
];

export function validateCommand(command) {
  if (!command.match(/^agent-browser\b/)) {
    throw new Error('仅允许 agent-browser 命令');
  }

  const match = command.match(/^agent-browser\s+(\S+)/);
  if (match) {
    const subCmd = match[1];
    if (BLOCKED_SUBCOMMANDS.includes(subCmd)) {
      throw new Error(`禁止使用子命令: ${subCmd}`);
    }
    if (!ALLOWED_SUBCOMMANDS.includes(subCmd)) {
      throw new Error(`未知子命令: ${subCmd}`);
    }
  }

  if (!command.includes('--cdp')) {
    return command.replace(/^agent-browser/, 'agent-browser --cdp 9222');
  }

  return command;
}
