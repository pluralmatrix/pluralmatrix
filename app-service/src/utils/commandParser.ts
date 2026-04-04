export const COMMAND_PREFIX_PATTERN = /^(?:@([a-zA-Z0-9._=/-]+:[a-zA-Z0-9.-]+):?\s+)?pk;\s*/i;

export function parseCommand(
  body: string,
  formattedBody?: string,
): { cmd: string; args: string[]; parts: string[]; cleanFormattedBody?: string; botMention?: string } | null {
  let cleanBody = body;
  let cleanFormattedBody = formattedBody;

  // 1. Strip Matrix reply fallbacks
  const bodyFallbackMatch = cleanBody.match(/^(> [^\n]*\n)*\n/);
  if (bodyFallbackMatch) {
    cleanBody = cleanBody.slice(bodyFallbackMatch[0].length);
  }

  if (cleanFormattedBody) {
    const fFallbackMatch = cleanFormattedBody.match(/^<mx-reply>[\s\S]*?<\/mx-reply>/);
    if (fFallbackMatch) {
      cleanFormattedBody = cleanFormattedBody.slice(fFallbackMatch[0].length);
    }
  }

  // 2. Parse the command
  // Matches "pk;", "Pk;", "pk; ", etc.
  const match = cleanBody.match(COMMAND_PREFIX_PATTERN);
  if (!match) return null;

  const botMention = match[1] ? `@${match[1]}` : undefined;

  const commandBody = cleanBody.substring(match[0].length).trim();
  if (!commandBody) return null;

  const argsMatch = commandBody.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
  const args = argsMatch.map((arg) => {
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg.slice(1, -1);
    }
    return arg;
  });
  const cmd = args[0].toLowerCase();

  // Construct legacy "parts" array for backward compatibility with command handlers
  // e.g., ["pk;list", "arg1"]
  const parts = [`pk;${cmd}`, ...args.slice(1)];

  // 3. Strip command prefix from formatted body if present
  let finalFormattedBody: string | undefined = undefined;
  if (cleanFormattedBody) {
    // We only strip the prefix (which includes the optional mention) and the command name
    const commandPrefixRegex = new RegExp(
      `^(?:<a href="[^"]+">[^<]+<\\/a>:?\\s*)?(?:@[\\w.:-]+:?\\s+)?pk;\\s*${cmd}\\s*`,
      'i',
    );

    const formattedMatch = cleanFormattedBody.match(commandPrefixRegex);
    if (formattedMatch) {
      finalFormattedBody = cleanFormattedBody.slice(formattedMatch[0].length);
    } else {
      // Fallback
      finalFormattedBody = cleanFormattedBody;
    }
  }

  return { cmd, args: args.slice(1), parts, cleanFormattedBody: finalFormattedBody, botMention };
}
