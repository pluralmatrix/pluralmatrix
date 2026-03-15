import { parseTime } from './timeParser';

describe('timeParser', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('should parse relative times correctly', () => {
    // 1h
    let res = parseTime('1h');
    expect(res).not.toBeNull();
    expect(res!.toISOString()).toBe('2026-03-15T11:00:00.000Z');

    // 1d12h30m15s
    res = parseTime('1d12h30m15s');
    expect(res).not.toBeNull();
    // 1d = 24h, 12h = 12h -> 36 hours total -> 2026-03-13T23:29:45.000Z
    expect(res!.toISOString()).toBe('2026-03-13T23:29:45.000Z');

    // Just minutes
    res = parseTime('45m');
    expect(res).not.toBeNull();
    expect(res!.toISOString()).toBe('2026-03-15T11:15:00.000Z');
  });

  it('should parse absolute times', () => {
    const res = parseTime('2026-03-14T10:00:00.000Z');
    expect(res).not.toBeNull();
    expect(res!.toISOString()).toBe('2026-03-14T10:00:00.000Z');
  });

  it('should return null for invalid inputs', () => {
    expect(parseTime('invalid')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});
