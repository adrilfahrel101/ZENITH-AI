# Zenith Studio

GitHub Pages website: <https://adrilfahrel101.github.io/ZENITH-AI/>

## Current setup

- Google sign-in uses Firebase Authentication.
- Chat uses Gemini through Firebase AI Logic and the Gemini Developer API free tier; no Gemini API key is stored in the website.
- The selected model is `gemini-3.1-flash-lite`. The free tier has model and usage limits that Google can change. When the quota is exhausted, chat must wait until it resets or use another eligible model/tier.
- Chat history stays in page memory and is cleared on sign-out or reload. Each request includes at most 8 recent messages / 6,000 characters and requests at most 512 output tokens.
- Free-tier Gemini prompts may be used by Google to improve its products. Do not send passwords, payment details, private keys, or other sensitive information.

## Enable Gemini for this Firebase project

1. Open the Firebase Console for project `zenith-studio-c20ce`.
2. Open **AI services → Firebase AI Logic** and choose **Get started**.
3. Select **Gemini Developer API** as the provider. Keep the project on the **Spark** plan and choose the free tier; do not link a Cloud Billing account for this setup.
4. Open the live site and sign in with Google. If the setup is complete and the free-tier quota is available, send a test message.

The website does not use Cloud Functions, Firestore, or an API key for this Gemini setup. The old Claude Functions deployment is not part of this free-tier configuration.

## Security and limits

- Firebase AI Logic protects the model connection; never put a Gemini or Anthropic API key in this public repository.
- The web app is registered in Firebase **App Check** with a reCAPTCHA Enterprise score-based key restricted to `adrilfahrel101.github.io`. The website initializes the Enterprise provider, and Firebase AI Logic App Check enforcement is enabled. Keep the public site key domain-restricted; never put a reCAPTCHA secret key or Gemini API key in this repository.
- The browser limits request size for usability, but client-side limits are not a hard per-account spending or abuse cap.
- Gemini free-tier prompts may be used to improve Google's products; use paid service terms or another provider if that is unsuitable. Google can change model availability and rate limits. Check the [Gemini API pricing and terms](https://ai.google.dev/gemini-api/docs/pricing) before relying on it.
