/**
 * Interesting Fish Shell Test Inputs for Property-Based Testing
 *
 * This file contains a comprehensive collection of Fish shell code patterns
 * designed to test edge cases, complex parsing scenarios, and real-world usage patterns.
 */

export const FishShellTestInputs = {
  // Basic constructs
  basic: {
    simpleFunction: `function greet
  echo "Hello, $argv[1]!"
end`,

    variableAssignment: `set -g my_var "hello world"
set -l local_var 42
set -U universal_var "persistent"`,

    forLoop: `for i in 1 2 3 4 5
  echo "Number: $i"
  set result (math $i '*' 2)
  echo "Doubled: $result"
end`,

    ifStatement: `if test -f ~/.config/fish/config.fish
  echo "Config file exists"
else if test -d ~/.config/fish
  echo "Config directory exists"
else
  echo "No fish config found"
end`,

    commandSubstitution: `set current_dir (pwd)
set file_count (ls | wc -l)
echo "Files in $current_dir: $file_count"`,
  },

  // Complex nested structures
  nested: {
    nestedFunctions: `function outer_function
  set -l outer_var "outer"
  
  function inner_function
    set -l inner_var "inner"
    echo "$outer_var from $inner_var"
  end
  
  inner_function
  echo "Called from outer: $outer_var"
end`,

    nestedLoops: `for category in fruits vegetables grains
  echo "Category: $category"
  
  for item in apple banana carrot potato wheat rice
    if string match -q "*$category*" $item
      echo "  - $item belongs to $category"
    end
  end
end`,

    complexConditionals: `if test (count $argv) -eq 0
  echo "No arguments provided"
  return 1
else if test $argv[1] = "--help"
  echo "Usage: script [options] <file>"
  return 0
else if not test -f $argv[1]
  echo "Error: File '$argv[1]' not found"
  return 2
else
  echo "Processing file: $argv[1]"
  cat $argv[1] | while read -l line
    echo "Line: $line"
  end
end`,

    switchStatement: `switch $argv[1]
case "start"
  echo "Starting service..."
case "stop"
  echo "Stopping service..."
case "restart"
  echo "Restarting service..."
case "status"
  echo "Service status: running"
case "*"
  echo "Unknown command: $argv[1]"
  echo "Valid commands: start, stop, restart, status"
end`,
  },

  // Advanced Fish features
  advanced: {
    eventHandlers: `function on_directory_change --on-variable PWD
  echo "Changed directory to $PWD"
  if test -f .fish_prompt
    source .fish_prompt
  end
end

function cleanup_on_exit --on-event fish_exit
  echo "Cleaning up before exit..."
  set -e TEMP_VAR
end`,

    argumentParsing: `function complex_command --argument-names input output --inherit-variable PATH
  argparse 'h/help' 'v/verbose' 'f/force' 'o/output=' 'c/config=' -- $argv
  or return 1
  
  if set -q _flag_help
    echo "Usage: complex_command [options] input [output]"
    return 0
  end
  
  if set -q _flag_verbose
    echo "Verbose mode enabled"
  end
  
  if set -q _flag_config
    echo "Using config file: $_flag_config"
  end
end`,

    completionDefinitions: `complete -c mycommand -s h -l help -d "Show help"
complete -c mycommand -s v -l verbose -d "Enable verbose output"
complete -c mycommand -s f -l file -r -d "Specify input file"
complete -c mycommand -s o -l output -r -d "Specify output file"
complete -c mycommand -l config -r -F -d "Config file"`,

    aliasDefinitions: `alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias ..='cd ..'
alias ...='cd ../..'
alias grep='grep --color=auto'`,

    abbreviations: `abbr -a gco git checkout
abbr -a gst git status
abbr -a gca git commit -am
abbr -a gcm git commit -m
abbr -a gp git push
abbr -a gl git log --oneline`,
  },

  // Error-prone and edge cases
  edgeCases: {
    emptyFunctions: `function empty_function
end

function whitespace_only
  
  
end`,

    specialCharacters: `set special_var "hello\nworld\ttab"
echo 'Single quotes with $variable'
echo "Double quotes with $USER"
echo 'Mixed "quotes" and $vars'`,

    complexVariableExpansions: `set -l list_var one two three "four five"
echo $list_var[1]
echo $list_var[2..3]
echo $list_var[-1]
echo (count $list_var)`,

    pipeChains: `ls -la | grep "\.fish$" | wc -l
cat file.txt | sort | uniq | head -10
echo "test" | string replace "test" "replaced" | string upper`,

    backgroundProcesses: `sleep 10 &
set job_id $last_pid
echo "Started background job: $job_id"
jobs`,

    errorHandling: `begin
  set -l temp_file (mktemp)
  echo "Using temp file: $temp_file"
  
  if not test -w $temp_file
    echo "Cannot write to temp file"
    exit 1
  end
  
  echo "data" > $temp_file
  cat $temp_file
end`,

    heredocuments: `cat << 'EOF'
This is a heredoc
with multiple lines
and $variables that won't expand
EOF

cat << EOF
This is a heredoc
with $USER variable expansion
EOF`,
  },

  // Real-world scenarios
  realWorld: {
    gitWorkflow: `function git_workflow
  if not git rev-parse --git-dir > /dev/null 2>&1
    echo "Not in a git repository"
    return 1
  end
  
  set -l current_branch (git branch --show-current)
  echo "Current branch: $current_branch"
  
  if test $current_branch = "main" -o $current_branch = "master"
    echo "On main branch, creating feature branch..."
    read -P "Feature branch name: " feature_name
    git checkout -b "feature/$feature_name"
  end
  
  git status --porcelain | while read -l status_line
    echo "Modified: $status_line"
  end
end`,

    systemAdmin: `function system_info
  echo "=== System Information ==="
  echo "Hostname: "(hostname)
  echo "User: $USER"
  echo "Home: $HOME"
  echo "Shell: $SHELL"
  echo "Date: "(date)
  
  if command -sq lscpu
    echo "=== CPU Information ==="
    lscpu | head -5
  end
  
  if test -f /proc/meminfo
    echo "=== Memory Information ==="
    grep -E "MemTotal|MemAvailable" /proc/meminfo
  end
end`,

    configManagement: `function fish_config_backup
  set -l config_dir ~/.config/fish
  set -l backup_dir ~/fish_config_backup_(date +%Y%m%d_%H%M%S)
  
  if not test -d $config_dir
    echo "No fish config directory found"
    return 1
  end
  
  echo "Backing up fish config to $backup_dir"
  mkdir -p $backup_dir
  
  for file in $config_dir/**
    if test -f $file
      set -l relative_path (string replace $config_dir/ "" $file)
      set -l target_dir (dirname $backup_dir/$relative_path)
      mkdir -p $target_dir
      cp $file $backup_dir/$relative_path
      echo "Backed up: $relative_path"
    end
  end
  
  echo "Backup complete!"
end`,

    packageManager: `function pkg_manager
  set -l action $argv[1]
  set -l packages $argv[2..]
  
  switch (uname)
  case "Linux"
    if command -sq apt
      set -l cmd apt
    else if command -sq yum
      set -l cmd yum
    else if command -sq pacman
      set -l cmd pacman
    end
  case "Darwin"
    if command -sq brew
      set -l cmd brew
    else if command -sq port
      set -l cmd port
    end
  end
  
  if not set -q cmd
    echo "No package manager found"
    return 1
  end
  
  switch $action
  case "install"
    sudo $cmd install $packages
  case "remove"
    sudo $cmd remove $packages
  case "search"
    $cmd search $packages
  case "*"
    echo "Unknown action: $action"
    return 1
  end
end`,
  },

  // Malformed and stress test cases
  stressTest: {
    deeplyNested: `function level1
  function level2
    function level3
      function level4
        function level5
          echo "Deep nesting test"
        end
        level5
      end
      level4
    end
    level3
  end
  level2
end`,

    longLines: 'set very_long_variable_name "This is a very long string that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on"',

    manyArguments: `function many_args
  for arg in $argv[1] $argv[2] $argv[3] $argv[4] $argv[5] $argv[6] $argv[7] $argv[8] $argv[9] $argv[10] $argv[11] $argv[12] $argv[13] $argv[14] $argv[15] $argv[16] $argv[17] $argv[18] $argv[19] $argv[20]
    echo "Arg: $arg"
  end
end`,

    complexRegex: 'string match -r \'^\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\s+--[a-zA-Z-]+(?:\s+\S+)*)*\s*$\' $line',

    unicodeStrings: `set unicode_var "Hello 🐠 Fish Shell! 中文测试 αβγδε"
echo "Unicode test: $unicode_var"`,
  },

  // Malformed code for robustness testing
  malformed: {
    incompleteFunction: `function incomplete_func
  echo "Missing end"`,

    unbalancedQuotes: `echo "unbalanced quote
set var 'another unbalanced`,

    invalidSyntax: `set -
for
if then
function 123invalid
end without begin`,

    mixedUpKeywords: `end function start
for if in while
case switch break continue`,

    emptyBlocks: `if
end
for in
end
function
end`,

    badVariableNames: `set 123invalid "bad"
set -invalid "bad"
set "" "empty"
set "spa ced" "bad"`,

    recursiveInclusion: `source $HOME/.config/fish/config.fish
source (status --current-filename)`,
  },

  // Comments and documentation
  documentation: {
    docstrings: `# This is a comprehensive example function
# It demonstrates various Fish shell features
# @param name The name to greet
# @param count How many times to greet
# @return 0 on success, 1 on error
function documented_function --argument-names name count
  # Validate input parameters
  if test (count $argv) -lt 2
    echo "Error: Not enough arguments" >&2
    return 1
  end
  
  # Main logic with inline comments
  for i in (seq 1 $count) # Loop from 1 to count
    echo "Hello, $name! (iteration $i)" # Greet the user
  end
  
  return 0 # Success
end`,

    mixedComments: `#!/usr/bin/env fish
# Shebang line above

function example # Inline comment
  # Full line comment
  echo "test" # Another inline comment
  
  ## Multi-hash comment
  ### Even more hashes
  
  # TODO: Implement feature X
  # FIXME: This needs to be fixed
  # NOTE: Important information here
end`,
  },

  // Configuration file examples
  config: {
    fishPrompt: `function fish_prompt
  set -l last_status $status
  
  # Show current directory
  set_color cyan
  echo -n (prompt_pwd)
  
  # Show git branch if in git repo
  if git rev-parse --git-dir >/dev/null 2>&1
    set_color yellow
    echo -n " ("(git branch --show-current)")"
  end
  
  # Show error status
  if test $last_status -ne 0
    set_color red
    echo -n " [$last_status]"
  end
  
  set_color normal
  echo -n " \$ "
end`,

    fishGreeting: `function fish_greeting
  set_color blue
  echo "Welcome to Fish Shell!"
  set_color normal
  
  if test (date +%H) -lt 12
    echo "Good morning, $USER!"
  else if test (date +%H) -lt 18
    echo "Good afternoon, $USER!"
  else
    echo "Good evening, $USER!"
  end
  
  echo "Today is "(date "+%A, %B %d, %Y")
end`,

    pathManagement: `# Add custom paths
set -gx PATH /usr/local/bin $PATH
set -gx PATH $HOME/.local/bin $PATH
set -gx PATH $HOME/bin $PATH

# Language-specific paths
if test -d $HOME/.cargo/bin
  set -gx PATH $HOME/.cargo/bin $PATH
end

if test -d $HOME/go/bin
  set -gx PATH $HOME/go/bin $PATH
end

if test -d $HOME/.npm-global/bin
  set -gx PATH $HOME/.npm-global/bin $PATH
end`,

    environmentVars: `# Development environment
set -gx EDITOR vim
set -gx BROWSER firefox
set -gx PAGER less

# Language environments
set -gx GOPATH $HOME/go
set -gx CARGO_HOME $HOME/.cargo
set -gx NPM_CONFIG_PREFIX $HOME/.npm-global

# Application settings
set -gx LESS "-R"
set -gx GREP_OPTIONS "--color=auto"
set -gx LS_COLORS "di=34:ln=35:so=32:pi=33:ex=31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"`,
  },
} as const;

