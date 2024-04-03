import { exec, execSync, spawn, spawnSync, SpawnSyncOptionsWithBufferEncoding, SpawnSyncOptionsWithStringEncoding } from 'child_process';

export const BuiltInList = [
  '[',
  '_',
  'and',
  'argparse',
  'begin',
  'bg',
  'bind',
  'block',
  'break',
  'breakpoint',
  'builtin',
  'case',
  'cd',
  'command',
  'commandline',
  'complete',
  'contains',
  'continue',
  'count',
  'disown',
  'echo',
  'else',
  'emit',
  'end',
  'eval',
  'exec',
  'exit',
  'false',
  'fg',
  'for',
  'function',
  'functions',
  'history',
  'if',
  'jobs',
  'math',
  'not',
  'or',
  'path',
  'printf',
  'pwd',
  'random',
  'read',
  'realpath',
  'return',
  'set',
  'set_color',
  'source',
  'status',
  'string',
  'switch',
  'test',
  'time',
  'true',
  'type',
  'ulimit',
  'wait',
  'while',
];

// You can generate this list by running `builtin --names` in a fish session
// note that '.', and ':' are removed from the list because they do not contain
// a man-page
const BuiltInSET = new Set(BuiltInList);

// check if string is one of the default fish builtin functions
export function isBuiltin(word: string): boolean {
  return BuiltInSET.has(word);
}

