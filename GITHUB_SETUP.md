# Push HYROX 40 from your computer

This project ZIP contains the app source and Render Blueprint. It does not contain a `.git` folder, so you can make the first commit in your own GitHub-linked local folder.

## First push

1. Create an **empty** repository on GitHub. Suggested address: `https://github.com/vipinsinghdunbar/hyrox-40`. Do not add a README, license, or `.gitignore` on GitHub; this package already includes those project files.
2. Download and extract `hyrox-40-project.zip` to a normal folder on your computer.
3. Open Terminal (macOS) or PowerShell/Git Bash (Windows), change into the extracted project folder, then run:

```sh
git init
git add .
git commit -m "Initial HYROX 40 PWA"
git branch -M main
git remote add origin https://github.com/vipinsinghdunbar/hyrox-40.git
git push -u origin main
```

If you choose another repository name, replace the URL above. GitHub will ask you to authenticate using its normal sign-in/credential flow. Do not paste a GitHub password or token into chat.

## Connect Render

1. Sign in to Render and choose **New → Blueprint**.
2. Connect GitHub (authorize Render for this repository) and select the repository.
3. Render reads `render.yaml`, runs `node build.js`, and publishes `dist/`. The Blueprint is set to deploy commits to the linked branch.
4. After the first successful deploy, open the HTTPS `*.onrender.com` address on the iPhone in Safari, tap **Share → Add to Home Screen**.

## Future changes made here

Arena's workspace is separate from the folder on your computer, so edits made here do not silently appear in your local checkout. For an update, download the new project ZIP, extract/replace the project files in your existing local repository **without deleting its hidden `.git` folder**, then run:

```sh
git status
git add .
git commit -m "Update HYROX 40"
git push
```

Render will redeploy after the push. When you reopen or foreground the installed app, it checks for the new build and offers a refresh. The app's workout/profile data stays in the phone's local browser storage; this deployment flow does not sync training data between devices.
