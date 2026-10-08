# Customer web identity presentation

FB02-CW-PRESENTATION-01 adapts the email/password/registration panel presentation
from Enatega customer web at commit `d9eb29e8b32b6ec11ee038f94d43caa0eba54bab`.
Source: `lib/ui/screen-components/un-protected/authentication/{login-with-email,enter-password,signup-with-email}/index.tsx`
and `public/assets/images/svgs/email.tsx`. The upstream MIT notice is retained in
`LICENSE.upstream`.

Responsive narrow panels, email illustration, password visibility control and
rounded submit buttons use existing React and CSS dependencies. Dedicated
`/login` and `/register` routes preserve the existing real-stack test entry points.
Native form labels, autocomplete, Enter submission, visible keyboard focus and
live result announcements remain available. There is no modal in this slice.

The existing server BFF and shared identity contracts own authentication and
cookies. Explicit sign-in/register navigation replaces upstream account-existence
lookup. Registration retains the frozen display-name and password constraints;
new accounts remain unverified. Google, recovery and verification providers are
unavailable. No upstream Apollo, Firebase, Maps, Stripe or demo provider settings
are imported. Full upstream route/screen/action parity remains pending.

Verification must include real-stack identity Playwright tests, 375px and 1280px
layout inspection, keyboard/password-toggle behavior and negative login/outage
paths, followed by independent review. App static checks alone do not establish
phase completion or release readiness.
