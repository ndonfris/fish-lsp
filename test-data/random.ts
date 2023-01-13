
const strings = [
    'read --local hi'.split(/\s+/),
    'read --prompt "hi" input selection text word'.split(/\s+/)
]

//const regex = /(\s+\w+)\s+--(local|global|universal)\s+([a-zA-Z0-9_]+)\s.*/g;

for (const currString of strings) {
    const results: string[] = [];
    let lastFlagIdx = 1;
    let stop = false;
    console.log('-----')
    currString.forEach((str, idx) => {
        let next = '';
        if (stop) {
            return
        }
        if (idx + 1 < currString.length) {
            next = currString[idx + 1];
        }
        //console.log(next);
        if (str == '--local') {
            results.push(next);

        }
        if (str == '--universal') {
            results.push(next);

        }
        if (str == '--global') {
            results.push(next);
        }
        if (str.startsWith('"') || str.endsWith('"') || str.startsWith("-")) {
            lastFlagIdx = idx + 1;
        }
        if (str.startsWith('(')){ 
            stop = true;
        }
    })
    for (let i = lastFlagIdx; i < currString.length; i++) {
        results.push(currString[i]);
    }
    console.log('results: ' + results.join(','));
    console.log('-----')
}


