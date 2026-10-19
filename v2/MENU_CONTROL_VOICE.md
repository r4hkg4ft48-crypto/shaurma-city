# Menu Control · Шаурмег only

## Scope
The coordinator Telegram bot @Anukadavaikavihodibot serves **only Shaurmeg** venue menus. No outbound calls, project resolution, role bindings, keys, or configuration from Kofeyok are used.

This release does **not** change the independent Kofeyok project or its production services. Pre-existing historical database records are retained to avoid destructive migrations; pending records for other projects are expressly rejected during confirmation.

## How to connect an establishment
1. Open the **Shaurmeg** venue administration → `Идентификаторы меню`. Generate a one-time `SHA-MNU-<16 hex chars>` key (24 hours by default). Do not share the key publicly.
2. Open [the coordinator Telegram bot](https://t.me/Anukadavaikavihodibot) in a **private chat**.
3. Send `/connect SHA-MNU-...` or send the full key as a standalone private message. The server verifies and consumes the key and binds **that Telegram account** to exactly **one Shaurmeg venue**.
4. Alternatively open the coordinator Mini App from the bot menu and enter the same key in the `Подключить заведение` field. Only signed Telegram WebApp `initData` can use this action.
5. Check `/status`, then `/menu` or `/menu шаурма` to search venue-local IDs. In the Mini App, you see only the bound Shaurmeg venue.
6. Send a textual or voice command. The bot resolves the exact venue-local immutable code and asks for explicit confirmation before changing menu data.

### Common commands
- `/start`, `/status`, `/menu`, `/menu шаурма`
- `Убери сырную шаурму` / `Верни сырную шаурму в продажу`
- `Измени цену на сырную шаурму 350`
- `Переименуй сырную шаурму в Сырная шаурма XL`
- `Измени описание сырной шаурмы на Фирменный соус`
- `Добавь халапеньо в сырную шаурму`
- `Убери сыр из сырной шаурмы`
- `Замени состав сырной шаурмы на курица, лаваш, сыр`
- `Отключи раздел Напитки`
- `P012ABC состав + сыр` and other menu-code commands

## Security guarantees
- One Telegram ID → at most one active Shaurmeg venue binding at a time; distinct venues cannot be modified via user-supplied venue IDs.
- Menu IDs are venue-scoped; duplicate names require clarification, and ingredients must belong to the selected dish.
- Proposed changes require single-use three-minute confirmation and revalidate Telegram actor, venue, internal ID, kind and code.
- Existing coordinator executor logs audit records, updates the right Shaurmeg venue and emits real-time menu refreshes.
- Former cross-project confirmation records are rejected. This release does not erase historical records or alter third-party projects.
- No unattended listening: audio is recorded only through explicit Telegram/Mini App microphone actions.
- Time-limited "until tomorrow" commands are refused until scheduling is implemented.

## Production / diagnostics
- Render service: `shaurma-city-api` at `https://shaurma-city-api.onrender.com`.
- Health (public, nonsecret): `/api/v2/telegram/coordinator-health` should return `project:"shaurmeg"`, and true for `enabled`, `webhookSecured`, `miniAppConfigured`, `voiceConfigured` where configured.
- Mini App: `/realcity-preview/coordinator-console.html` must be opened from the Telegram bot so signed `initData` is available.
- Required variables: `COORDINATOR_BOT_TOKEN` and `COORDINATOR_WEBHOOK_SECRET`; speech requires `COORDINATOR_STT_API_KEY` or `OPENAI_API_KEY`.
- No bridge credentials or environment variables for other projects are used by Menu Control. Previous unused env variables can be retired manually in Render settings after verification.
- End-to-end test must be conducted on a deliberately designated test item: connect, catalog, preview, confirm, inspect menu and audit log. Do not change live restaurant prices as a smoke test.
