const express = require('express');
const log = require('electron-log');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require("fs");
const { ipcMain } = require('electron')
const appData = require('app-data-folder');
const KeyGen = require('selfsigned.js');
const helmet = require('helmet');

function AugurUIServer() {
  this.app = express();
  this.app.use(helmet({
    hsts: false
  }));
  this.server = null;
  this.port = 8080;
  this.window = null;
  this.appDataPath = appData("augur");
  ipcMain.on('toggleSslAndRestart', this.onToggleSslAndRestart.bind(this))
  ipcMain.on('startUiServer', this.onStartUiServer.bind(this))
}

AugurUIServer.prototype.onStartUiServer = function (event, usePort) {
  this.port = usePort || this.port;
  if (this.server === null) this.startServer(event)
}

AugurUIServer.prototype.startServer = function (event) {
  log.info("Starting Augur UI Server");
  const port = this.port;
  try {
    const self = this;
    let options = null;

    const key = path.join(this.appDataPath, 'localhost.key')
    const cert = path.join(this.appDataPath, 'localhost.crt')

    log.info("Looking for certificate files in " + this.appDataPath)
    if (fs.existsSync(key) && fs.existsSync(cert)) {
      log.info("Found localhost certificate and key");
      options = {
        key: fs.readFileSync(key, "utf8"),
        cert: fs.readFileSync(cert, "utf8")
      };
    }

    event.sender.send("ssl", options !== null);

    const serverBuildPath = path.join(__dirname, '../../node_modules/augur-ui/build');
    this.app.use(express.static(serverBuildPath));
    this.app.listen = function () {
      const server = options === null ? http.createServer(this) : https.createServer(options, this)
      server.on('error', (e) => {
        log.error(e);
        if (e.code === 'EADDRINUSE') {
          event.sender.send("error", {
            error: `Port ${port} is in use. Please free up port and close and restart this app.`
          });
        } else {
          event.sender.send("error", {
            error: e.toString()
          });
        }
      });
      return server.listen.apply(server, arguments);
    }
    this.server = this.app.listen(port);
  } catch (err) {
    log.error(err);
    event.sender.send("error", { error: err.toString()});
  }
}

// We wait until the window is provided so that if it fails we can send an error message to the renderer
AugurUIServer.prototype.setWindow = function (window) {
  this.window = window;
}

AugurUIServer.prototype.stopServer = function () {
  log.info("Stopping Augur UI Server");
  this.server && this.server.close();
}

AugurUIServer.prototype.restart = function (event, dontClear) {
  // clear any message that occured to start server
  if (!dontClear) { // because of disable ssl button
    event.sender.send("showNotice", {
      message: "",
      class: "success"
    });
  }

  this.server && this.server.close();
  this.startServer(event);
}

AugurUIServer.prototype.onToggleSslAndRestart = function (event, enabled) {

  const certPath = path.join(this.appDataPath, 'localhost.crt');
  const keyPath = path.join(this.appDataPath, 'localhost.key');

  if (!enabled) {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      fs.unlinkSync(certPath);
      fs.unlinkSync(keyPath);
    }
    this.restart(event, true);

    return;
  }

  const kg = new KeyGen();
  log.info("start generating self signed certifiate files");
  kg.getPrime(1024, (err, p) => {
    if (err) {
      log.error(err)
      event.sender.send('error', { error: err })
      return;
    }
    log.info("finalize key and cert files");
    kg.getPrime(1024, (err, q) => {
      if (err) {
        log.error(err)
        event.sender.send('error', { error: err })
        return;
      }

      const keyData = kg.getKeyData(p, q);
      const key = kg.getPrivate(keyData, 'pem');
      fs.writeFileSync(keyPath, key)

      const certData = kg.getCertData({
        commonName: '127.0.0.1',
        keyData
      });

      const cert = kg.getCert(certData, 'pem');
      fs.writeFileSync(certPath, cert)

      log.info("self signed certificate files generated")
      return this.restart(event);
    });
  });

  event.sender.send("showNotice", {
    message: "Enabling SSL for Ledger...",
    class: "success"
  });

}

module.exports = AugurUIServer;
