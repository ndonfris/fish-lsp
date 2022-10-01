#!/usr/bin/fish -i


commandline -r "$argv";and commandline -f accept_autosuggestion
echo (commandline -poc)



