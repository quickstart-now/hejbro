---
"@hejbro/pg": patch
---

integration harness only: the container readiness probe asks over TCP (`pg_isready -h 127.0.0.1`) instead of the unix socket, closing the cold-start window where the image's temporary init server answers on the socket while the host pool's TCP path has no listener. No runtime behavior change.
