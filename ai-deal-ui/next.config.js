const path = require("path");

const nextConfig = {
  experimental: {
    workerThreads: false,
  },
  // Silence the "multiple lockfiles" warning — root is the ai-deal-ui folder
  outputFileTracingRoot: path.join(__dirname, "../"),
};

module.exports = nextConfig;
