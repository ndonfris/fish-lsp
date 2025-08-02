function foo
switch "$argv[1]"
case 'bar'
echo 'bar'
case 'baz'
echo 'baz'
case '*'
echo 'default'
end
end
