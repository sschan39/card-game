# Playtest shows “Connection lost” after the room expires

**Reported November 21, 2026** · Codex in-app browser on Windows · local Scenario Lab on port 3003

**Affected room** · Combat practice `2ef2a18e-0c3b-4837-86f5-ebf9ef4d8ae0`

## Observed behavior

The demo room opened with both seats connected. Seat A successfully used Auto to pass priority to Seat B. On return to the tab, the match displayed **Connection lost** and **Retry**. Retry briefly showed “The playtest seat is no longer available” and left the same banner and button in place.

## Cause

Single-operator test rooms are tied to the admin session that launched them. This server gives admin sessions a fixed 15-minute lifetime. At expiry the server revokes both seat connections and removes the test room. Reconnecting before expiry succeeds. Reconnecting after expiry requires a new room.

| Hong Kong time | Server evidence |
| --- | --- |
| 16:11:26 | Admin sign-in succeeded. |
| 16:11:27 | Both seats joined the demo room. |
| 16:11:52 | Seat A’s pass committed and the updated board was published. |
| 16:16:51 | Both seat sockets disconnected. The log did not record the transport reason. |
| 16:23:17 | Both seats rejoined the same room, confirming that the earlier disconnect had been recoverable. |
| 16:26:26 | Both seats disconnected and the server destroyed the room, 15 minutes after sign-in. The server process remained running. |

The expiry path is in [admin session configuration](../apps/server/src/config/auth.json), [session validation](../apps/server/src/auth/session.ts), and the [socket and room revocation handlers](../apps/server/src/application.ts). The [playtest session](../apps/game-client/playtest/session.ts) maps the terminal end and a recoverable disconnect to the same offline state. The [match banner](../apps/game-client/components/GameScreen.tsx) renders that state as **Connection lost** with **Retry**.

## Reproduction

1. Sign in to the local Scenario Lab and launch **Start combat practice**.
2. Leave the room open until 15 minutes after signing in.
3. Observe **Connection lost**, then click **Retry**. The server rejects the expired seat and the banner still offers Retry.

## Verdict

**False bug for the reported match disconnect.** The room closed on schedule under its admin session policy, and Auto’s pass completed normally. The cause of the earlier recoverable socket disconnect remains unknown.

**Confirmed UI bug.** The expired room presents a retryable connection state even after the server has permanently closed the room. The expected display is a persistent **Playtest expired** message with a link back to Scenario Lab to sign in and start a fresh room. Reserve **Retry** for recoverable connection failures.
