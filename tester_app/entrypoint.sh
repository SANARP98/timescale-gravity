#!/bin/sh
set -e

# Ensure the shared /tmp volume is writable for the non-root appuser.
if [ -d /tmp ]; then
  chmod 777 /tmp || true
fi

exec gosu appuser "$@"
