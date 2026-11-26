function appwriteOrigin(value) {
  const error = () => new Error('APPWRITE_API_ORIGIN must be a bare HTTPS Appwrite function domain origin.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw error();
  }
  if (url.protocol !== 'https:' || url.port || (value !== url.origin && value !== url.origin + '/')) {
    throw error();
  }
  return url.origin;
}

const origin = appwriteOrigin(process.env.APPWRITE_API_ORIGIN);
const sharePath = '/league-manager/share/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const shareHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};
const browserMethods = ['GET', 'HEAD'];

export const config = {
  framework: 'vite',
  buildCommand: 'npm exec -- vite build --config vite.vercel.config.mjs',
  outputDirectory: 'dist',
  // Capture the complete path so Django receives the original trailing slash.
  routes: [
    { src: '^(/api(?:/.*)?)$', dest: origin + '$1', caseSensitive: true },
    { src: '^/console/?$', methods: browserMethods, status: 302, headers: { Location: '/' } },
    { src: '^/league-manager$', methods: browserMethods, status: 308, headers: { Location: '/league-manager/' } },
    { src: '^(' + sharePath + ')$', methods: browserMethods, status: 308, headers: { ...shareHeaders, Location: '$1/' } },
    { src: '^' + sharePath + '/$', methods: browserMethods, dest: '/index.html', headers: shareHeaders },
    { src: '^/(?:league-manager/)?$', methods: browserMethods, dest: '/index.html' },
  ],
};
