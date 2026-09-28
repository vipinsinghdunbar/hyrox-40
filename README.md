# HYROX 40

A single-page, mobile-first HYROX training companion/PWA. The app uses plain HTML, CSS, and JavaScript; no package install is needed.

## Run locally

Open `index.html` for the basic preview. For service-worker/update behavior, serve the folder over HTTPS or a local HTTP server.

## Deploy to Render and connect GitHub

1. Push this project to a GitHub repository.
2. In Render, choose **New → Blueprint**, connect that repository, and select `render.yaml`.
3. Render builds the static PWA with `node build.js`; every build gets a content-based version ID for update checks.
4. Keep automatic deploys enabled for the production branch. Each push then deploys the site.
5. Use the resulting HTTPS `*.onrender.com` URL to install it on your phone.

The installed app checks for a new deployment when opened, when it returns to the foreground, and every five minutes while visible. It shows an **Update ready** prompt; tapping **Refresh** loads the newest app. Navigation pages are network-first with an offline cached fallback.

## Add it to a phone

- **iPhone:** open the HTTPS Render URL in Safari → Share → **Add to Home Screen** → Add.
- **Android:** open the HTTPS URL in Chrome → **Install app** (or menu → Add to Home screen).

Keep the app online when you want to receive new versions. If it is already open during a deploy, the update prompt appears at the next check; the user can finish the current workout before refreshing.

## QA

```sh
node qa_simulations.js
node build.js
```
