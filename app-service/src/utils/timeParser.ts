export function parseTime(timeStr: string): Date | null {
  // 1. Try relative time parser
  // Matches expressions like: 5d, 2h, 30m, 1h30m, 2d12h
  const relativeMatch = timeStr.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (relativeMatch && relativeMatch[0]) {
    const days = parseInt(relativeMatch[1] || '0', 10);
    const hours = parseInt(relativeMatch[2] || '0', 10);
    const minutes = parseInt(relativeMatch[3] || '0', 10);
    const seconds = parseInt(relativeMatch[4] || '0', 10);

    const totalMs = (days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds) * 1000;
    if (totalMs > 0) {
      return new Date(Date.now() - totalMs);
    }
  }

  // 2. Try absolute time parser (native Date parsing)
  const timestamp = Date.parse(timeStr);
  if (!isNaN(timestamp)) {
    return new Date(timestamp);
  }

  return null;
}
