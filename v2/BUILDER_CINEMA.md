# Photographic dish assembly

The client uses `builder-cinema.js` for selection-driven photo compositing. Bread, meat, extras and sauces are independent layers. The default atlas is generated food photography; it is explicitly labelled as a visualization, not a photograph of the restaurant's exact recipe. Unknown ingredients are listed in the caption instead of being mapped to unrelated food. The last frame uses the restaurant's original uploaded finished-dish photograph. It does not claim to simulate real folding physics or reveal the hidden contents of a closed wrap.

## Owner flow

Both `v2/frontend/admin-venue.html` and the production `/venue-owner` cabinet expose **Фотосборка блюда** inside the builder settings. Choose a saved product format, describe any permanent filling, then upload its finished photo. If generation is configured, uploading starts preparation. Review the animated draft before selecting **Включить для гостей**. Each product format and establishment has its own scene. Uploaded photos and atlases survive menu and price edits. Ingredient, format-name or permanent-filling changes invalidate the atlas; changing price alone does not.

## Provider configuration

`BUILDER_IMAGE_API_KEY` (or existing `OPENAI_API_KEY`) enables automatic preparation using the OpenAI images/edit API. `BUILDER_IMAGE_MODEL` optionally selects a model supporting transparent PNG edits; default is `gpt-image-2.5-sunburst`. No browser credentials are used or exposed. Missing credentials return an explicit unavailable state; photos are still saved. No provider call is automatically retried. Each click/upload can incur image-generation usage. HTTP interruptions do not discard a completed server result: reopen settings and refresh the status. A process restart during generation permits retry after the five-minute lease expires.

Sources for the API contract: https://developers.openai.com/api/docs/guides/image-generation and https://developers.openai.com/api/reference/cli/resources/images/methods/edit . Live photo generation requires provider credentials and an uploaded restaurant photo; automated tests mock the provider and do not verify artistic fidelity.

## Persistence and boundaries

`shaurmeg_builder_cinema` is an additive table keyed by `establishment_id + type_id`. Owner and master access remain checked by the existing respective auth systems. Atlas drafts are not selected by the guest renderer until approved. Image URLs contain no credentials; these restaurant product images are public on active venues. Scene metadata, not base64 image bytes, is sent in menu context. Job IDs prevent a slow response from overwriting a newer uploaded photo. Menu/order identifiers and server-side price calculation are unchanged.

## Asset

`frontend/assets/builder-food-atlas.webp` was created using the built-in imagegen tool and encoded as WebP retaining alpha. Prompt: one 4×4 transparent food compositing atlas, same overhead camera and warm studio lighting, isolated realistic lavash, flatbread, chicken, beef, cabbage, tomatoes, cucumber, cheese, onion, jalapeno, fries, garlic sauce, cheese sauce, barbecue sauce and two finished dishes. No grid lines, labels, cartoon or CGI. The atlas is a generic fallback; per-venue processing uses the actual uploaded photo as its image-edit reference and the actual builder options as its layer list.
