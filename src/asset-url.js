"use strict";

const { app } = require("electron");
const path = require("path");
const { pathToFileURL } = require("node:url");

function getAssetUrl(...assetPath) {
  return pathToFileURL(path.join(app.getAppPath(), "assets", ...assetPath)).href;
}

module.exports = {
  getAssetUrl,
};
