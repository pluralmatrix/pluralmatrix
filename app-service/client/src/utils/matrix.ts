/**
 * Converts a Matrix Content (mxc://) URI to a downloadable URL via our proxy.
 */
export const getAvatarUrl = (mxc: string | null | undefined): string | null => {
  if (!mxc || !mxc.startsWith('mxc://')) return null;

  // mxc://server/id -> /api/media/download/server/id
  const parts = mxc.replace('mxc://', '').split('/');
  if (parts.length < 2) return null;

  const [server, mediaId] = parts;
  return `/api/media/download/${server}/${mediaId}`;
};
