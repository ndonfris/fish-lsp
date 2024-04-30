#!/usr/bin/env fish

mkdir -p out
# date +"%m-%d-%+4Y - %I:%M%p" > out/build-time.txt
date +'%F %T' > out/build-time.txt