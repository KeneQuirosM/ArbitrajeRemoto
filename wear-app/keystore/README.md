# debug.keystore

Fixed **debug** signing key for ArbitrajeRemoto Reloj, committed on purpose so that every debug APK
(GitHub Actions or a local build) has the same signature and `adb install -r` updates the app without
uninstalling it (uninstalling would erase the pairing and the local matches).

- Store/key password: `android`, alias: `androiddebugkey` (Android's standard debug values), PKCS12.
- Not secret and **not for release builds**: a release must use a private key kept out of the repo.
- Certificate SHA-256: `31:A8:33:AF:BD:F5:4B:51:AC:BA:1F:A8:D6:01:EF:7B:19:CA:01:F8:E8:63:6D:9A:EF:A1:20:94:75:B1:D3:3C` (the CI prints it on every build).
