const raycast = require("@raycast/eslint-config");
module.exports = [...raycast, { ignores: ["assets/**", "coverage/**", "dist/**", "node_modules/**"] }];
