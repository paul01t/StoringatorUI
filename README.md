# Storingator UI

Storingator UI is a React frontend for a personal account and password vault. It connects to the Storingator API for sign-in and vault operations.

## Features

- Sign in to an API account and manage its session.
- Create, view, and delete vault records with platform, username, email, password, and notes fields.
- Create, view, edit, and delete notes, revealing their contents with a passphrase.
- Export and restore vault records and notes using a locally encrypted backup file.
- Reveal a stored password after entering its passphrase, then copy it to the clipboard.
- Automatically clear revealed passwords and notes from the UI after 30 seconds.
- Apply a temporary, increasing wait after repeated failed sign-in attempts.

## Run Locally

Install a current version of Node.js and npm, then install dependencies and start the development server:

```sh
npm install
npm run dev
```

New vault records and notes use device encryption by default. To select the mode for newly created or edited items, set `VITE_ENCRYPT_ON_DEVICE` to `true` or `false` in a local `.env` file before starting/building the app. The default is `true`. Changing the setting requires restarting the dev server or rebuilding the app. Existing records keep their stored encryption mode; backup imports preserve the modes contained in the backup.

The Vite development server serves the frontend over HTTPS using a locally generated self-signed certificate. Open the HTTPS URL printed by Vite; your browser may warn about the certificate because it is for local development. The server does not provide an HTTP version of the app.

The dev server proxies `/api/v1` to `https://localhost:8888`, so the API backend must be running and reachable there. The local proxy skips backend certificate verification to support a self-signed development certificate; this applies only to Vite's development server. For production, use a valid certificate and configure the hosting server to redirect HTTP requests to HTTPS and send the Strict-Transport-Security (HSTS) response header. Vite's local certificate does not configure production hosting.

Useful commands:

```sh
npm run build
npm run preview
npm run lint
```

For production, serve the frontend over HTTPS and configure the hosting server to route `/api/v1` to the API. If the API is on another origin, update the Content Security Policy in `index.html` to allow that origin in `connect-src`, and configure the API's CORS policy appropriately.

## Security

### Protections in this frontend

- The Content Security Policy allows scripts from the app's own origin and blocks inline and third-party scripts. It also restricts other resource types. Inline styles are still allowed by the current policy.
- Authentication, vault, and notes API calls are blocked by the client helper when the page is served over non-local HTTP. This is a client-side safeguard, not a substitute for requiring HTTPS at the API and hosting layers.
- The bearer token, username, and session time are stored in `Secure`, `SameSite=Strict` cookies for 30 minutes, so a page refresh can restore the session. The frontend reads the token to attach Bearer headers, so the token cookie is JavaScript-readable and is not `HttpOnly`.
- The UI clears a revealed password from its state after 30 seconds and after copying. Copying still places the value on the system clipboard.
- API error response data is redacted for fields with secret-like names before it is logged.

### Important limitations

- When `VITE_ENCRYPT_ON_DEVICE=true` (the default), new or edited passwords and notes are encrypted in the browser with AES-GCM, using a key derived with PBKDF2-HMAC-SHA256 (600,000 iterations) from the passphrase, together with a random 16-byte salt and 12-byte IV. Only the ciphertext, salt, and IV are sent to the API — the passphrase is never transmitted, and the server never sees the plaintext. No third-party crypto library is required (the Web Crypto API's `crypto.subtle` is used). When set to `false`, content is encrypted by the server instead. The mode selector is intentionally not exposed in the UI.
- Backups are encrypted in the browser with AES-GCM and a key derived using PBKDF2-HMAC-SHA256 (600,000 iterations). Export asks for the original passphrase for each server-encrypted item, but does not store those passphrases in the backup. On restore, server-encrypted items are re-encrypted using one new passphrase; device-encrypted ciphertext and its original passphrase are preserved. Import adds copies and does not overwrite existing records. Losing the backup passphrase makes the backup unrecoverable.
- For server-side encryption, the frontend sends passwords, note content, and passphrases to the API over the connection. The backend is involved in encryption and decryption and can access plaintext when processing those requests.
- The bearer token is accessible to JavaScript. A cross-site scripting (XSS) vulnerability could read it and act as the signed-in user. The Content Security Policy is defense in depth, not a complete XSS solution.
- The `frame-ancestors` directive is present in the HTML meta policy, but browsers only enforce it when delivered as an HTTP response header. Configure it as a response header on the production host to prevent framing.
- The development proxy disables certificate verification. Production deployments must use valid TLS certificates and must not reuse this development proxy setting.
- Client-side checks and delays can be bypassed. The API must independently enforce authentication, authorization, HTTPS, and sign-in rate limits.

This frontend is intended for personal use and has not been independently security-audited. Review the backend implementation and deployment configuration before storing real credentials.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
