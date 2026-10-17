# Shaurmeg: quick orders from Telegram favorites

## Customer journey

1. Save an actual menu dish or builder recipe in favorites inside a specific Shaurmeg establishment.
2. To enable one-message card payments once, open the main Shaurmeg Mini App **Profile → Quick Order**, pick a per-order maximum and explicitly accept the off-session payment consent.
3. Follow YooKassa's hosted card-binding link; enter card data only at YooKassa (never in our site/API), complete bank verification, return and press **Check card binding** if it was not confirmed automatically.
4. Send **Закажи лепёшку с сыром** to the main `@Shaurmeggbot`. The match is scoped to explicit saved dishes and establishment IDs and current menu availability. Ambiguity triggers Telegram inline venue choices. A different price or unavailable item blocks charging.
5. If a verified recurring card token, active consent, provider credentials and amount cap are all present, the server submits a single idempotent YooKassa charge and verifies the succeeded result before creating an order and routing it to the kitchen. Telegram invoice is fallback if configured.
6. In Profile the user can revoke future quick-order debits at any time.

## Production payment setup (merchant responsibility)

The live feature is **disabled by default**, because it requires an actual contract with a payment processor and an explicit card-binding process. Configure secrets on the Render API service only:

- `SHAURMEG_YOOKASSA_SHOP_ID` — YooKassa shop identifier.
- `SHAURMEG_YOOKASSA_SECRET_KEY` — YooKassa API secret key.
- Optional `SHAURMEG_PAYMENT_PROVIDER_TOKEN` — BotFather-issued Telegram provider token for the **invoice fallback** (not the same as YooKassa secret).

Enable recurring/saved bank card payments and zero-amount bank-card binding for the **live** shop with YooKassa first. YooKassa test shops do not imply the live shop is approved. Configure webhook events `payment.succeeded`, `payment.canceled`, `payment.waiting_for_capture` at:

`https://shaurma-city-api.onrender.com/api/v2/payments/yookassa/webhook`

The webhook is independently verified by a YooKassa API GET and identity/amount comparisons; incoming body contents cannot themselves authorize a paid order.

**Before enabling live charges:** confirm the contracting merchant-of-record, which legal entity receives funds on behalf of the individual venues, any settlement/split-payout arrangements, tax receipt/54-FZ settings, refunds, support processes, privacy documents, actual provider test transactions and kitchen delivery. Do not use a single merchant account to collect money for unrelated venue owners without the necessary commercial/legal setup.

## Behavior and safety limits

- New direct orders default to **cafe pickup**, not delivery; no unprovided address is invented.
- Charging is possible only for a verified Telegram private chat command and an exact user-saved dish in an active venue.
- `id` is used as the YooKassa idempotence key. Pending payments never create a kitchen order.
- Duplicate identical purchase commands within 30 seconds are refused. Repeated Telegram update IDs are deduplicated in Postgres.
- Sensitive credentials and card data stay outside the frontend. Only tokenized payment method IDs and masked last four are stored. Changing card or disabling consent halts new quick-order debits.
- The provider's transaction notification or periodic reconciliation can finalize a confirmed payment that was previously pending. If a PSP request has an indeterminate network outcome, the bot does **not** silently submit an unpaid order and the user is told to wait for verification.
- Failed payments do not result in an accepted order. Telegram invoices require user interaction and therefore are **not** the promised one-message automatic experience.
- No user-facing response should claim the feature is live until CI is green, the exact commit is deployed, card-provider credentials are configured and a successful end-to-end sandbox test is verified.
