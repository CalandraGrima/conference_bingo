#!/usr/bin/env bash
# Preview the site on your computer. Open http://localhost:8000 and press Ctrl+C to stop.
# Use a different port with:  ./test_local_site.sh 8080
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
echo "Serving on http://localhost:${PORT}  (add ?check to the address to check your terms)"
exec python3 -m http.server "$PORT"
