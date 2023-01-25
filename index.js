const http = require("http");
const express = require("express");
const os = require("os");
const socketIo = require("socket.io");
const five = require("johnny-five");
const _ = require("lodash");
const { v4: uuid } = require("uuid");

const DIAL_READ_PIN = 2,
    DIALING_PIN = 3,
    RECEIVER_PIN = 4,
    RING_PIN_1 = 7,
    RING_PIN_2 = 8;
const ROLE_NEWCOMER = "0",
    ROLE_LOCAL = "1",
    ROLE_ADMIN = "2";

let needToPrint = false;

let count = 0,
    isPickedUp;

let dialReadButton, dialingButton, receiverButton, ringPin1, ringPin2;

const app = express();
const port = process.env.PORT || 3333;
const server = http.createServer(app);

const localIP =
    process.env.NODE_ENV !== "production"
        ? os.networkInterfaces().en0.find((a) => a.family === "IPv4").address
        : undefined;

const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        transport: ["websocket"],
    },
});

const subscribers = {};
const subscribe = (id, socket) => {
    if (subscribers.hasOwnProperty(id)) {
        console.log(
            `Client with ID ${id} already connected. Disconnecting older client.`
        );
        unsubscribe(id);
    }
    subscribers[id] = { role: undefined, socket };
    console.log(`Connected to ${id}.`);
};
const unsubscribe = (id) => {
    delete subscribers[id];
    console.log(`Disconnected from ${id}.`);
};

let conversation = [];

const resetConversation = () => {
    conversation = [];
};
const setRole = (id, role) => {
    subscribers[id].role = role;
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
        const { id } = socket.handshake.query;

        // The dial isn't being dialed, or has just finished being dialed.
        dialingButton.on("up", () => {
            if (needToPrint) {
                const number = count % 10;
                console.log("☎️ DIAL:", number);

                Object.keys(subscribers).forEach((k) => {
                    if (
                        [ROLE_ADMIN, ROLE_NEWCOMER].includes(
                            subscribers[k].role
                        )
                    )
                        subscribers[k].socket.emit("dial", number);
                });

                needToPrint = false;
                count = 0;
                cleared = false;
            }
        });

        receiverButton.on("up", () => {
            isPickedUp = false;
            socket.emit("receiver", false);
            socket.broadcast.emit("receiver", false);
        });
        receiverButton.on("down", () => {
            isPickedUp = true;
            socket.emit("receiver", true);
            socket.broadcast.emit("receiver", true);
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
        defineUniversalListeners(id, socket);
    });
});
board.on("fail", () => {
    io.on("connection", (socket) => {
        const { id } = socket.handshake.query;

        // Listener for event
        defineUniversalListeners(id, socket);
    });
});

const defineUniversalListeners = (id, socket) => {
    socket.on("send-message", (msg) => {
        console.log("💬 MESSAGE:", msg.content);

        conversation.push(msg);
        socket.broadcast.emit("receive-message", msg);
    });
    socket.on("reset-conversation", () => {
        console.log("🔄 RESET");

        resetConversation();
        socket.emit("update-conversation", conversation);
        socket.broadcast.emit("update-conversation", conversation);
    });
    socket.on("set-role", (role) => {
        console.log("🤖 SET ROLE:", id, role);

        setRole(id, role);
    });

    // Add subscriber for each new connection
    subscribe(id, socket);
    socket.emit("update-conversation", conversation);
    socket.broadcast.emit("update-conversation", conversation);

    // Clean up when client disconnects
    socket.on("disconnect", () => {
        unsubscribe(id);
    });
};

app.get("/", (req, res) => {
    res.send(`Listening at https://${hostname}:${port}`);
});

// Start up server and log addresses for local and network
const startServer = () => {
    server.listen(port, () => {
        console.log(`Listening at http://localhost:${port}`);
        if (localIP) console.log(`On Network at http://${localIP}:${port}`);
    });
};

startServer();
