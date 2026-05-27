/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@invoice/ui', '@invoice/shared-types'],
  experimental: {
    // App Router is the default in Next 14
  },
};

module.exports = nextConfig;
