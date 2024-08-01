// load-fish-env.js
require('dotenv').config();

console.log('Fish function path:', process.env.FISH_FUNCTION_PATH);
console.log('Fish completion path:', process.env.FISH_COMPLETE_PATH);
console.log('Fish config file:', process.env.FISH_CONFIG_PATH);

// You can now use these variables in your application
const fishFunctionPaths = process.env.FISH_FUNCTION_PATH.split(':');
console.log('Fish function directories:', fishFunctionPaths);

// Example: Check if a specific function file exists
const path = require('path');
const fs = require('fs');

function checkFunctionExists(functionName) {
  for (const dir of fishFunctionPaths) {
    const functionPath = path.join(dir, `${functionName}.fish`);
    if (fs.existsSync(functionPath)) {
      console.log(`Function ${functionName} found at ${functionPath}`);
      return true;
    }
  }
  console.log(`Function ${functionName} not found`);
  return false;
}

checkFunctionExists('fish_prompt');