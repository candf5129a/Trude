# Trude

Trude is a mobile-first social app work in progress. This build uses a local Node server and SQLite database so a small group on the same Wi-Fi can create test accounts and share posts, likes, comments, follows, and lobby chats.

## Run the shared test build

Requires Node.js 24 or newer (built-in node:sqlite; no npm packages required).

```powershell
node server.js
```

Open http://localhost:4173. For testers on the same Wi-Fi, share http://<this-computer-LAN-address>:4173. Keep this as a small test environment; it uses HTTP and local SQLite storage.

## Available in this build

- Create and sign into a test account with an email address or mobile number plus a password. Likes, follows, posts, comments, profiles, and room messages persist in SQLite and are shared between users connected to this server.
- Start a post by double-tapping to like, drawing a C to open comments, or holding a post to see its action sheet.
- Search creators and posts, visit profiles, follow people, save and share posts, set an account private, and view profile analytics.
- Join a random lobby, host a room with a selected capacity and duration, invite people with a room link, and chat with users who join. Lobby messages refresh between clients about every two seconds.
- Open Chats by pressing and holding Lobby for three seconds.
- Import/capture a photo or video, use basic visual filters, create text posts, and record or import an audio post.
- Start a local camera/screen preview for the LIVE setup flow; it does not broadcast to viewers.

## Still needs provider or streaming setup

- Test accounts do not verify email or phone ownership. Gmail address plus password is a test login, not Google OAuth. Configure Google OAuth, SMS, and email delivery before using real contact details.
- Password reset works in local test mode by showing a one-time code in the browser; no email or SMS is sent.
- Multi-device live video, real-time co-host grids, AI image generation, licensed music, advanced video trimming/export, processed audio effects, and cash rewards are not connected.
- data/trude.sqlite contains test user data and is ignored by Git. Do not commit it or reuse this HTTP setup for production.
