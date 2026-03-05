export function parseCommand(body: string): { cmd: string, args: string[], parts: string[] } | null {
    // Matches "pk;", "Pk;", "pk; ", etc.
    const match = body.match(/^pk;\s*/i);
    if (!match) return null;
    
    const commandBody = body.substring(match[0].length).trim();
    if (!commandBody) return null;

    const args = commandBody.split(/\s+/);
    const cmd = args[0].toLowerCase();
    
    // Construct legacy "parts" array for backward compatibility with command handlers
    // e.g., ["pk;list", "arg1"]
    const parts = [`pk;${cmd}`, ...args.slice(1)];
    
    return { cmd, args: args.slice(1), parts };
}
