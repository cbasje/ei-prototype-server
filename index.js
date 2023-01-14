const https = require("https");
const fs = require("fs");
const express = require("express");
const os = require("os");
const socketIo = require("socket.io");
const five = require("johnny-five");
const _ = require("lodash");

const DIAL_READ_PIN = 2,
    DIALING_PIN = 3,
    RECEIVER_PIN = 4,
    RING_PIN_1 = 7,
    RING_PIN_2 = 8;

let needToPrint = false;

let count = 0,
    isPickedUp;

let dialReadButton, dialingButton, receiverButton, ringPin1, ringPin2;

const app = express();
const port = process.env.PORT || 3333;
const hostname = "localhost";

const localIP =
    process.env.NODE_ENV !== "production"
        ? os.networkInterfaces().en0.find((a) => a.family === "IPv4").address
        : undefined;

// Set up socket server
const key = fs.readFileSync("localhost-key.pem", "utf-8");
const cert = fs.readFileSync("localhost.pem", "utf-8");

const server = https.createServer({ key, cert }, app);
const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        transport: ["websocket"],
    },
});

const subscribers = new Map();
const subscribe = (id, socket) => {
    if (subscribers.has(id)) {
        console.log(
            `Client with ID ${id} already connected. Disconnecting older client.`
        );
        unsubscribe(id);
    }
    subscribers.set(id, socket);
    console.log(`Connected to ${id}.`);
};
const unsubscribe = (id) => {
    subscribers.delete(id);
    console.log(`Disconnected from ${id}.`);
};

const board = new five.Board({ repl: false });
board.on("ready", () => {
    dialReadButton = new five.Button({
        pin: DIAL_READ_PIN,
        isPullup: true,
    });
    dialingButton = new five.Button({
        pin: DIALING_PIN,
        isPullup: true,
    });
    receiverButton = new five.Button({
        pin: RECEIVER_PIN,
        isPullup: true,
    });
    ringPin1 = new five.Pin(RING_PIN_1);
    ringPin2 = new five.Pin(RING_PIN_2);

    dialReadButton.on("up", () => {
        // increment the count of pulses if it's gone high.
        count++;
        needToPrint = true;
    });

    io.on("connection", (socket) => {
        const { id } = socket;
        console.log(`Connection: ${id}`);

        // The dial isn't being dialed, or has just finished being dialed.
        dialingButton.on("up", () => {
            if (needToPrint) {
                console.log(count % 10);
                socket.emit("dial", count % 10);

                needToPrint = false;
                count = 0;
                cleared = false;
            }
        });

        receiverButton.on("up", () => {
            isPickedUp = false;
            socket.emit("receiver", false);
        });
        receiverButton.on("down", () => {
            isPickedUp = true;
            socket.emit("receiver", true);
        });

        // Listener for event
        socket.on("ring", () => {
            console.log("🎫 RING");

            let i = 0,
                j = 0,
                start = 0;

            board.loop(40, (cancelI) => {
                if (isPickedUp) cancelI();
                else {
                    if (i === 0 && j > 0 && Date.now() - start < 500) return;

                    ringPin1.write(i % 2);
                    ringPin2.write(1 - (i % 2));
                    i++;

                    if (i >= 30) {
                        j++;
                        i = 0;

                        if (j < 3) {
                            start = Date.now();
                        } else if (j >= 3) cancelI();
                    }
                }
            });
        });

        // Add subscriber for each new connection
        subscribe(id, socket);

        // Clean up when client disconnects
        socket.on("disconnect", () => {
            unsubscribe(id);
        });
    });
});

app.get("/", (req, res) => {
    res.send(`Listening at https://${hostname}:${port}`);
});

// Start up server and log addresses for local and network
const startServer = () => {
    server.listen(port, "0.0.0.0", () => {
        console.log(`Listening at https://${hostname}:${port}`);
        if (localIP) console.log(`On Network at http://${localIP}:${port}`);
    });
};

startServer();
