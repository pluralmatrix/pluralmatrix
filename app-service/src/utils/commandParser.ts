export const COMMAND_PREFIX_PATTERN = /^pk;\s*/i;

export function parseCommand(
  body: string,
  formattedBody?: string,
): { cmd: string; args: string[]; parts: string[]; cleanFormattedBody?: string } | null {
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
    // Build a dynamic regex that matches the exact prefix + the command itself to strip it from the HTML
    const prefixSource = COMMAND_PREFIX_PATTERN.source; // "^pk;\\s*"
    // We ensure we only strip the prefix and the command name, ignoring any trailing whitespace before the arguments
    const commandPrefixRegex = new RegExp(`${prefixSource}${cmd}\\s*`, 'i');

    const formattedMatch = cleanFormattedBody.match(commandPrefixRegex);
    if (formattedMatch) {
      finalFormattedBody = cleanFormattedBody.slice(formattedMatch[0].length);
    } else {
      // Fallback: If HTML tags interrupt the command structure (e.g. `<b>pk;</b>list`),
      // our regex won't match. Rather than attempting a risky partial slice that might
      // leave fragmented commands behind, we take no action and preserve the body intact.
      // limitation: The command invocation will be visible in the final formatted message.
      finalFormattedBody = cleanFormattedBody;
    }
  }

  return { cmd, args: args.slice(1), parts, cleanFormattedBody: finalFormattedBody };
}
