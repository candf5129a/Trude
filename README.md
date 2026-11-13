# Trude

Trude is a mobile-first social app prototype. It runs as a web app with a Node server and local SQLite storage.

## Run from VS Code

1. Open this folder in VS Code.
2. Open **Terminal → New Terminal**.
3. Run `node server.js` (Node.js 24 or newer).
4. On this computer, open `http://localhost:4173`.
5. On a phone connected to the same Wi-Fi, open `http://192.168.1.120:4173`. If the address changes, run `ipconfig` in the VS Code terminal and use the Wi-Fi IPv4 address.
6. Keep the terminal/server running while people test. If Windows asks, allow Node on your private network.

Anyone on that Wi-Fi can create a separate test account. The SQLite database stays on this computer and survives reloads and server restarts. This is a local network test, not a public internet deployment. Use test contact details and a password you do not use elsewhere. Email/phone ownership is not verified. Password reset shows a test code in the app; it does not send email or SMS.

## What testers can try

- Create an account or sign in; likes, comments, posts, follows, profile settings, and lobby chat are stored in SQLite.
- Double-tap a post to like, draw a C to open comments, or hold a post to open its actions.
- Browse Explore and open creator profiles. The profile Inbox supports persistent one-to-one text messages between test accounts.
- Tap **Chats** for the message inbox. Press and hold **Chats** for three seconds to open the separate room directory and hosted lobbies.
- Swipe horizontally between Home, Explore, Chats, and Profile. The Create button stays in the bottom bar and spins during the Explore/Chats transition.
- Upload photos/video, capture from the device camera, compose text, or record/import audio. Unfinished text and small media drafts are saved in that browser’s local storage; larger media may need to be selected again after resuming a draft.
- Join or host a room, invite people, chat, and try the included prompt games.

## Phone camera and microphone

Mobile camera and microphone access generally requires HTTPS or `localhost`. The Wi-Fi URL above uses HTTP, so use it to test accounts, posts, profiles, messages, and rooms; camera and microphone may be blocked by the browser. On the computer, `http://localhost:4173` is a secure context in current browsers. An HTTPS test URL can be added before mobile camera testing.

## Prototype limits

- Google OAuth and email/SMS delivery are not configured.
- LIVE creates a room and provides a local camera/screen preview, but does not broadcast to other users.
- AI image generation, licensed music, advanced editing/export, and real-money rewards need provider integrations.
- Chats currently support text messages only. The local prototype does not provide end-to-end encryption or production moderation, notifications, or backups.

`data/trude.sqlite` is ignored by Git and is stored on the computer running the server.
