export interface MatrixHttpError extends Error {
  status?: number;
  httpStatus?: number;
  errcode?: string;
  body?: Record<string, unknown>;
}

/**
 * Type guard to safely check if an unknown error is a Matrix SDK HTTP error
 * containing status codes or specific matrix errcodes.
 */
export function isMatrixHttpError(error: unknown): error is MatrixHttpError {
  return (
    typeof error === 'object' && error !== null && ('status' in error || 'httpStatus' in error || 'errcode' in error)
  );
}
