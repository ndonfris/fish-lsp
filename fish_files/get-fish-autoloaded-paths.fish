#!/usr/bin/env fish

echo -e "__fish_bin_dir\t$(string join ':' -- $__fish_bin_dir)"

echo -e "__fish_config_dir\t$(string join ':' -- $__fish_config_dir)"
echo -e "__fish_data_dir\t$(string join ':' -- $__fish_data_dir)"
echo -e "__fish_help_dir\t$(string join ':' -- $__fish_help_dir)"

# docs unclear: https://fishshell.com/docs/current/language.html#syntax-function-autoloading
# includes __fish_sysconfdir but __fish_sysconf_dir is defined on local system 
echo -e "__fish_sysconfdir\t$(string join ':' -- $__fish_sysconfdir)"
echo -e "__fish_sysconf_dir\t$(string join ':' -- $__fish_sysconf_dir)"

echo -e "__fish_user_data_dir\t$(string join ':' -- $__fish_user_data_dir)"
echo -e "__fish_added_user_paths\t$(string join ':' -- $__fish_added_user_paths)"

echo -e "__fish_vendor_completionsdirs\t$(string join ':' -- $__fish_vendor_completionsdirs)"
echo -e "__fish_vendor_confdirs\t$(string join ':' -- $__fish_vendor_confdirs)"
echo -e "__fish_vendor_functionsdirs\t$(string join ':' -- $__fish_vendor_functionsdirs)"

echo -e "fish_function_path\t$(string join ':' -- $fish_function_path)"
echo -e "fish_complete_path\t$(string join ':' -- $fish_complete_path)"
echo -e "fish_user_paths\t$(string join ':' -- $fish_user_paths)"
