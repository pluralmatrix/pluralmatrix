module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/client/'],
  modulePathIgnorePatterns: ['/client/'],
  setupFilesAfterEnv: ['./jest.setup.ts']
};
