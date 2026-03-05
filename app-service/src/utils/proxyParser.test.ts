import { parseProxyMatch } from './proxyParser';

describe('proxyParser', () => {
    const system = {
        members: [
            {
                id: 'm1',
                slug: 'alice',
                proxyTags: [{ prefix: 'a:', suffix: null }]
            },
            {
                id: 'm2',
                slug: 'bob',
                proxyTags: [{ prefix: '[', suffix: ']' }]
            }
        ],
        autoproxyId: null
    };

    it('should parse standard prefix matches', () => {
        const content = { body: 'a:Hello world' };
        const result = parseProxyMatch(content, system);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('alice');
        expect(result?.cleanBody).toBe('Hello world');
    });

    it('should parse prefix and suffix matches', () => {
        const content = { body: '[Hello bob]' };
        const result = parseProxyMatch(content, system);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('bob');
        expect(result?.cleanBody).toBe('Hello bob');
    });

    it('should strip Matrix reply fallbacks and match prefixes on the real text', () => {
        const content = {
            body: '> <@user:domain> Original message\n> More text\n\na:Reply text'
        };
        const result = parseProxyMatch(content, system);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('alice');
        
        // Ensure the fallback is re-attached to the cleaned body
        expect(result?.cleanBody).toBe('> <@user:domain> Original message\n> More text\n\nReply text');
    });

    it('should correctly process formatted_body with HTML replies', () => {
        const content = {
            body: '> <@user:domain> Original message\n\na:Reply text',
            format: 'org.matrix.custom.html',
            formatted_body: '<mx-reply><blockquote>Original HTML</blockquote></mx-reply>a:Reply text'
        };
        const result = parseProxyMatch(content, system);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('alice');
        expect(result?.cleanBody).toBe('> <@user:domain> Original message\n\nReply text');
        expect(result?.cleanFormattedBody).toBe('<mx-reply><blockquote>Original HTML</blockquote></mx-reply>Reply text');
    });

    it('should handle autoproxy correctly when enabled', () => {
        const autoSystem = { ...system, autoproxyId: 'm2' };
        const content = { body: 'Just a regular message without tags' };
        
        const result = parseProxyMatch(content, autoSystem);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('bob');
        expect(result?.cleanBody).toBe('Just a regular message without tags');
    });

    it('should correctly strip fallbacks even for autoproxied replies', () => {
        const autoSystem = { ...system, autoproxyId: 'm1' };
        const content = {
            body: '> <@user:domain> Original\n\nJust replying normally',
            formatted_body: '<mx-reply>...</mx-reply>Just replying normally'
        };
        
        const result = parseProxyMatch(content, autoSystem);
        expect(result).toBeDefined();
        expect(result?.targetMember.slug).toBe('alice');
        // Because it's autoproxied, there's no tag to strip, so the body remains identical
        expect(result?.cleanBody).toBe('> <@user:domain> Original\n\nJust replying normally');
        expect(result?.cleanFormattedBody).toBe('<mx-reply>...</mx-reply>Just replying normally');
    });

    it('should bypass autoproxy if backslash is used', () => {
        const autoSystem = { ...system, autoproxyId: 'm1' };
        const content = { body: '\\Just escaping' };
        const result = parseProxyMatch(content, autoSystem);
        expect(result).toBeNull();
    });

    it('should return null for unmatched tags', () => {
        const content = { body: 'c:Unmatched tag' };
        const result = parseProxyMatch(content, system);
        expect(result).toBeNull();
    });
});
