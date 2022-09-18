function trim(str) {
  return gensub(/\s*$/, "", 1, gensub(/^\s*/, "", 1, str))
}

function get_normalized_description(desc,    result, chars, chars_length, i) {
  result = ""
  chars_length = split(desc, chars, "")

  for (i = 1; i <= chars_length; i++) {
    if (!result && (chars[i] == " " || chars[i] == "\n")) continue

    if (chars[i] == " ") {
      if (!result) continue
      if (chars[i-1] == " " || chars[i-1] == "\n") continue
    }

    if (chars[i] == "-" && chars[i+1] == "\n") {
      i++
      continue 
    }

    if (chars[i] == "\n") chars[i] = " "

    result = result chars[i]
  }

  return result
}

function every(arr, predicate,    result, key) {
  result = 1

  for (key in arr) {
    if (!@predicate(arr[key], key)) result = 0
  }

  return result
}

function is_key_numeric(_, key) {
  return key !~ /[^[0-9]/
}

function get_escaped(str) {
  return gensub(/"/, "\\\\\"", "g", gensub(/\\/, "\\\\\\\\", "g", gensub(/\n/, "\\\\n", "g", str)))
}

function to_json(arr,    result, key, enclosing_char) {
  result = ""

  if (every(arr, "is_key_numeric")) {
    enclosing_char[1] = "["
    enclosing_char[2] = "]"
  }
  else {
    enclosing_char[1] = "{"
    enclosing_char[2] = "}"
  }

  result = result enclosing_char[1]

  for (key in arr) {
    if (typeof(arr[key]) == "array") {
      result = result "\"" get_escaped(key) "\":" to_json(arr[key]) ","
    }
    else result =  result "\"" get_escaped(key) "\":\"" get_escaped(arr[key]) "\","
  }

  result = substr(result, 1, length(result) - 1) enclosing_char[2]

  return result
}


BEGIN {
  RS = "\n\n"
  FS = "\n"

  section = ""
  subsection = ""
  awk_version = ""
}


match($1, /^([A-Z][A-Z, \/-]+)$/, captures) {
  section = captures[1]
  subsection = ""

  if (section == "VERSION INFORMATION") {
    match($0, /version\s([0-9]\.[0-9])\.?/, captures)
    awk_version = captures[1]
  }

  next
}


match($1, /^   ([A-Z][A-Za-z, \/-]+)$/, captures) {
  subsection = captures[1]
  next
}


subsection ~ /Functions/ && /^ {7}[a-z]+\(/ {
  old_fs = FS
  FS = ""
  $0 = $0

  fname = ""
  fdesc = ""

  for (i = 1; i <= NF; i++) {
    if (fname !~ /\)/) fname = fname $i
    else fdesc = fdesc $i
  }

  fname = trim(fname)
  
  functions[fname] = get_normalized_description(fdesc)

  FS = old_fs
}


subsection == "Built-in Variables" {
  old_fs = FS
  FS = ""
  $0 = $0
  
  vname = ""
  vdesc = ""
  is_vname_set = 0

  for (i = 1; i <= NF; i++) {
    if (!is_vname_set && vname ~ /\S/ && ($i == " " || $i == "\n")) {
      if ((vname ~ /\[/ && vname ~ /\]/) || vname !~ /\[/) {
        is_vname_set = 1
        continue
      }
    }

    if (!is_vname_set) vname = vname $i
    else vdesc = vdesc $i
  }

  vname = trim(vname)
  vdesc = get_normalized_description(vdesc)

  if (vname ~ /[^A-Z]/ && vname !~ /\[/) {
    builtins[previous_vname] = builtins[previous_vname] "\n" vname " " vdesc
    FS = old_fs
    next
  }
  
  builtins[vname] = vdesc

  previous_vname = vname

  FS = old_fs
}


subsection == "I/O Statements" {
  old_fs = FS
  FS = ""
  $0 = $0
  
  sname = ""
  sdesc = ""

  for (i = 1; i <= NF; i++) {
    if (!sname && $i == " ") continue
    if (!sname && $i ~ /[A-Z]/) {
      FS = old_fs
      next
    }
    if (sname && $i ~ /[A-Z]/) {
      sdesc = sdesc $i
      continue
    }
    if (!sdesc) sname = sname $i
    else sdesc = sdesc $i
  }

  sname = trim(sname)

  io_statements[sname] = get_normalized_description(sdesc)

  FS = old_fs
}


subsection == "Patterns" {
  if ($1 ~ /BEGIN\s/ && $1 ~ /END\s/) {
    patterns["BEGIN"] = get_normalized_description($0)
    patterns["END"] = get_normalized_description($0)
  }

  if ($1 ~ /BEGINFILE\s/ && $1 ~ /ENDFILE\s/) {
    patterns["BEGINFILE"] = get_normalized_description($0)
    patterns["ENDFILE"] = get_normalized_description($0)
  }
}



END {
  result["version"] = awk_version

  for (key in functions) {
    result["functions"][key] = functions[key]
  }

  for (key in builtins) {
    result["builtins"][key] = builtins[key]
  }

  for (key in io_statements) {
    result["io_statements"][key] = io_statements[key]
  }

  for (key in patterns) {
    result["patterns"][key] = patterns[key]
  }

  print to_json(result)
}
