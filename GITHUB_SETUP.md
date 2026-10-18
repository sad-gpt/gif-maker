# GitHub + Vercel setup

Next.js handles authentication in Vercel Functions. Gallery files upload directly from the browser to GitHub. No database or persistent disk is required.

## 1. Register the GitHub App

Run `npm run setup:local`, then `npm run setup:github` for a prefilled registration link.

| Setting | Value |
| --- | --- |
| Name | A globally unique name, such as `gif-and-giggles-sad-gpt` |
| Homepage | Your deployed app URL, or repository URL during development |
| Development callback | `http://127.0.0.1:5173/api/auth/github/callback` |
| Request user authorization during installation | Enabled |
| Expire user authorization tokens | Enabled |
| Device flow | Disabled |
| Webhooks | Disabled |
| Repository Contents | Read and write |
| Repository Administration | Read and write |
| Repository Pages | Read and write |
| Metadata | Read-only (automatic) |
| Installation | Any account |

This is OAuth through a **GitHub App**, not a traditional OAuth App. No private key or workflow permission is needed. Contents writes gallery files; Administration creates repositories; Pages enables and checks publishing.

Copy App ID, the app's URL slug, Client ID, and a generated Client Secret into `.env`. Keep the client secret out of chat and Git. Restart after changing credentials.

```env
APP_ORIGIN=http://127.0.0.1:5173
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
SESSION_SECRET=
```

`npm run setup:local` generates `SESSION_SECRET` if blank. Keep it stable and at least 32 characters long. No secret may use a `NEXT_PUBLIC_` prefix.

## 2. Run locally

Use Node.js 24, then `npm install` and `npm run dev`. Open `http://127.0.0.1:5173`; use the same hostname as the callback.

Click **Publish gallery → Connect GitHub**, then install on your personal GitHub account. Prefer selecting only the repositories needed by this app. GitHub grants an app access to repositories it creates. Organization publishing is outside this version's scope.

## 3. Deploy to Vercel

1. Import the repository and select **Next.js**. Retain default build/output settings. No separate Express service is needed.
2. Set the six environment variables above in Vercel. Set `APP_ORIGIN` to the final production origin, such as `https://your-project.vercel.app`.
3. Add `https://your-project.vercel.app/api/auth/github/callback` as the **first** GitHub App callback. Installation authorization uses the first callback; putting localhost first breaks production installation. Keep the localhost callback afterward for ordinary local sign-in. Use a separate development GitHub App if you also need local installation testing. Update the homepage as appropriate.
4. Redeploy. If the domain changes, update both `APP_ORIGIN` and the GitHub callback. Use a fixed staging origin/app for preview authentication rather than arbitrary preview domains.
5. Run the live test below. ZIP export works even without GitHub credentials.

No image upload passes through a Vercel Function. Old `.data/` files are unused and ignored; they are not deployed. Old login sessions must reconnect. Drafts on the same browser origin remain available.

## 4. Live verification

Publish a small test gallery, wait for its exact Pages commit to build, and open the URL. Change a caption and publish an update. Verify the same URL shows the edit. Close/reopen the publish panel during another upload and verify resume. Reconnect and use the saved galleries list to recover a published gallery.

Automated tests mock GitHub. They cover OAuth state/PKCE, encrypted sessions, CSRF, publishing checkpoints, changed-file rejection, external-commit protection, rate limits, ZIP contents and local drafts. Real authorization and deployment still require this live test.

## Security and operational details

- Sign-in uses an encrypted, expiring HttpOnly state cookie and PKCE. The callback consumes the cookie; GitHub authorization codes are single-use. Installation membership is checked through GitHub.
- Sessions use AES-256-GCM encrypted HttpOnly, SameSite=Lax cookies, with Secure on HTTPS. The access-token endpoint requires Origin and CSRF checks and returns `Cache-Control: no-store`. The client secret never reaches frontend code.
- Publishing needs the access token in browser memory. Tokens are not stored in localStorage or IndexedDB. Refresh tokens are discarded; sessions last at most eight hours. Logout clears this browser session and this tab's cache; it does not revoke already issued tokens in other tabs/devices. Users can revoke authorization in GitHub settings.
- The editor sends a nonce-based Content Security Policy and loads no third-party scripts.
- Public gallery metadata and upload checkpoints stay locally; GIF drafts use IndexedDB. Finished galleries can be recovered by scanning up to the 1,000 most recently updated owned repositories for this app's marker and validating their manifest/tree. Unfinished uploads need the original device checkpoints.
- Dedicated public repositories are created; unrelated names are never adopted. Updates verify owner, repository ID, visibility and branch commit and never force-push. External changes stop updates. Interrupted repositories remain in the user's account.
- GitHub writes are spaced apart, rate-limit cooldowns are respected, and Web Locks coordinate same-origin tabs. Local publishing limits are convenience controls, not global abuse protection. GitHub/Vercel enforce their own limits.
- Success requires the exact published commit's Pages build to succeed. GitHub permissions, account verification and provider limits can still block publishing.
- Vercel Hobby is for personal, non-commercial use and has usage caps. GitHub Pages and Netlify have their own limits and account requirements. No unlimited-free-hosting guarantee is made.
