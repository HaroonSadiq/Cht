/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async rewrites() {
    return [
      { source: '/privacy',              destination: '/privacy.html' },
      { source: '/terms',                destination: '/terms.html' },
      { source: '/data-deletion-status', destination: '/data-deletion-status.html' },
      { source: '/data-deletion',        destination: '/data-deletion-status.html' },
      { source: '/flow-builder',         destination: '/flow-builder.html' },
      { source: '/api/data-deletion',    destination: '/api/webhooks/meta' },
    ];
  },
};

export default nextConfig;