export function findShell() {
  const result = spawnSync('which fish', { shell: true, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf-8' });
  return result.stdout.toString().trim();
}
const fishShell = findShell();

const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
  shell: fishShell,
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf-8',
};

function createFunctionNamesList() {
  const result = spawnSync('functions --names | string split -n \'\\n\'', spawnOpts);
  return result.stdout.toString().split('\n');
}
export const FunctionNamesList = createFunctionNamesList();
export function isFunction(word: string): boolean {
  return FunctionNamesList.includes(word);
}
function createFunctionEventsList() {
  const result = spawnSync('functions --handlers | string match -vr \'^Event \\w+\' | string split -n \'\\n\'', spawnOpts);
  return result.stdout.toString().split('\n');
}

export const EventNamesList = createFunctionEventsList();
export function isEvent(word: string): boolean {
  return EventNamesList.includes(word);
}

function createAbbrList() {
  const { stdout } = spawnSync('abbr --show', spawnOpts);
  return stdout.toString().split('\n');
}
export const AbbrList = createAbbrList();

function createGlobalVariableList() {
  const { stdout } = spawnSync('set -n', spawnOpts);
  return stdout.toString().split('\n');
}

export const GlobalVariableList = createGlobalVariableList();

//function createAliasList() {
//    // `alias | string unescape | string shorten -m 100`
//    const {stdout} = spawnSync(`alias | string unescape --style=var | string split -n '\\n'`, spawnOpts)
//    return stdout.toString().split('\n')
//}
//export const AliasList = createAliasList()

// cd /usr/share/fish/completions/
// for i in (rg -e '-a' -l); echo (string split -f 1 '.fish' -m1 $i);end
// commands with potential subcommands
//  • string split ...
//  • killall node
//  • man vim
//  • command fish

// useful when checking the current Command for documentation/completion
// suggestions. If a match is hit, check one more node back, and if it is
// not a command, stop searching backwards.
export function hasPossibleSubCommand(cmd: string) : boolean {
  return SubCommandSet.has(cmd);
}

const PossibleSubCommand = [
  'mogrify',
  'apt-zip-inst',
  'help',
  'tar',
  'lz4cat',
  'flatpak',
  'openssl',
  'fusermount',
  'type',
  'msgfmt',
  'msfdb',
  'als',
  'travis',
  'rsync',
  'yarn',
  'apt-build',
  'timedatectl',
  'transmission-remote',
  'ls',
  'useradd',
  'ifdown',
  'xbps-remove',
  'chgrp',
  'time',
  'dscacheutil',
  'mosh',
  'apk',
  'ulimit',
  'cmark',
  'busctl',
  'setsid',
  'expect',
  'rmdir',
  'qdbus',
  'apt-zip-list',
  'homectl',
  'test',
  'which',
  'mpc',
  'exa',
  'portmaster',
  'ng',
  'jhipster',
  'tokei',
  'apt-ftparchive',
  'bzcat',
  'mdbook',
  'xbps-alternatives',
  'apt-listbugs',
  'bootctl',
  'apt',
  'date',
  'lscpu',
  'pandoc',
  'apt-cache',
  'sphinx-apidoc',
  'pacaur',
  'tig',
  'wpa_cli',
  'defaults',
  'mkdosfs',
  'modinfo',
  'virsh',
  'sshfs',
  'xbps-create',
  'pkgrm',
  'trap',
  'hjson',
  'iconv',
  'pinky',
  'xrandr',
  'createdb',
  'as',
  'pg_dumpall',
  'ansible-vault',
  'unexpand',
  'powershell',
  'chronyc',
  'makensis',
  'clean',
  'alsamixer',
  'ansible-galaxy',
  'localectl',
  'apt-src',
  'port',
  'sass-convert',
  'tmutil',
  'opkg',
  'xprop',
  'rpm',
  'avifenc',
  'grub-file',
  'npm',
  'keepassxc-cli',
  'cpupower',
  'djview',
  'gcc',
  'ipset',
  'sphinx-autogen',
  'wvdial',
  'ps',
  'gem',
  'ffprobe',
  'bower',
  'w',
  'feh',
  'pacisAbbr(line)',
  'asp',
  'wajig',
  'bosh',
  'zopflipng',
  'gradle',
  'git-sizer',
  'dpkg',
  'cd',
  'attrib',
  'rakudo',
  'hostnamectl',
  'rst2s5',
  'whatis',
  'xgettext',
  'tsc',
  'ls_original',
  'meson',
  'subl',
  'ttx',
  'xclip',
  'pg_dump',
  'sudo',
  'evince',
  'ant',
  'julia',
  'figlet',
  'pacmd',
  'lpinfo',
  'ip',
  'pg_restore',
  'lxc',
  'umount',
  'groups',
  'windscribe',
  'systemd-nspawn',
  'fd',
  'bzip2',
  'hledger',
  'qmk',
  'bg',
  'phpunit',
  'ruby-build',
  'mariner',
  'commandline',
  'octave',
  'isatty',
  'mkvextract',
  'ansible-playbook',
  'hg',
  'conda',
  'speedtest-cli',
  'az',
  'avifdec',
  'tail',
  'sphinx-build',
  'cvs',
  'pipenv',
  'argparse',
  'df',
  'dconf',
  'emerge',
  'cleanmgr',
  'asd',
  'nmcli',
  'traceroute',
  'acat',
  'mkinitcpio',
  'sysctl',
  'alacritty',
  'aptitude',
  'networkctl',
  'setxkbmap',
  'gsettings',
  'dropdb',
  'aunpack',
  'btrfs',
  'status',
  'gnome-extensions',
  'fg',
  'cowthink',
  'rfkill',
  'scons',
  'gunzip',
  'caffeinate',
  'qubes-gpg-client',
  'svn',
  'mutt',
  'mysql',
  'lz4',
  'pabcnetcclear',
  'icdiff',
  'gio',
  'dart',
  'completions/lsd',
  'snap',
  'cwebp',
  'nice',
  'sv',
  'p4',
  'apropos',
  'grub-mkrescue',
  'lein',
  'ebuild',
  'code',
  'zfs',
  'mkbundle',
  'apt-show-source',
  'open',
  'functions',
  'apm',
  'dub',
  'pygmentize',
  'mdadm',
  'python3',
  'apt-spy',
  'sfdx',
  'kcmshell5',
  'pyenv',
  'djview4',
  'zstdcat',
  'invoke-rc.d',
  'climate',
  'terraform',
  'losetup',
  'bind',
  'hashcat',
  'sbt',
  'resolvectl',
  'wesnoth',
  'pzstd',
  'set_color',
  'bundle',
  'firewall-cmd',
  'alsactl',
  'cygpath',
  'nethack',
  'pine',
  'dhcpcd',
  'ffmpeg',
  'ngrok',
  'mono',
  'cmd',
  'mix',
  'sphinx-quickstart',
  'ports',
  'tracepath',
  'apt-listchanges',
  'udisksctl',
  'ps2pdf',
  'yum',
  'screen',
  'rustc',
  'cp',
  'diff',
  'xbps-uhelper',
  'mupdf',
  'tcpdump',
  'alternatives',
  'shortcuts',
  'killall',
  'cmdkey',
  'find',
  'go',
  'userdbctl',
  'cat',
  'apt-config',
  'hugo',
  'root',
  'bluetoothctl',
  'canto',
  'entr',
  'scp',
  'cowsay',
  'man',
  'base64',
  'stack',
  'curl',
  'obnam',
  'k3d',
  'combine',
  'mplayer',
  'gprof',
  'cabal',
  'perl',
  'kldload',
  'adduser',
  'VBoxHeadless',
  'minikube',
  'fossil',
  'sftp',
  'optipng',
  'matlab',
  'tmuxinator',
  'ack',
  'j',
  'setfacl',
  'rmmod',
  'scss',
  'kak',
  'rst2odt',
  'exit',
  'zstdmt',
  'topgrade',
  'path',
  'apt-cdrom',
  'env',
  'dhclient',
  'zpaq',
  'netctl',
  'duply',
  'zpool',
  'configure',
  'netctl-auto',
  'vim',
  'darcs',
  'findstr',
  'pkginfo',
  'unzstd',
  'apt-show-versions',
  'ruby',
  'make',
  'xbps-query',
  'ncat',
  'return',
  'rustup',
  'xpdf',
  'telnet',
  'apt-setup',
  'sylpheed',
  'asciidoctor',
  'cygstart',
  'xz',
  'ifup',
  'kill',
  'kitty',
  'dig',
  'tuned-adm',
  'ifconfig',
  'string',
  'ln',
  'pushd',
  'loginctl',
  'sops',
  'cdrecord',
  'youtube-dl',
  'efibootmgr',
  'less',
  'mdimport',
  'quilt',
  'djxl',
  'kdeconnect-cli',
  'apt-proxy-import',
  'coredumpctl',
  'nvram',
  'wicd-gtk',
  'winemaker',
  'src',
  'wg-quick',
  'machinectl',
  'vagrant',
  'xbps-fbulk',
  'composer',
  's3cmd',
  'caddy',
  'choice',
  'gitk',
  'pkg-config',
  'exercism',
  'ninja',
  'gapplication',
  'apt-mark',
  'identify',
  'csharp',
  'yaourt',
  'dmesg',
  'xinput',
  'iw',
  'objdump',
  'systemctl',
  'create_ap',
  'cargo',
  'zef',
  'service',
  'chsh',
  'vim-addons',
  'setx',
  'xbps-uchroot',
  'grub-install',
  'opam',
  'set',
  'mtr',
  'ssh',
  'nmap',
  'magento',
  'apt-key',
  'ranger',
  'timeout',
  'pv',
  'mkdocs',
  'du',
  'wget',
  'comp',
  'spago',
  'exif',
  'mvn',
  'mdutil',
  'sysbench',
  'psql',
  'mpv',
  'xargs',
  'lua',
  '7z',
  'zcat',
  'eopkg',
  'bunzip2',
  'top',
  'bd',
  'funcsave',
  'pacman',
  'read',
  'aws',
  'dvipdfm',
  'gresource',
  'mdfind',
  'journalctl',
  'prt-get',
  'prime-run',
  'doas',
  'fish',
  'equery',
  'connmanctl',
  'VBoxSDL',
  'nodeenv',
  'heroku',
  'ezjail-admin',
  'nm',
  'tex',
  'zypper',
  'fish_config',
  'latexmk',
  'gdb',
  'navi',
  'yast2',
  'attributes',
  'abook',
  'fdfind',
  'iptables',
  'python',
  'arp',
  'light',
  'bzip2recover',
  'at',
  'gdbus',
  'htop',
  'yadm',
  'adb',
  'john',
  'arc',
  'mount',
  'apt-get',
  'flac',
  'convert',
  'lsusb',
  'uniq',
  'gzip',
  'unrar',
  'patch',
  'gendarme',
  'history',
  'cryptsetup',
  'fzf',
  'cf',
  'modprobe',
  'tr',
  'gphoto2',
  'git',
  'systemd-analyze',
  'python2',
  'keybase',
  'dotnet',
  'kitchen',
  'color',
  'apt-file',
  'xsp',
  'mocp',
  'grep',
  'tmux',
  'sass',
  'su',
  'xterm',
  'dpkg-reconfigure',
  'apt-move',
  'ffplay',
  'xbps-install',
  'diskutil',
  'schtasks',
  'archlinux-java',
  'xdvi',
  'castnow',
  'roswell',
  'valgrind',
  'pkg_info',
  'bzr',
  'mv',
  'cygport',
  'lunchy',
  'dnf',
  'forfiles',
  'wicd-client',
  'display',
  'clang',
  'dvipdf',
  'cjxl',
  'acpi',
  'reg',
  'patool',
  'chown',
  'unlz4',
  'ansible',
  'vared',
  'xbps-dgraph',
  'passwd',
  'xbps-reconfigure',
  'i3-msg',
  'fastboot',
  'zstd',
  'pkg_delete',
  'rbenv',
  'fab',
];
const SubCommandSet = new Set(...PossibleSubCommand);
