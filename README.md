# gif & giggles

A cute GIF gallery maker for your group chat, built with Next.js, React and TypeScript.

## Run locally

Use Node.js 24 (also pinned for Vercel):

```sh
npm install
npm run setup:local
npm run dev
```

Open http://127.0.0.1:5173. One Next.js process serves the editor and authentication routes. `npm run build` makes the production build; `npm start` serves it on port 5173. `npm test` runs the automated checks.

## Features

- Individual, multiple and folder uploads; recursive folder drops.
- GIF, WebP, PNG and JPG: 60 images, 20 MB each, 150 MB total.
- Reordering, editable captions, gallery title and description.
- Grid, collage and scrapbook templates, six backgrounds, phone preview.
- Browser-generated ZIP with HTML, images, fonts, licenses and gallery settings.
- GitHub App sign-in, public repository creation, Pages publishing and updates.
- Resumable publishing and recovery of published galleries from GitHub.
- Drafts including image bytes saved on this device with IndexedDB.

## Architecture

Next.js on Vercel handles authentication only. GIFs and generated site files upload directly from the browser to GitHub. No Express server, SQLite database, persistent server disk, or server-side image storage is required.

The server encrypts an expiring session into an HttpOnly cookie. A same-origin, CSRF-protected endpoint supplies the GitHub access token to browser memory for publishing; it is never saved to localStorage or IndexedDB. Refresh tokens are discarded, and users reconnect after at most eight hours. Public publishing metadata/checkpoints stay in localStorage; drafts stay in IndexedDB. Clearing browser data removes unfinished progress. Published galleries can be recovered from GitHub.

The editor remains React. Exported galleries are standalone static HTML/CSS/JavaScript and do not need Next.js hosting. Netlify Drop is for those exported galleries.

## Deploy to Vercel

Import this repository as a **Next.js** project. Use the default build settings and no output-directory override. Set the six variables from `.env.example` in Vercel, replacing `APP_ORIGIN` with the production HTTPS origin. Do not prefix secrets with `NEXT_PUBLIC_`. Add the production OAuth callback in GitHub, then redeploy.

See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for deployment steps and [GITHUB_SETUP.md](GITHUB_SETUP.md) for app registration. ZIP export works before GitHub is configured. Local GitHub publishing has been confirmed by the project owner; production OAuth and publishing must be checked again on the deployed domain. Automated tests create no accounts or repositories.

Vercel Hobby has usage limits and is restricted to personal, non-commercial use. This architecture reduces server work; it does not guarantee unlimited free hosting.
