#!/bin/sh
# Licence gate: fail if any installed package is GPL, AGPL or LGPL.
exec uv run pip-licenses --partial-match --fail-on "GPL;General Public License"
