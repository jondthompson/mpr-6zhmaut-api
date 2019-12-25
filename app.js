var express = require("express");
var morgan = require("morgan");
var bodyParser = require("body-parser");
var async = require("async");

var app = express(); // invoke express to create our app
var logFormat =
  "'[:date[iso]] - :remote-addr - :method :url :status :response-time ms - :res[content-length]b'";
app.use(morgan(logFormat)); // invoke morgan
app.use(bodyParser.text({ type: "*/*" })); // invoke bodyParser

const ReQuery = /^true$/i.test(process.env.REQUERY);
const UseCORS = /^true$/i.test(process.env.CORS);
const AmpCount = process.env.AMPCOUNT || 1;
const BaudRate = parseInt(process.env.BAUDRATE || 9600);
const SerialPort = require("serialport");
// const SerialPort = require("@serialport/stream");
// const MockBinding = require("@serialport/binding-mock");
const Readline = require("@serialport/parser-readline");

// Create a port and enable the echo and recording.
// SerialPort.Binding = MockBinding;
// MockBinding.createPort("/dev/null", { echo: true, record: true });
// MockBinding.createPort("/dev/ROBOT", { echo: true, record: true });
// const port = new SerialPort("/dev/ROBOT");

var device = process.env.DEVICE || "/dev/ttyUSB0";
var connection = new SerialPort(device, {
  baudRate: BaudRate
});

const parser = connection.pipe(
  new Readline({ delimiter: "\n", encoding: "ascii" })
);

// on connection open
connection.on("open", function() {
  var zones = {};

  const queryControllers = async () => {
    for (let i = 1; i <= AmpCount; i++) {
      connection.write("?" + i.toString() + "0\r").catch(err => {
        console.log(err);
      });
      await async.until(
        function(callback) {
          callback(
            null,
            typeof zones !== "undefined" && Object.keys(zones).length === 6 * i
          );
        },
        function(callback) {
          setTimeout(callback, 10);
        }
      );
    }
  };

  connection.write("?10\r");
  AmpCount >= 2 && connection.write("?20\r");
  AmpCount >= 3 && connection.write("?30\r");

  UseCORS &&
    app.use(function(req, res, next) {
      res.header("Access-Control-Allow-Origin", "*");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
      );
      next();
    });

  parser.on("data", function(data) {
    console.log(data);
    var zone = data
      .toString("ascii")
      .match(
        /#>(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/
      );
    if (zone != null) {
      zones[zone[1]] = {
        zone: zone[1],
        pa: zone[2],
        pr: zone[3],
        mu: zone[4],
        dt: zone[5],
        vo: zone[6],
        tr: zone[7],
        bs: zone[8],
        bl: zone[9],
        ch: zone[10],
        ls: zone[11]
      };
    }
  });

  app.get("/", function(req, res) {
    console.log("HELLO FROM INDEX");
    return res.send({ message: "hello" });
  });

  app.get("/zones", function(req, res) {
    var zoneCount = Object.keys(zones).length;
    if (ReQuery) {
      zones = {};
      queryControllers();
    }
    async.until(
      function(callback) {
        callback(
          null,
          typeof zones !== "undefined" &&
            Object.keys(zones).length === zoneCount
        );
      },
      function(callback) {
        setTimeout(callback, 10);
      },
      function() {
        var zoneArray = [];
        for (var o in zones) {
          zoneArray.push(zones[o]);
        }
        res.json(zoneArray);
      }
    );
  });

  // Only allow query and control of single zones
  app.param("zone", function(req, res, next, zone) {
    if (zone % 10 > 0 && Number(zone) != "NaN") {
      req.zone = zone;
      next();
    } else {
      res.status(500).send({ error: zone + " is not a valid zone" });
    }
  });

  app.get("/zones/:zone", function(req, res) {
    if (ReQuery) {
      zones = {};
      queryControllers();
    }
    async.until(
      function(callback) {
        callback(null, typeof zones[req.zone] !== "undefined");
      },
      function(callback) {
        setTimeout(callback, 10);
      },
      function() {
        res.json(zones[req.zone]);
      }
    );
  });

  // Validate and standarize control attributes
  app.param("attribute", function(req, res, next, attribute) {
    if (typeof attribute !== "string") {
      res.status(500).send({
        error: attribute + " is not a valid zone control attribute"
      });
    }
    switch (attribute.toLowerCase()) {
      case "pa":
        req.attribute = "pa";
        next();
        break;
      case "pr":
      case "power":
        req.attribute = "pr";
        next();
        break;
      case "mu":
      case "mute":
        req.attribute = "mu";
        next();
        break;
      case "dt":
        req.attribute = "dt";
        next();
        break;
      case "vo":
      case "volume":
        req.attribute = "vo";
        next();
        break;
      case "tr":
      case "treble":
        req.attribute = "tr";
        next();
        break;
      case "bs":
      case "bass":
        req.attribute = "bs";
        next();
        break;
      case "bl":
      case "balance":
        req.attribute = "bl";
        next();
        break;
      case "ch":
      case "channel":
      case "source":
        req.attribute = "ch";
        next();
        break;
      case "ls":
      case "keypad":
        req.attribute = "ls";
        next();
        break;
      default:
        res.status(500).send({
          error: attribute + " is not a valid zone control attribute"
        });
    }
  });

  app.post("/zones/:zone/:attribute/up", function(req, res) {
    console.log("GOING UP");
    zones = getZones(zones, queryControllers, req, res);
    for (let i = 0; i < zones.length; i++) {
      if (zones[i].zone == req.zone) {
        req.body = String(Number(zones[i][req.attribute]) + 1);
      }
    }
    return postZones(zones, req, queryControllers, res);
  });

  app.post("/zones/:zone/:attribute/down", function(req, res) {
    zones = getZones(zones, queryControllers, req, res);
    for (let i = 0; i < zones.length; i++) {
      if (zones[i].zone == req.zone) {
        req.body = String(Number(zones[i][req.attribute]) - 1);
      }
    }
    return postZones(zones, req, queryControllers, res);
  });

  app.post("/zones/:zone/:attribute", function(req, res) {
    return postZones(zones, req, queryControllers, res);
  });

  app.get("/zones/:zone/:attribute", function(req, res) {
    return getZones(zones, queryControllers, req, res);
  });

  function postZones(zones, req, queryControllers, res) {
    zones = {};
    const writeAttribute = async () => {
      connection.write("<" + req.zone + req.attribute + req.body + "\r");
      await async.until(
        function(callback) {
          callback(
            null,
            typeof zones !== "undefined" && Object.keys(zones).length === 1
          );
        },
        function(callback) {
          setTimeout(callback, 10);
        }
      );
    };
    writeAttribute();
    queryControllers();
    async.until(
      function(callback) {
        callback(null, typeof zones[req.zone] !== "undefined");
      },
      function(callback) {
        setTimeout(callback, 10);
      },
      function(err) {
        console.log(err);
        res.json(zones[req.zone]);
      }
    );
    return zones;
  }

  function getZones(zones, queryControllers, req, res) {
    console.log("GET ZONES RUNNING");
    zones = {};
    queryControllers();
    async.until(
      function(callback) {
        callback(null, typeof zones[req.zone] !== "undefined");
      },
      function(callback) {
        setTimeout(callback, 10);
      },
      function() {
        res.send(zones[req.zone][req.attribute]);
      }
    );
    console.log("FINISHED RUNNING GET ZONES");
    console.log("These are the zones", zones);
    return zones;
  }

  // RUN APP ON DEFAULT PORT 8181
  app.listen(process.env.PORT || 8181, () => {
    console.log("server running");
  });
});
