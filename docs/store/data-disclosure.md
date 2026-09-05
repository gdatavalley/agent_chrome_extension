# CWS Data Usage Disclosure — worksheet

Answers for the developer dashboard's data-use form (spec §12: the form must
match actual behaviour — misrepresentation gets you removed, not rejected).
Review against the code before submitting.

| Question | Answer | Notes |
|---|---|---|
| Collects user data? | **Yes** (hosted mode); limited (BYOK) | Be precise — the form's categories matter |
| Personally identifiable info (email) | Yes — account email, hosted mode only | For authentication and billing |
| Website content (page text, etc.) | **Yes — processed, not stored** | Hosted mode: in transit to the model provider; never logged. BYOK: never touches our servers |
| Browsing history | No | Runs touch only tabs the user started a task on |
| User activity (clicks etc.) | Metadata only — step counts, credits, latency | Never page content |
| Location | No | |
| Data sold to third parties? | **No** | |
| Data shared with third parties? | Yes — the model provider processing the task (OpenAI API) | Disclose as "service provider" processing |
| Data used for advertising? | No | |
| Data used for analytics? | Only with explicit opt-in | Settings → Your data; off by default |
| Encryption in transit? | Yes (TLS) | |
| Data deletion mechanism? | Yes — in-product full account deletion (Settings → Account) | GDPR: not optional |
