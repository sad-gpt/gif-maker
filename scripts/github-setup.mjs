import fs from 'node:fs';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const origin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:5173').origin;
const url = new URL('https://github.com/settings/apps/new');
for (const [key, value] of Object.entries({ name: 'gif-and-giggles-sad-gpt', description: 'Publish a cute GIF gallery into your own GitHub repository and GitHub Pages.', url: 'https://github.com/sad-gpt/gif-maker', 'callback_urls[]': `${origin}/api/auth/github/callback`, request_oauth_on_install: 'true', public: 'true', webhook_active: 'false', contents: 'write', administration: 'write', pages: 'write' })) url.searchParams.set(key, value);
console.log(`Create the GitHub App using this prefilled link:\n${url.href}\n\nCallback URL: ${origin}/api/auth/github/callback\n\nAfter creating the app, add its App ID, app slug, Client ID, and a generated Client Secret to .env. Keep user token expiration enabled. A private key is not required: this app uses GitHub App user access tokens. Restart npm run dev after changing .env. Do not paste secrets into chat.`);
