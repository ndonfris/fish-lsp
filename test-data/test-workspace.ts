
import { TextDocumentItem } from 'vscode-languageserver';
import { LspDocuments } from '../src/document';
import * as path from 'path';
import * as os from 'os';

export interface FishFileDefinition {
  relativePath: string;
  content: string;
}

function createFishWorkspace(
  baseDir: string = path.join(os.homedir(), '.config', 'fish'),
  ...files: FishFileDefinition[]
): LspDocuments {
  const workspace = new LspDocuments();

  files.forEach((file) => {
    const fullPath = path.join(baseDir, file.relativePath);
    const uri = `file://${fullPath}`;

    const document: TextDocumentItem = {
      uri,
      languageId: 'fish',
      version: 1,
      text: file.content,
    };

    workspace.open(uri, document);
  });

  return workspace;
}

const user_dir: string = path.join(os.homedir(), '.config', 'fish');
const workspace = createFishWorkspace(user_dir,
  {
    relativePath: 'config.fish',
    content: `
set -gx PATH $HOME/.local/bin $PATH

if status is-interactive
# Commands to run in interactive sessions can go here

end
`,
  },
  {
    relativePath: 'functions/greet.fish',
    content: `
function greet
  echo "Hello, $argv!"

  if test (count $argv) -eq 0
    echo "You didn't provide a name."
  end
end`,
  },
  {
    relativePath: 'completions/custom_tool.fish',
    content: `
complete -c custom_tool -l help -d "Show help"
complete -c custom_tool -l version -d "Show version"
complete -c custom_tool -l output -r -d "Specify output file"`,
  },
  {
    relativePath: 'functions/custom_tool.fish',
    content: `
function custom_tool --description 'custom tool'
  argparse 'help' 'version' 'output' -- $argv
  or return

  if set -q _flag_help
    echo 'help msg'
    return 0
  end

  echo 'running custom tool'
end`,
  },
);

