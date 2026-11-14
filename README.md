# Trude

Trude is a mobile-first social app prototype. It uses a small Node.js server and a local SQLite database for friend-and-family testing.

## Open it on your phone from VS Code

1. Install Node.js 24 or newer and open this repository in VS Code.
2. Choose **Terminal → New Terminal**.
3. Start the current shared test server with `$env:PORT='4175'; node server.js`. Keep this terminal running.
4. Connect your phone and computer to the same Wi-Fi. On Android, open Chrome and visit **http://192.168.1.120:4175**. If the address changes, run `ipconfig` on the computer and use its Wi-Fi IPv4 address with `:4175` at the end.
5. If Windows asks, allow Node.js through the firewall on your **Private** network. Create separate test accounts on each device to try posts, follows, chats, and lobbies.
6. Press **Ctrl+C** in the VS Code terminal when you want to stop the local server.

This URL works only for devices on the same network. The local app is not yet a phone-installable PWA; a public HTTPS URL and app manifest/service worker are needed for an install-style home-screen experience. Mobile camera and microphone APIs also require HTTPS or localhost, so those may be blocked on the LAN HTTP URL.

## Keep a test server running for people outside your Wi-Fi

The repository now includes `npm start` and declares Node.js 24+. To host a closed feedback test, connect this GitHub repository to a paid Render Web Service, set the build command to `npm install`, and the start command to `npm start`. Render supplies HTTPS and a public URL. The current SQLite database and uploaded media need a persistent disk mounted at the app's `data` directory; this is for a single service instance. Before inviting testers, add sign-up protections, moderation/report handling, backups, rate limits, and privacy/terms pages.

Do not use a Render free Web Service for durable testing: free services can sleep and have an ephemeral filesystem. Persistent disks preserve local files, but Render does not allow a disk-backed service to scale to multiple instances. See [Render persistent disks](https://render.com/docs/disks), [Render scaling](https://render.com/docs/scaling), and [Render free-service limits](https://render.com/docs/free).

## What the prototype supports

- Local account creation and sign-in, posts, likes, comments, follows, profiles, direct text messages, and lobby text chat stored in SQLite.
- Chats opens the inbox. Press and hold **Chats** for three seconds to reveal the lobby directory.
- Lobby directory shows open rooms with free seats first and popular hosts second; both rows scroll horizontally.
- In a lobby, tap the dice icon for the game list or press and hold it for three seconds. Lobby score records are stored per room in SQLite.
- Camera preview filters now apply to the camera and uploaded/captured media preview; LIVE preview filters and the soft-focus control apply to its local preview. Filters are basic visual CSS effects, not segmentation or face-tracked effects.

## 10,000-user capacity

This local starter is **not ready for 10,000 concurrent users**. The server uses Node's synchronous `DatabaseSync` SQLite API and keeps media in SQLite; synchronous database calls block the Node event loop, and a single local SQLite file cannot be shared safely across horizontally scaled instances. The current lobby poll also repeats every 1.8 seconds per active member.

I ran a local read-only burst of 10,000 `/api/feed` requests at 100 concurrent requests: zero failures, p50 80 ms, p95 128 ms, total 8.49 seconds on this development machine. That is a request burst from one process, **not** a 10,000-user concurrency test. It excludes sign-ins, feed writes, media upload/download, live chat fan-out, and different phones/network latency.

For a real 10,000-user load test, first move the data to managed PostgreSQL, media to object storage/CDN, chat and room events to WebSockets backed by shared pub/sub, and run multiple stateless app instances behind a load balancer. Then exercise staged concurrent virtual users with realistic feed, chat, and upload workloads while observing latency, errors, CPU, memory, database connections, and bandwidth. The local burst above is only a smoke benchmark; it does not predict capacity or cost.

## Game and safety boundaries

Truth or Dare now has a game-room screen, configurable 2/5/10/15/20 player selection and five age-appropriate prompt levels. Two animated spins choose different joined room members; answers and passes are posted to the lobby chat, while scores and spectator eligibility are saved to SQLite for that lobby. Game state and turns are not yet synchronized as one authoritative session across every tester’s device, so use it as a cooperative prototype rather than a competitive result. The 18+ level stays disabled because Trude does not verify age.

Google sign-in, email/SMS delivery, AI image generation, licensed music, advanced media export, real-money rewards, production streaming, end-to-end encrypted chat, and production moderation are not connected.

`data/trude.sqlite` contains local test accounts and is ignored by Git. Back it up before moving or replacing the database.
