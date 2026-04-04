import { parseCommand } from './commandParser';

describe('commandParser', () => {
  it('should parse standard commands', () => {
    expect(parseCommand('pk;list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
  });

  it('should parse uppercase prefixes', () => {
    expect(parseCommand('Pk;list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
    expect(parseCommand('PK;list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
  });

  it('should parse optional bot mentions', () => {
    expect(parseCommand('@plural_bot:localhost pk;list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
      botMention: '@plural_bot:localhost',
    });
    expect(parseCommand('@plural_bot:localhost Pk; list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
      botMention: '@plural_bot:localhost',
    });
    expect(
      parseCommand(
        '@plural_bot:localhost pk;list',
        '<a href="https://matrix.to/#/@plural_bot:localhost">plural_bot</a> @plural_bot:localhost pk;list',
      ),
    ).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
      cleanFormattedBody: '',
      botMention: '@plural_bot:localhost',
    });
  });

  it('should parse commands with a trailing space after the semicolon', () => {
    expect(parseCommand('pk; list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
    expect(parseCommand('Pk; list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
    expect(parseCommand('pk;   list')).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
  });

  it('should parse commands with arguments', () => {
    expect(parseCommand('pk;link @bob:localhost')).toEqual({
      cmd: 'link',
      args: ['@bob:localhost'],
      parts: ['pk;link', '@bob:localhost'],
    });
    expect(parseCommand('Pk; link primary @bob:localhost')).toEqual({
      cmd: 'link',
      args: ['primary', '@bob:localhost'],
      parts: ['pk;link', 'primary', '@bob:localhost'],
    });
  });

  it('should parse commands with quoted arguments', () => {
    expect(parseCommand('pk;member "Craig Smith" rename "Craig Johnson"')).toEqual({
      cmd: 'member',
      args: ['Craig Smith', 'rename', 'Craig Johnson'],
      parts: ['pk;member', 'Craig Smith', 'rename', 'Craig Johnson'],
    });
    expect(parseCommand("pk;member 'John Doe' rename 'Johnny Doe'")).toEqual({
      cmd: 'member',
      args: ['John Doe', 'rename', 'Johnny Doe'],
      parts: ['pk;member', 'John Doe', 'rename', 'Johnny Doe'],
    });
  });

  it('should return null for non-commands', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('pk:list')).toBeNull(); // Wrong punctuation
    expect(parseCommand(' pk;list')).toBeNull(); // Leading space
  });

  it('should return null for empty commands', () => {
    expect(parseCommand('pk;')).toBeNull();
    expect(parseCommand('pk;   ')).toBeNull();
  });

  it('should correctly strip Matrix reply fallbacks from plain body', () => {
    const replyBody = '> <@alice:localhost> Hello\n> How are you?\n\npk;list';
    expect(parseCommand(replyBody)).toEqual({
      cmd: 'list',
      args: [],
      parts: ['pk;list'],
    });
  });

  it('should correctly strip Matrix reply fallbacks from formatted body', () => {
    const body = '> <@alice:localhost> Hello\n\npk;e *bold* text';
    const formattedBody =
      '<mx-reply><blockquote><a href="...">In reply to</a> Hello</blockquote></mx-reply>pk;e <em>bold</em> text';

    expect(parseCommand(body, formattedBody)).toEqual({
      cmd: 'e',
      args: ['*bold*', 'text'],
      parts: ['pk;e', '*bold*', 'text'],
      cleanFormattedBody: '<em>bold</em> text',
    });
  });

  it('should fallback to preserving the intact formatted body if regex match fails due to HTML tags', () => {
    const body = 'pk; e hello';
    // HTML is broken/unexpected so regex fails (the command 'e' is wrapped in italics).
    // Limitation: We take no action and leave the body intact to avoid risky partial slicing.
    const formattedBody = 'pk; <i>e</i> hello';

    expect(parseCommand(body, formattedBody)).toEqual({
      cmd: 'e',
      args: ['hello'],
      parts: ['pk;e', 'hello'],
      cleanFormattedBody: 'pk; <i>e</i> hello', // Leaves the entire body intact
    });
  });

  it('should preserve formatting when no match is found for fallback', () => {
    const body = 'pk;e hello';
    // Completely mangled formatted body that doesn't start with the prefix
    const formattedBody = '<i>unexpected</i> pk;e hello';

    expect(parseCommand(body, formattedBody)).toEqual({
      cmd: 'e',
      args: ['hello'],
      parts: ['pk;e', 'hello'],
      cleanFormattedBody: '<i>unexpected</i> pk;e hello',
    });
  });

  it('should parse colons after mentions', () => {
    expect(parseCommand('@plural_bot:localhost: pk;list')).toMatchObject({
      cmd: 'list',
      botMention: '@plural_bot:localhost',
    });
  });
});
