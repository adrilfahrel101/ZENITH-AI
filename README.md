# Zenith Studio

GitHub Pages website: <https://adrilfahrel101.github.io/ZENITH-AI/>

## Current setup

- Google sign-in uses Firebase Authentication.
- Chat calls Claude Sonnet 5.5 through a Firebase callable function; the Anthropic key stays in Firebase Secret Manager.
- The function requires a signed-in Firebase user, accepts at most 8 recent messages / 6,000 characters, returns at most 512 tokens, and limits each user to 5 calls per UTC day.
- A Firestore transaction reserves estimated API cost against a shared $4.50 monthly application budget. This is an application-side estimate, not Anthropic's billing system or an absolute guarantee.
- Chat history is kept in page memory only and is cleared on sign-out or reload.

## Deploy the Claude backend

Prerequisites: Node.js 22, Firebase CLI, access to the `zenith-studio-c20ce` Firebase project, a Firestore Native database in `asia-southeast1`, an Anthropic API account/key, and Firebase billing enabled for Cloud Functions.

1. In the Anthropic Console, create an API key and configure a monthly spend limit of no more than US$5 if the account offers that limit. Do not paste the key into source code, GitHub, or chat.
2. Open a terminal in this project and run:

   ```powershell
   npm install --global firebase-tools
   firebase login
   firebase use zenith-studio-c20ce
   ```

3. Upgrade Firebase to the Blaze plan and attach a billing account. Cloud Functions require billing; these Firebase costs are separate from the Anthropic API budget. Set a Firebase budget alert, noting that alerts do not automatically stop billing.
4. Create the Firestore Native database in `asia-southeast1` if it does not already exist.
5. Save the API key as a Firebase secret. The CLI prompts for it securely:

   ```powershell
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```

6. From the project root, install backend dependencies and deploy:

   ```powershell
   Set-Location .\functions
   npm install
   Set-Location ..
   firebase deploy --only functions,firestore:rules
   ```

7. Upload the updated `index.html` to the root of the `main` branch in GitHub. GitHub Pages will publish the frontend; Firebase deploy publishes the backend separately.

## Cost and security notes

- The app-side $4.50 cap is a conservative reservation estimate using Claude Sonnet 5.5 public token rates ($4 / million input tokens and $20 / million output tokens). Tokenization, provider pricing changes, concurrent deployments, Firebase billing, and other usage may differ. Configure provider-side spending limits and alerts too.
- Firebase budgets are alerts, not hard spending caps. Blaze may incur charges independently of Anthropic usage.
- Do not put an Anthropic API key, Firebase service-account JSON, or private credentials in `index.html` or this public repository.
- Firestore client access is denied by `firestore.rules`; Cloud Functions use the Firebase Admin SDK for server-side quota accounting.
- This deployment does not yet enable App Check. Configure and enforce App Check before a broad public launch.
