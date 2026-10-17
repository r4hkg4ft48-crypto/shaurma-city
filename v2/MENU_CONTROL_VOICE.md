# Menu Control · Telegram voice and Mini App

## System
The new coordinator bot is the staff-facing entry point for both Шаурмег and Кофеёк.
It uses the already deployed per-venue coordinator bindings and single-use owner-issued keys.
The voice resolver always loads codes under the Telegram actor's venue, never under a venue ID supplied by the client.

## Key invariants
- Project and venue are inferred server-side from the authenticated Telegram identity.
- Menu codes are unique **within a venue**, but never treated as a global identity.
- Natural-language writes require a full-name match or an exact code. Ambiguous commands never execute.
- All modifications must be confirmed within 3 minutes and are single-use.
- The server rechecks that the venue, kind, immutable entity ID and code are still bound before executing.
- Changes are applied by the existing project-specific coordinator executor; source catalog is never mutated by the language parser.
- Scheduled stop-list restoration is not yet implemented; time-limited phrases are explicitly refused.

## Telegram setup
1. In the Shaurmeg API service, configure `COORDINATOR_BOT_TOKEN` (the newly created BotFather bot) and `COORDINATOR_WEBHOOK_SECRET` (at least 20 random characters).
2. `V2_PUBLIC_API_URL` or `PUBLIC_API_URL` must be the public HTTPS origin of the Shaurmeg API. The server installs the Telegram webhook and a bot menu button when booting.
3. To connect Coffee, configure the same 32+ character shared bridge secret in `COORDINATOR_COFFEE_SECRET` (Shaurmeg API service) and `COORDINATOR_API_SECRET` (Coffee service). The Coffee endpoint must be published.
4. For voice recognition, configure `COORDINATOR_STT_API_KEY` (preferred) or `OPENAI_API_KEY` on the Shaurmeg API service. Without either, text controls still work, and voice displays a configuration error. Audio is sent to the provider only after staff records or sends a voice message.
5. The coordinator Mini App is available at `https://shaurma-city-api.onrender.com/realcity-preview/coordinator-console.html` when production is deployed; open it from the bot menu, not from an external browser, for signed Telegram `initData`.
6. Use a per-venue one-time key issued in the owner administration and send `/connect KEY` to the coordinator bot in private chat.

## Validated actions
- “Убери сырную шаурму”
- “Верни классическую шаурму в продажу”
- “Установи цену на капучино 250”
- “Найди сырную шаурму”
- “P012ABC стоп лист”
- Legacy code commands: “P012ABC состав + сыр” (also requires confirmation)
- Existing `создать позицию ...` commands remain supported, also with confirmation.

## Device roadmap
A permanently listening counter-top speaker is **not connected** by this release. A future device requires hardware enrollment, per-device credentials, per-venue capabilities, push-to-talk/wake-word policy, loudspeaker audio, and token rotation. Until then, the voice path is Telegram voice notes and user-initiated Mini App recording.

## Release checks
`Coordinator Voice Safety` CI performs Node syntax checks, Russian command resolution tests, and existing coordinator isolation contracts. Test both production bridge secrets and the Telegram webhook after deploy. Do not assume Coffee connectivity just because its PR was merged; check the health diagnostics and the secret configuration.
