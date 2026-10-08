# Open Chet Android

This is a lightweight Android WebView wrapper for the production Open Chet app.

Production URL: https://open-chet.vercel.app/

## Behaviour

- Uses the same Open Chet backend, Supabase data, n8n bridge and WhatsApp integration.
- Website updates appear in the Android app without rebuilding the APK.
- Keeps normal WebView cookies/session storage for login persistence.
- Supports the system file picker for attachments.
- Opens non-Open-Chet links in the user's default browser/app.
- Android system Back (button or edge gesture) closes an open overlay first, returns an open chat to the chat list, and navigates back one app section at a time. The header arrow behaves the same way.
- In the main chat list, a single accidental Back never exits. Press Back twice within 2 seconds to exit.
- Browser/PWA Back also returns from an open chat to the chat list using a same-page history entry.
- Install the newly built **1.0.3** APK to get the improved native system-Back handler; website navigation changes update automatically.

## Build

GitHub Actions builds a debug APK automatically when files under android-app change.
The APK artifact is named Open-Chet-APK.

For Play Store / production distribution, configure a permanent release signing key in GitHub Actions secrets before shipping.