// const advanded: FishFileDefinition[] = [
//   {
//     relativePath: 'functions/better_variable_scopes.fish',
//     content: `#!/usr/bin/env fish
//
// ### File was take from the following fish shell excerpt: \`man fish-language /Variable Scope\`
// ###
// ###
// ###  Variable Scope
// ###       There are four kinds of variables in fish: universal, global, function and local variables.
// ###
// ###       • Universal variables are shared between all fish sessions a user is running on one computer. They are stored on disk and persist even after reboot.
// ###
// ###       • Global variables are specific to the current fish session. They can be erased by explicitly requesting set -e.
// ###
// ###       • Function variables are specific to the currently executing function. They are erased ("go out of scope") when the current function ends. Outside of a function, they don't go out of scope.
// ###
// ###       • Local variables are specific to the current block of commands, and automatically erased when a specific block goes out of scope. A block of commands is a series of commands that begins with one  of
// ###         the commands for, while , if, function, begin or switch, and ends with the command end. Outside of a block, this is the same as the function scope.
// ###
// ###       Variables can be explicitly set to be universal with the -U or --universal switch, global with -g or --global, function-scoped with -f or --function and local to the current block with -l or --local.
// ###       The scoping rules when creating or updating a variable are:
// ###
// ###       • When a scope is explicitly given, it will be used. If a variable of the same name exists in a different scope, that variable will not be changed.
// ###
// ###       • When no scope is given, but a variable of that name exists, the variable of the smallest scope will be modified. The scope will not be changed.
// ###
// ###       • When no scope is given and no variable of that name exists, the variable is created in function scope if inside a function, or global scope if no function is executing.
// ###
// ###       There can be many variables with the same name, but different scopes. When you use a variable, the smallest scoped variable of that name will be used. If a local variable exists, it will be used  in‐
// ###       stead of the global or universal variable of the same name.
// ###
// ###       Example:
// function test-scopes
//     begin
//         # This is a nice local scope where all variables will die
//         set -l pirate 'There be treasure in them hills'
//         set -f captain Space, the final frontier
//         # If no variable of that name was defined, it is function-local.
//         set gnu "In the beginning there was nothing, which exploded"
//     end
//
//     echo $pirate
//     # This will not output anything, since the pirate was local
//     echo $captain
//     # This will output the good Captain's speech since $captain had function-scope.
//     echo $gnu
//     # Will output Sir Terry's wisdom.
// end
// test-scopes
//
// # When a function calls another, local variables aren't visible:
// function shiver
//     set phrase 'Shiver me timbers'
// end
//
// function avast
//     set --local phrase 'Avast, mateys'
//     # Calling the shiver function here can not
//     # change any variables in the local scope
//     # so phrase remains as we set it here.
//     shiver
//     echo $phrase
// end
//
// avast
// # Outputs "Avast, mateys"`
//   },
//   {
//     relativePath: 'functions/inner_functions.fish',
//     content: `
// # PROGRAM
//
// function func_a --argument-names arg_1 arg_2
// set --local args "$argv"
//
// function func_b
// set --local args "$argv 1"
// set --local args "$args 2"
// set --local args "$args 3"
// end
//
// function func_c
// set --local args "$argv"
// end
//
// func_b $args
//
// func_b $arg_1
// func_c $arg_2
//
//
// set --local args "$argv[2]"
// set arg $argv[1]
// for arg in $argv[-2..-1]
// echo $arg
// end
//
// for arg in $argv[-3..-1]
// echo $arg
// end
//
// set args "$argv[2]"
// end
//
// function func_outside --argument-names arg_1 arg_2
// echo $argv
// end
//
// func_a 1 2
// func_outside 1 2
// set args 'a b c'`.toString(),
//   },
//   {
//     relativePath: 'functions/lots_of_globals.fish',
//     content: `
// # lots_of_globals -- creates 4 global variables
// function lots_of_globals --description "Lots of globals"
//     set -gx a 1
//     set -gx b 2
//     set -gx c 3
//     set -gx d 4
// end
//
//
// set --global abcd 1 2 3 4
// set --local ghik 5 6 7 8
// set --universal mnop 9 10 11 12
// set zxcv 13 14 15 16
//
// __lots_of_globals_helper
//
// function __lots_of_globals_helper
//     set --global PATH '/usr/local/bin' '/usr/bin' '/bin' '/usr/sbin' '/sbin'
// end
// `
//   },
//   {
//     relativePath: 'functions/multiple_functions.fish',
//     content: `
// # preceding chars
// function multiple_functions --argument-names file1 file2 file3
//     echo "file1 is $file1"
//     echo "file2 is $file2"
//     echo "file3 is $file3"
// end
//
//
// function other_functions
//     for i in $argv
//         echo "file$i is $i"
//     end
//     for i in $argv
//         echo "file$i is $i"
//     end
// end
//
// set --local files 'file1' 'file2' 'file3'
// other_functions "$files"
//
//
//
// set --universal files 'not'`
//   }, {
//     relativePath: 'functions/variable_scope.fish',
//     content: `#!/usr/local/bin/fish
//
// # file to show how scope works in fish shell
// # notice that the variable i is still available after the for loop
// # and that the variable ii is not available after the if statement
//
// for i in (seq 1 10)
//     echo "."
// end
// echo $i
//
//
// if true
//     set ii 20
// else
//     set ii -1
// end
//
// echo $ii
//
// function aaa
//     set v "hi"
//     function bbb
//         set v "hello"
//     end
//     echo $v
//     bbb
// end
//
// aaa
//
// begin;
//     set ii 30
// end;
//
// echo $ii
// `}, {
//     relativePath: 'functions/variable_scope_2.fish',
//     content: `,
// #!/usr/bin/env fish
//
// ### File was take from the following fish shell excerpt:
// ###  Variable Scope
// ##       There are four kinds of variables in fish: universal, global, function and local variables.
// ##
// ##       • Universal variables are shared between all fish sessions a user is running on one computer. They are stored on disk and persist even after reboot.
// ##
// ##       • Global variables are specific to the current fish session. They can be erased by explicitly requesting set -e.
// ##
// ##       • Function variables are specific to the currently executing function. They are erased ("go out of scope") when the current function ends. Outside of a function, they don't go out of scope.
// ##
// ##       • Local variables are specific to the current block of commands, and automatically erased when a specific block goes out of scope. A block of commands is a series of commands that begins with one  of
// ##         the commands for, while , if, function, begin or switch, and ends with the command end. Outside of a block, this is the same as the function scope.
// ##
// ##       Variables can be explicitly set to be universal with the -U or --universal switch, global with -g or --global, function-scoped with -f or --function and local to the current block with -l or --local.
// ##       The scoping rules when creating or updating a variable are:
// ##
// ##       • When a scope is explicitly given, it will be used. If a variable of the same name exists in a different scope, that variable will not be changed.
// ##
// ##       • When no scope is given, but a variable of that name exists, the variable of the smallest scope will be modified. The scope will not be changed.
// ##
// ##       • When no scope is given and no variable of that name exists, the variable is created in function scope if inside a function, or global scope if no function is executing.
// ##
// ##       There can be many variables with the same name, but different scopes. When you use a variable, the smallest scoped variable of that name will be used. If a local variable exists, it will be used  in‐
// ##       stead of the global or universal variable of the same name.
// ##
// ##       Example:
//
// function test-scopes
//     begin
//         # This is a nice local scope where all variables will die
//         set -l pirate 'There be treasure in them hills'
//         set -f captain Space, the final frontier
//         # If no variable of that name was defined, it is function-local.
//         set gnu "In the beginning there was nothing, which exploded"
//     end
//
//     echo $pirate
//     # This will not output anything, since the pirate was local
//     echo $captain
//     # This will output the good Captain's speech since $captain had function-scope.
//     echo $gnu
//     # Will output Sir Terry's wisdom.
// end
// test-scopes
//
//
// # When a function calls another, local variables aren't visible:
// function shiver
//     set phrase 'Shiver me timbers'
// end
//
// function avast
//     set --local phrase 'Avast, mateys'
//     # Calling the shiver function here can not
//     # change any variables in the local scope
//     # so phrase remains as we set it here.
//     shiver
//     echo $phrase
// end
//
// avast
// # Outputs "Avast, mateys"`
//   } ]
//
//
