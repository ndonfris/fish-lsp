const StatusFlagsToSubcommands = new Map<string, string[]>();
const StatusSubcommandsToFlags = new Map<string, string[]>();
const allStatusFlags = new Set<string>();

const statusSubcommands = {
  ['is-command-substitution']: ['-c', '--is-command-substitution'],
  ['is-block']: ['-b', '--is-block'],
  ['is-interactive']: ['-i', '--is-interactive'],
  ['is-interactive-read']:  ['--is-interactive-read'],
  ['is-login']: ['-l', '--is-login'],
  ['is-full-job-control']:  ['--is-full-job-control'],
  ['is-interactive-job-control']: ['--is-interactive-job-control'],
  ['is-no-job-control']: ['--is-no-job-control'],
  ['filename']: ['-f', '--filename'],
  ['current-filename']: ['-f', '--current-filename'],
  ['line-number']: ['-n', '--line-number'],
  ['current-line-number']: ['-n', '--current-line-number'],
  ['stack-trace']: ['-t', '--print-stack-trace'],
  ['print-stack-trace']: ['-t', '--print-stack-trace'],
  ['job-control']: ['-j', '--job-control'],
} as const;

for (const [subcommand, flags] of Object.entries(statusSubcommands)) {
  StatusSubcommandsToFlags.set(subcommand, [...flags]);
  flags.forEach(flag => {
    const subcommandsForFlag = StatusFlagsToSubcommands.get(flag) || [];
    subcommandsForFlag.push(subcommand);
    StatusFlagsToSubcommands.set(flag, subcommandsForFlag);
    allStatusFlags.add(flag);
  });
}

export namespace StatusArgs {
  export const subcommandsToFlags = StatusSubcommandsToFlags;
  export const flagsToSubcommands = StatusFlagsToSubcommands;
  export const allFlags = allStatusFlags;

  export function findSubcommandFromFlag(flag: string): string | undefined {
    if (!allStatusFlags.has(flag)) return undefined;
    const subcmds = StatusFlagsToSubcommands.get(flag) || [];
    return subcmds.reduce(
      (longest, current) => current.length > longest.length ? current : longest,
      '',
    );
  }
}
