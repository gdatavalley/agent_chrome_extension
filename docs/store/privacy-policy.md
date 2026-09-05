# Privacy Policy — DRAFT for legal review

**Status: skeleton with the real data flows (spec §8.1). Must be hosted at a
public URL before store submission — that URL goes in the dashboard and
(optionally) `homepage_url`.**

Effective date: TBD · Contact: TBD

## What this extension does

[Product name] runs user-described tasks in the user's own browser, on sites
the user is already signed in to, showing every step and asking before
irreversible actions.

## The two modes, stated plainly

**Bring your own key (BYOK).** Page content travels directly from the user's
browser to the model provider the user chose (e.g. OpenAI). Our servers are
not in the path and never see page content, task text, or results. The
user's API key is encrypted on their machine with Web Crypto and is never
sent anywhere except that provider.

**Hosted credits.** Page content needed for each task step passes through our
server en route to the model provider. We do not train on it, we do not store
it, and we never log prompt content. We log metadata only: user ID, model,
token counts, cached-token count, latency, credits consumed, step number, and
a structural page fingerprint (page shape — roles and hierarchy — never page
text).

## What is stored, and where

- **On the user's machine:** task definitions, run history and checkpoints,
  page-structure memory (shape, not content), encrypted API keys, settings,
  credit meter. Viewable, exportable, and deletable in Settings → Your data.
- **On our servers (hosted mode only):** account email, credit balance, and
  the metadata-only usage ledger described above.

## What we never do

- We never log prompt content or page text.
- We never sell data, and never share it except with the model provider that
  processes the task the user asked for.
- We never read password fields; card and ID-number patterns are redacted
  before any content leaves the machine.
- Analytics are off unless the user opts in (Settings → Your data), and the
  opt-in states exactly what would be sent.

## Data retention and deletion

Account deletion (Settings → Account) removes the account, balance, and
usage ledger from our servers and all local data from the machine. Credits
are forfeit on deletion; this is stated in the product before confirmation.

## Model providers

Hosted traffic is processed by OpenAI under their API terms (no training on
API data; 30-day abuse-monitoring retention). BYOK traffic is governed by the
terms of whichever provider the user chose. Google Gemini free-tier keys are
actively warned against in the product because free-tier content may be used
for training.

## Changes

Material changes will be announced in the extension's release notes and on
this page with a new effective date.
