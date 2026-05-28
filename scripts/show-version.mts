#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import pkg from '../package.json' with { type: 'json' };
// Alternative for path resolution
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(dirname(__filename));

const isLongOpt = (opt: string) => opt.startsWith('--') && !isShortOpt(opt);
const isShortOpt = (opt: string) => opt.startsWith('-') && !opt.startsWith('--');
class Flag {
  constructor(
    public short?: string,
    public long?: string,
    public allowEquals?: boolean,
  ) { }

  static create(...rawOpts: string[]) {
    let [short, long, allowEquals] = ['', '', false];
    for (const opt of rawOpts) {
      if (isShortOpt(opt)) short = opt;
      if (isLongOpt(opt)) long = opt;
      if (opt.endsWith('=')) allowEquals = true;
    }
    return new Flag(short, long, allowEquals);
  }

  equalsFlag(arg: string) {
    if (this.long && arg.startsWith(this.long) && isLongOpt(arg)) return true;
    if (this.short && arg.includes(this.short.slice(1)) && isShortOpt(arg)) return true;
    return false;
  }

  equalsFlagValue(): boolean | string | undefined {
    if (!this.allowEquals) return process.argv.some(arg => this.equalsFlag(arg));
    for (let i = 0; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (this.equalsFlag(arg)) {
        if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
        if (!arg.includes('=') && process.argv.length < i + 1) return process.argv[i + 1];
      }
    }
    return undefined;
  }
}

const parseExecSync = (cmd: string) : [string, string][] => {
  return Object.entries(
    JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }))
  ) as [string, string][]
}


const completeOnly = Flag.create('--complete').equalsFlagValue();
const versionOnly = Flag.create('--version').equalsFlagValue();
const verboseOutput = Flag.create('--verbose').equalsFlagValue();
const isCurrentVersionPublished = Flag.create('--is-published').equalsFlagValue();
const isNotCurrentVersionPublished = Flag.create('--is-not-published').equalsFlagValue();
const onlyCurrentVersion =
  Flag.create('--only-local-version').equalsFlagValue()
  || Flag.create('--only-local').equalsFlagValue();

const onlyTagVersion = Flag.create('--tag=').equalsFlagValue() as undefined | string;

const pkgName = 'fish-lsp';

const possibleTags = parseExecSync(`npm view ${pkgName} dist-tags --json`)
const allTags = parseExecSync(`npm view ${pkgName} dist-tags --json`)
const times = parseExecSync(`npm view ${pkgName} time --json`)

const getTagResult = () => {
  const result = possibleTags.find(([tagname, version]) => version === onlyTagVersion || tagname === onlyTagVersion);
  if (!result) return null;
  const [tagname, tagver] = result;
  if (onlyTagVersion && tagname === onlyTagVersion) {
    return tagver;
  }
  if (onlyTagVersion && tagver === onlyTagVersion) {
    return tagver;
  }
};
const possibleTagResult = getTagResult();

const getVersionAndTimestamp = () => {
  let [version, timestamp] = times
    .filter(([k]) => !['created', 'modified'].includes(k))
    .sort(([, a], [, b]) => { return new Date(b).getTime() - new Date(a).getTime(); })[0];
  return [
    version,
    new Date(timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
  ];
};

if (onlyTagVersion && possibleTagResult) {
  for (const [tagName, tagVer] of allTags) {
    if (tagName === possibleTagResult || tagVer === possibleTagResult) {
      const res = times.find(([v,]) => v === tagVer || v === tagName)!;
      console.log([res[0], new Date(res[1]).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })].join('\t'));
      process.exit(0)
    }
  }
}

const [version, timestamp] = getVersionAndTimestamp();

if (completeOnly) {
  const prefixCompletion = [
    `complete -p ${__dirname}/scripts/show-version.mts`,
    `complete -c yarn -n '__fish_seen_subcommand_from show:version'`
  ]
  const suffixCompletions: string[] = [
    '-f',
    `-l complete -d 'show completions'`,
    `-l version -d 'show version'`,
    `-l verbose -d 'show verbose output'`,
    `-l is-not-published -d 'check if local version is not published'`,
    `-l is-published -d 'check if local version is published'`,
    `-l only-local-version -d 'show only the local version'`,
    `-l only-local -d 'show only the local version'`,
    `-l tag -d 'show only tag version' -xa 'nightly latest preminor'`
  ];
  prefixCompletion.forEach((prefix, i) => {
    console.log(`# ${i === 0 ? __dirname + '/scripts/latest-tagged.mts' : 'yarn show:version'}`)
    suffixCompletions.forEach(suffix => {
      console.log([prefix, suffix].join(' '))
    })
    console.log()
  })
  process.exit(0);
}
if (onlyCurrentVersion) {
  console.log(`${pkg.version}`);
  process.exit(0);
}

if (isCurrentVersionPublished) {
  const currentVersion = pkg.version;
  const [foundVersion] = (times.find(([version,]) => version === currentVersion) || ['', '']) as [string, string];
  if (verboseOutput) {
    if (currentVersion) console.log('Current Version: ', currentVersion);
    if (foundVersion) console.log('Found Version: ', foundVersion);
  }
  console.log(`${currentVersion} ${currentVersion === foundVersion ? 'ALREADY PUBLISHED' : 'NOT PUBLISHED YET!'}`);
  process.exit(foundVersion === currentVersion ? 0 : 1);
}


if (isNotCurrentVersionPublished) {
  const currentVersion = pkg.version;
  const [foundVersion] = (times.find(([version,]) => version === currentVersion) || ['', '']) as [string, string];
  if (verboseOutput) {
    if (currentVersion) console.log('Current Version: ', currentVersion);
    if (foundVersion) console.log('Found Version: ', foundVersion);
  }
  console.log(`${currentVersion} ${currentVersion === foundVersion ? 'ALREADY PUBLISHED' : 'NOT PUBLISHED YET!'}`);
  process.exit(foundVersion === currentVersion ? 1 : 0);
}


if (!!versionOnly && !verboseOutput) {
  console.log(version);
  process.exit(0);
}
console.log(`${version}\t${timestamp}`);
