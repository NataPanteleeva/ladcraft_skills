"use strict";

const { syncInstallAndAgent } = require("./lib/sync-install");

const result = syncInstallAndAgent();
console.log(JSON.stringify(result, null, 2));
