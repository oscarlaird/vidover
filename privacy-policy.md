# Privacy Policy

**Effective Date:** June 27, 2026

This privacy policy describes how the Vidover project ("we", "our", or "us") handles information when you use our Netflix Watch List Extension and related tools.

## Overview

Vidover is designed with privacy in mind. All data collected by our extension is stored locally on your device and is never transmitted to our servers. We do not track, analyze, or monetize your data.

## Data Collection

### Netflix Watch List Extension

The Chrome extension collects the following data to provide its functionality:

| Data Type | Purpose |
|-----------|---------|
| Netflix title names | Identifying content for overlay matching |
| Playback timestamps | Synchronizing overlay videos with Netflix playback |
| Player dimensions | Positioning overlays correctly on screen |
| Episode/season metadata | Matching the correct overlay to your content |

### What We Do NOT Collect

- Netflix account credentials or login information
- Personal identification information (PII)
- Viewing history or behavioral patterns
- Payment or billing information
- Analytics or tracking data

## Data Storage

All collected data is stored locally in your browser using Chrome's local storage API. This data:

- Remains entirely on your device
- Is never transmitted to external servers
- Is automatically deleted when you uninstall the extension
- Can be manually cleared through Chrome's settings at any time

## Third-Party Services

### Cloudflare Stream

When overlay videos are available for your content, the extension may fetch video files from Cloudflare Stream. Cloudflare may collect standard CDN access logs (IP address, request timestamps) as described in their [privacy policy](https://www.cloudflare.com/privacypolicy/).

### Google MediaPipe

The video processing tool downloads a machine learning model from Google's servers for face detection. This is a one-time download and does not transmit any of your personal data to Google.

## Data Retention

- **Browser Storage:** Data is retained until you uninstall the extension or clear your browser data
- **Local Files:** Processed video files remain on your device until you delete them

## Your Rights and Controls

You have full control over your data:

- **View stored data:** Access Chrome DevTools > Application > Local Storage
- **Delete data:** Uninstall the extension or clear Chrome's local storage
- **Disable the extension:** Use Chrome's extension management to disable at any time

## Children's Privacy

Our extension is not directed at children under 13. We do not knowingly collect information from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected with a new effective date at the top of this document.

## Contact

If you have questions about this privacy policy, please open an issue on our [GitHub repository](https://github.com/simonlaird/vidover).

---

*This privacy policy applies to the Vidover Chrome extension and related tools.*
