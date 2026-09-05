# Work — quickstart-now/hejbro#864

What was built, measured and reversed under the decisions, one entry per PR or group (`W#`). Managed by `blackbox add work`; append-only.

<a id="w1"></a>
## W1 — the pool and the checked-out client both needed silencing

_2026-09-05T00:51Z_

Found by the ld reviewer (constructor mode) while checking that no error
the server raises on the ledger reaches a user raw: terminating a backend
that held a waiting query killed the CLI with twelve raw stack frames.
The cause was not the ledger path at all — @hejbro/pg built its Pool with
no "error" listener, and Node treats an unhandled 'error' event as fatal,
so the process died before any catch in the CLI existed to run. Every
command that opens a connection was affected, not only a ledger read.

Two listeners were needed, measured against postgres:17-alpine rather
than reasoned: pool.on("error") covers idle clients only, and with just
that the reproduction still crashed on "Emitted 'error' event on Client
instance" — a checked-out client raises its own. The second listener is
attached per checkout, in execute and in transaction. Both are no-ops:
the waiting query still rejects through its own promise and travels the
ordinary path, and the listeners' only job is to stop Node from treating
the event as fatal.

The reproduction also corrected an assumption it was built on. It is not
the "failure carrying no server code" path: the server answers the
waiting query properly first, with 57P01 terminating connection due to
administrator command, and the crash came from a second, duplicate
'error' the client emits when the socket then closes, by which point the
query already has its answer. The witness therefore asserts that 57P01
and its message are rendered, not that a SQLSTATE clause is absent. The
code-less path is real (an idle client whose socket simply drops) and is
covered by unit rows.

Unit witness: a real pg.Client, queued without connecting, driven through
the internal path pg's own crash stack named; the query in flight rejects
with that error and nothing throws. Live witness: hold an ACCESS
EXCLUSIVE lock on the ledger, terminate the blocked backend, and status
ends with error[apply-ledger-unreadable] and no stack frame — reproduced
twice.