// Export individual categories for easier testing
export const basicInputs = FishShellTestInputs.basic;
export const nestedInputs = FishShellTestInputs.nested;
export const advancedInputs = FishShellTestInputs.advanced;
export const edgeCaseInputs = FishShellTestInputs.edgeCases;
export const realWorldInputs = FishShellTestInputs.realWorld;
export const stressTestInputs = FishShellTestInputs.stressTest;
export const malformedInputs = FishShellTestInputs.malformed;
export const documentationInputs = FishShellTestInputs.documentation;
export const configInputs = FishShellTestInputs.config;

// Utility function to get all inputs as an array
export function getAllTestInputs(): string[] {
  const allInputs: string[] = [];

  for (const category of Object.values(FishShellTestInputs)) {
    for (const input of Object.values(category)) {
      allInputs.push(input);
    }
  }

  return allInputs;
}

// Utility function to get inputs by category
export function getInputsByCategory(category: keyof typeof FishShellTestInputs): string[] {
  return Object.values(FishShellTestInputs[category]);
}

// Utility function to get random input
export function getRandomTestInput(): string {
  const allInputs = getAllTestInputs();
  const randomIndex = Math.floor(Math.random() * allInputs.length);
  return allInputs[randomIndex]!;
}

// Categorized input arrays for specific test scenarios
export const PARSING_TEST_INPUTS = [
  ...Object.values(basicInputs),
  ...Object.values(nestedInputs),
  ...Object.values(advancedInputs),
];

export const EDGE_CASE_TEST_INPUTS = [
  ...Object.values(edgeCaseInputs),
  ...Object.values(stressTestInputs),
];

export const ROBUSTNESS_TEST_INPUTS = [
  ...Object.values(malformedInputs),
];

export const REAL_WORLD_TEST_INPUTS = [
  ...Object.values(realWorldInputs),
  ...Object.values(configInputs),
];

export default FishShellTestInputs;
