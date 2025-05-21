#!/usr/bin/env fish

# This script is used to debug the fish shell.

set -l fish_trace 1

status --current-filename
status --current-line-number

$argv
