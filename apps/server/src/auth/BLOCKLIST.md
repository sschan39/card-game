# Offline password blocklist

Source: [SecLists xato-net top 10,000](https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt), retrieved 26 October 2026. Source file SHA-256: `c63d5e4ccc31344d662583cc39ca4bd5bd20517ff1d24501f0c4e0c22d9b722a`.

The bundled JSON contains 9920 unique SHA-256 values after NFC normalization and case folding. It also includes four explicitly weak long examples: passwordpassword, 123456789012345, qwertyuiopasdfgh and correcthorsebatterystaple. These are public weak-password examples, not application credentials. Full-list comparison happens offline, with no user password sent to a breach service. The 15-character minimum rejects most short list entries independently. This is a bounded common/breached-password list, not an exhaustive breach corpus. Refresh its upstream snapshot as part of password-policy maintenance.

SecLists is MIT licensed; the notice is preserved in [BLOCKLIST-LICENSE.txt](BLOCKLIST-LICENSE.txt).
