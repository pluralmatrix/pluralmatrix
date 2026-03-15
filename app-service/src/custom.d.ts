declare global {
  namespace Express {
    export interface Request {
      user?: {
        mxid: string;
        [key: string]: unknown;
      };
    }
  }
}

export {};
