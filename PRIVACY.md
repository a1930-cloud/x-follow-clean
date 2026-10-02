# Privacy Policy

Last updated: 2026-10-01

Follow Review is a third-party browser extension. It is not affiliated with X.

## Data handled

When the user starts collection on an X Following or Followers page, the extension may read publicly rendered profile usernames, display names, relationship indicators, expected counts, and local review/execution status. It does not read passwords, cookies, private messages, access tokens, Client Secrets, or content outside the selected list page.

## Storage and transmission

Collected data, review marks, and execution logs are stored in the browser's `chrome.storage.local`. The default build does not upload this data to the maintainer, an analytics provider, or a remote server. The user can export CSV/JSON locally.

## Permissions

- `activeTab`: read the page after the user invokes the extension.
- `scripting`: inspect the rendered page and perform an action only after the user confirms a selected batch.
- `storage`: save local lists, review marks, and logs.
- `https://x.com/*` optional host access: requested when the user starts the confirmed execution flow.

## User controls

Users can export their records, start a new local cycle, clear extension data through browser settings, or uninstall the extension. Exported files remain under the user's control and should not be committed to a public repository.

## Contact

For privacy questions, use the repository's public contact or security-report channel:
<https://github.com/a1930-cloud/x-follow-clean/security>.

## Changes

Material changes to data handling, permissions, or transmission will be documented in the changelog and reflected in this policy before release.
