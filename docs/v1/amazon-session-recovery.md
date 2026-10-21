# Amazon session recovery (SQ-V1-004 follow-up)

Approved approach: installed Playwright/Zod, Node crypto/filesystem, and Chromium's
loopback remote inspection through SSH. No new production dependency. This is an
operator procedure, not a public remote browser or a staff-facing login form.

## What persists

The operator signs in to the configured Amazon Shipping account on the VM and
completes CAPTCHA/MFA personally. The CLI verifies the rates calculator and fresh
merchant/proposal/XSRF bootstrap, without requesting a rate, before saving state.
State is encrypted with AES-256-GCM, bound to `AMAZON_SHIPPING_EMAIL`, and written
atomically with mode 0600 into a private 0700 directory. Its separate 32-byte random
key is a private file. The files must be outside the checkout and Docker build context.

The worker restores cookies/local storage into each new browser context. It still
obtains fresh request tokens per quote; it never freezes an old XSRF token. Workers
only read snapshots, so they cannot overwrite a newly reconnected session. The
same snapshot works across worker/container restarts when its host mounts survive.
Amazon can invalidate it or request verification at any time; persistence does not
guarantee avoiding CAPTCHA. Local retention is bounded to **12 hours from save**,
without extending on reads. Expired state is unusable; reconnect replaces it and
`revoke` removes it. Key rotation invalidates all old state.

If either session path is configured, both paths and the configured account email
are required. Missing/expired/unreadable/rejected state stops Amazon quoting with
`verification_required`; there is no automatic password fallback. Other providers
continue. Without the opt-in configuration the legacy login path remains available,
but detected verification challenges still stop automatic relogin.

## One-time host preparation

These are deployment instructions, not evidence they have been applied to the VM.
Use the released backend image containing `dist/amazon-session-cli.js`. Keep exactly
one API and one worker; the operator container below runs only the CLI.

1. Create private host directories owned by the backend image's UID (the supplied
   image uses UID 1000). Run as that owner:

   ```sh
   install -d -m 700 "$HOME/.local/share/grd-amazon/session" "$HOME/.local/share/grd-amazon/key"
   install -m 600 /dev/null "$HOME/.local/share/grd-amazon/operator.env"
   ```

2. Edit `operator.env` with these non-password settings. Use the same Amazon email
   as the account you will manually sign into:

   ```dotenv
   AMAZON_SHIPPING_EMAIL=your-amazon-shipping-account-email
   AMAZON_SESSION_DIRECTORY=/run/grd-amazon/session
   AMAZON_SESSION_KEY_FILE=/run/grd-amazon/key/session.key
   AMAZON_SESSION_DEBUG_PORT=9222
   ```

3. Add the same email and session paths to the worker environment. Bind mount the
   two host directories into the matching container paths, read-only for the
   worker. Do not add a debug port to the API or worker. The operator uses the same
   paths with writable mounts. Keep both directories out of ordinary backups unless
   backup encryption/access and key handling have been explicitly selected.

4. In an SSH shell, select the exact released image, then define this operator helper:

   ```sh
   export GRD_BACKEND_IMAGE='replace-with-the-released-backend-image-tag'
   amazon_session() {
     docker run --rm -it --network host --read-only --tmpfs /tmp:rw,nosuid,nodev,size=512m \
       --shm-size=256m --env-file "$HOME/.local/share/grd-amazon/operator.env" \
       --mount "type=bind,src=$HOME/.local/share/grd-amazon/session,dst=/run/grd-amazon/session" \
       --mount "type=bind,src=$HOME/.local/share/grd-amazon/key,dst=/run/grd-amazon/key" \
       --entrypoint node "$GRD_BACKEND_IMAGE" dist/amazon-session-cli.js "$1"
   }
   amazon_session init
   ```

   `init` refuses to replace an existing key. Run it once only. Do not loosen file
   permissions to fix an ownership mismatch; make the mount owner match the image UID.

## Reconnect

1. From your computer, open the private SSH tunnel:

   ```sh
   ssh -F "$HOME/.ssh/config" -o ExitOnForwardFailure=yes -L 127.0.0.1:9222:127.0.0.1:9222 debian-vm
   ```

2. In the VM shell, use the helper above and run `amazon_session connect`.
   Chromium binds to VM loopback only, while `--network host` lets the SSH tunnel
   reach it. No Docker `-p`, public listening address, or reverse proxy is needed.

3. On your computer open `chrome://inspect/#devices`, enable network target
   discovery, and configure `localhost:9222`. Inspect the Amazon page and enable
   **Toggle screencast** if its view is hidden. Sign into the configured account and
   complete Amazon's challenge yourself. Confirm you are in the intended shipping
   account and reach the rates calculator. Do not buy labels or book shipments.

4. Return to the VM terminal and type `save`. The CLI reopens the protected
   calculator to verify the session, then encrypts the state. If validation fails,
   nothing is replaced; finish verification and type `save` again. Type `quit` to
   cancel. The browser closes on exit, interrupt, or the 15-minute operator deadline.

5. Close the SSH tunnel. Retry the Amazon comparison in the dashboard. A saved
   session or successful readiness check is not proof of a successful live rate;
   check the actual returned service, currency and total.

The debug interface controls a signed-in Amazon browser. Restrict VM SSH access
to trusted operators, keep port 9222 loopback-only, and close the session afterward.
Do not export personal-browser cookies, print tokens, or retain authentication captures.

## Revoke and troubleshoot

Run `amazon_session revoke` to delete the saved state. A quote already running in
memory may finish; subsequent attempts ask for reconnection. Run `connect` to save
a replacement. If the Amazon account email changes, reconnect under that account;
the old snapshot cannot decrypt under a different configured email.

If the debug port is occupied, close the old recovery session or set another
`AMAZON_SESSION_DEBUG_PORT` and use that port in both the tunnel and Chrome discovery.
Errors do not print underlying provider/file/decryption diagnostics or secrets.
Verify private permissions, UID ownership, both paths, matching account email/key,
available loopback port, and manual Amazon verification.

This feature covers quote execution and provider readiness. Historical account-default
refresh uses a separate login flow; new comparisons already require explicit senders.
Readiness retains its existing generic safe failure summary. No official API access,
provider activation, captcha bypass, database migration, or automatic deployment is included.

References: [Playwright authentication state](https://playwright.dev/docs/auth),
[Chromium remote inspection](https://developer.chrome.com/docs/devtools/remote-debugging/).
