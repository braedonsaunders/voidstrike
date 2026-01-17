// Webpack require.context extension
// Extends NodeJS.Require (from @types/node) with webpack's context method

interface RequireContext {
  keys(): string[];
  <T>(id: string): T;
  resolve(id: string): string;
}

declare global {
  namespace NodeJS {
    interface Require {
      context(
        directory: string,
        useSubdirectories?: boolean,
        regExp?: RegExp
      ): RequireContext;
    }
  }
}

export {};
