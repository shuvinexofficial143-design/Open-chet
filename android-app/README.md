# Open Chet Android

This is a lightweight Android WebView wrapper for the production Open Chet app.

Production URL: https://open-chet.vercel.app/

## Behaviour

- Uses the same Open Chet backend, Supabase data, n8n bridge and WhatsApp integration.
- Website updates appear in the Android app without rebuilding the APK.
- Keeps normal WebView cookies/session storage for login persistence.
- Supports the system file picker for attachments.
- Opens non-Open-Chet links in the user's default browser/app.
- Android Back navigates WebView history before closing the app.

## Build

GitHub Actions builds a debug APK automatically when files under android-app change.
The APK artifact is named Open-Chet-APK.

For Play Store / production distribution, configure a permanent release signing key in GitHub Actions secrets before shipping.
