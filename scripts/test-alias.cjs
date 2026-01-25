const path = require('path');
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const resolvedPath = path.resolve(
      __dirname,
      '..',
      'dist-tests',
      'src',
      request.slice(2)
    );
    return originalResolveFilename.call(this, resolvedPath, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
