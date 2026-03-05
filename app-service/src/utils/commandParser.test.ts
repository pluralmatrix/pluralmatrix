import { parseCommand } from './commandParser';

describe('commandParser', () => {
    it('should parse standard commands', () => {
        expect(parseCommand('pk;list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
    });

    it('should parse uppercase prefixes', () => {
        expect(parseCommand('Pk;list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
        expect(parseCommand('PK;list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
    });

    it('should parse commands with a trailing space after the semicolon', () => {
        expect(parseCommand('pk; list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
        expect(parseCommand('Pk; list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
        expect(parseCommand('pk;   list')).toEqual({
            cmd: 'list',
            args: [],
            parts: ['pk;list']
        });
    });

    it('should parse commands with arguments', () => {
        expect(parseCommand('pk;link @bob:localhost')).toEqual({
            cmd: 'link',
            args: ['@bob:localhost'],
            parts: ['pk;link', '@bob:localhost']
        });
        expect(parseCommand('Pk; link primary @bob:localhost')).toEqual({
            cmd: 'link',
            args: ['primary', '@bob:localhost'],
            parts: ['pk;link', 'primary', '@bob:localhost']
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
});
