# Amazon session recovery (SQ-V1-004 follow-up)

Approved approach: installed Playwright/Zod, Node crypto/filesystem and private Unix
sockets, plus NestJS and React/MUI for staff verification. No new production dependency.
Use the [staff dashboard workflow](#staff-verification-in-the-dashboard) for supported
challenges; Chromium loopback inspection through SSH remains an operator fallback.

## What persists

An operator or authorized staff member completes CAPTCHA/MFA in the server-side
Amazon Shipping session. Recovery verifies the rates calculator and fresh
merchant/proposal/XSRF bootstrap, without requesting a rate, before saving state.
State is encrypted with AES-256-GCM, bound to `AMAZON_SHIPPING_EMAIL`, and written
atomically with mode 0600 into a private 0700 directory. Its separate 32-byte random
key is a private file. The files must be outside the checkout and Docker build context.

The worker restores cookies/local storage into each new browser context. It still
obtains fresh request tokens per quote; it never freezes an old XSRF token. Quote
and readiness attempts only read snapshots; explicit staff or operator recovery
writes a newly verified snapshot. The
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

## Staff verification in the dashboard

The approved staff workflow adds **Verify Amazon & retry** to the latest retryable
Amazon failure with reason `verification_required`. Staff manually interact with
the challenge image inside the dashboard. The worker signs in using its configured
Amazon credentials if the saved session has expired; credentials and cookies never
travel to the staff browser. There is no automatic CAPTCHA solver.

1. Open the saved comparison and choose **Verify Amazon & retry**.
2. Click the controls in the image. For text or an OTP, first click its field in
   the image, type into **Challenge answer or verification code**, then choose
   **Send answer** and the provider's submit control or **Enter**.
3. After the protected rates calculator is verified, the session is encrypted and
   the original attempt is retried through the existing retry endpoint. A stale
   ship date, changed provider eligibility, deleted comparison or concurrent retry
   can still block that retry; the saved shipment inputs are never rewritten.

Only one staff login session can control Amazon verification at a time. Quote,
readiness and historical sender-refresh calls share the Amazon account lock.
Other providers continue. Busy Amazon quotes fail with `verification_required`
and may be retried after the active verification finishes. The window expires
in ten minutes, or after sixty seconds without authenticated polling. Closing
it cancels the browser. Revoked/restricted sessions cannot retrieve further images;
a revocation during a pending API request also cancels recovery. If a revoked user
makes no further request, idle expiry cleans up within sixty seconds.

Dashboard input waits for any in-flight screenshot capture. If Amazon's challenge
is unchanged, the refreshed screenshot keeps the same frame token and the input is
then applied. If the challenge changes, the worker rejects the old token with
`stale_frame`; the dialog fetches the latest image and stays usable. A transient
`busy` response follows the same refresh path.

Each start/verified/cancelled/expired outcome records the staff external ID in the
worker's normal structured logs. Failed and recoverable session outcomes also include
only the safe verification error code. No challenge answer, image, cookie, password,
or provider response is logged or stored in the database. Images exist only in
transient response/UI memory. Successful verification saves only Amazon cookies
and local storage; third-party CAPTCHA state is discarded. The saved session still
expires after at most twelve hours and Amazon can revoke it sooner.

### Enable staff access once, during deployment

This is an opt-in runtime capability, not automatically enabled by the code change.
The previous SSH workflow remains an operator fallback.

- Initialize the existing private session/key with `amazon_session init` once.
  Configure the worker's `AMAZON_SHIPPING_EMAIL` and `AMAZON_SHIPPING_PASSWORD`.
  Keep the key mount read-only. For staff mode, change the **worker session mount
  to read-write**; the earlier read-only mount applies to operator-only mode.
- Create a separate private host directory for the bridge, mode `0700`, owned by
  the same non-root UID as the API and worker. Mount it at
  `/run/grd-amazon/bridge` into both containers, writable for the worker and
  accessible to the API. Do not place it in the checkout or Docker build context.
- Set `AMAZON_VERIFICATION_SOCKET=/run/grd-amazon/bridge/worker.sock` in **both**
  API and worker environments. The API must receive **only** this bridge mount;
  never give it the Amazon session/key mounts or Amazon credentials.
- Keep exactly one API and one worker, on the same host and runtime UID. The
  worker listens on a mode `0600` Unix socket, with no TCP/debug/VNC port to publish.
  Existing authenticated API routing carries the dialog. Use the normal protected
  dashboard transport; do not expose an unauthenticated challenge endpoint.
- Deploy both repositories and test with an actual staff account. Stop an operator
  CLI recovery before enabling/using staff recovery; CLI and worker do not share
  an inter-process account lock. After an unclean worker crash, if startup reports
  the socket is occupied, confirm the old worker is stopped before removing its
  stale socket and restarting. Never remove the socket of a running worker.

### Supported challenges and limitations

The remote view is fail-closed: only recognized verification containers on
`https://www.amazon.com/ap/cvf`, `/ap/mfa`, and `/ap/challenge` are displayed.
Recognized Amazon/Arkose challenge frames can receive bounded clicks, text, and
individual keys. Navigation, arbitrary selectors/scripts, browser shortcuts,
account links and password/email inputs are not exposed. Unsupported challenge
layouts and audio-only/drag-only challenges require the operator fallback.
Amazon markup changes may require updating the selectors; fixture success does
not establish compatibility with every live challenge.

An OTP sent to a phone/email still requires authorized access to that destination.
This workflow does not change the Amazon account's MFA destination or promise that
CAPTCHAs disappear. No database migration or new dependency is required.
