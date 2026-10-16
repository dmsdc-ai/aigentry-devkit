"use strict";

// Inert fixed entry: all planning, consent and execution authority stays in setup.
const setup = require("./setup");
if (require.main === module) {
  setup.run(process.argv.slice(2)).then(code => { process.exitCode = code; },
    () => { process.exitCode = 1; });
}
module.exports = setup;
