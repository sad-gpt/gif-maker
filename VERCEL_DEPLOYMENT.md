# Deploy gif & giggles to Vercel

## 1. Push the local commits

From the folder containing `package.json`:

```powershell
git push origin main
```

The repository is `sad-gpt/gif-maker`. `.env`, private keys, local drafts/checkpoints, test screenshots and build outputs are excluded from Git. Never upload `.env` to GitHub.

## 2. Import the repository

In Vercel, choose **Add New → Project → Import Git Repository** and import `sad-gpt/gif-maker`. Allow Vercel access to that repository if prompted.

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | `./` (the folder containing `package.json`) |
| Node.js | 24.x |
| Install command | Default (`npm install`), or `npm ci` |
| Build command | `npm run build` |
| Output directory | Next.js default; do not enter `dist`, `out` or `public` |

Vercel runs the Next.js route handlers automatically. It does not need a custom start command, a second server or a database.

## 3. Set production environment variables

Copy these five values from your local `.env` into Vercel's **Environment Variables**, scoped to **Production**:

```text
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
```

Add `APP_ORIGIN` with the final HTTPS production origin, for example `https://your-project.vercel.app`. Use the stable project domain, not a per-deployment preview URL. No variable needs a `NEXT_PUBLIC_` prefix.

If the production domain is not known until the first deployment, deploy once to discover it. Then set `APP_ORIGIN` to the assigned domain and redeploy before testing authentication. ZIP export works without GitHub configuration.

## 4. Update the GitHub App

Open GitHub → Settings → Developer settings → GitHub Apps → your app → Edit.

- Set **Homepage URL** to the Vercel production origin.
- Set the **first Redirect URI** to `https://your-project.vercel.app/api/auth/github/callback`.
- Keep `http://127.0.0.1:5173/api/auth/github/callback` as a later entry if you still need local sign-in.
- Keep **Request user authorization (OAuth) during installation** enabled, wildcard matching disabled, and webhooks disabled.
- Save changes.

The first callback matters for installation authorization. A separate development GitHub App is recommended if you need to keep testing fresh installations locally after production goes live.

## 5. Redeploy

In Vercel → Deployments, redeploy the latest production commit after changing environment variables. Environment changes apply to new deployments.

Use the stable production domain for testing. Arbitrary preview URLs do not match production cookies/OAuth callbacks.

## 6. Verify the public site

1. Open `/api/health` on the production domain: expect `ok: true` and `githubConfigured: true`.
2. Open the editor, add a small GIF/WebP, edit its caption, refresh, and verify the draft is restored.
3. Download a ZIP and confirm it includes the gallery and images.
4. Connect GitHub. For a fresh user, install/authorize the app on their personal account.
5. Publish a small gallery, wait for the live status, and open its GitHub Pages link.
6. Edit its caption and publish an update to the same URL.

Local and deployed domains have separate browser storage. Your local drafts and unfinished publish checkpoints will not appear automatically on Vercel; previously published galleries remain on GitHub and can be reopened through the app.

## Limits

Vercel Hobby is intended for personal, non-commercial projects and has usage caps. GIF bytes go directly to GitHub, but the editor and sign-in still consume Vercel resources. GitHub and Netlify have separate limits. Local success does not replace the production OAuth test above.

## References

- [Vercel deployments](https://vercel.com/docs/deployments/overview)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [GitHub callback URLs](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)
