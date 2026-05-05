"use strict";

const projectScaffold = require("./scaffold/project");

module.exports = {
  ...projectScaffold,
  workspaceInit: projectScaffold.workspaceInitCompat,
};
