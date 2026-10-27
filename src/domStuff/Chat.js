import GameManager from "../things/GameManager";
import NetworkManager from "../things/NetworkManager";
import { sendDiscordMessage } from "./DiscordStuff";

const sect = document.getElementById('chat-section');
const messages = document.getElementById('chatMessages');
const textInput = document.getElementById('chatInput');

let isChatting = false;
let message = "";
let network;
let scene;
let chatMessageHandler = null;

export function chatNetwork() {
    network = NetworkManager.instance;
    const netMessages = (d) => {
        addMessage(d.message)
    }

    // chatNetwork runs on every level load (setupNet) but the socket is the
    // persistent NetworkManager singleton, so a plain .on() would stack one
    // listener per visited level and each incoming chat message would be
    // appended N times. Replace (not stack), same convention as the other
    // per-level listeners (Days 14/19/20).
    if (chatMessageHandler) {
        network.socket.off('globalChatMessageUpdate', chatMessageHandler);
    }
    chatMessageHandler = ({ id, data }) => {
        netMessages(data);
    };
    network.socket.on('globalChatMessageUpdate', chatMessageHandler);
}

export function getChatting() {
    return isChatting;
}

export function setScene(s) {
    scene = s;
}

export default function setupChat() {
    let fadeTimer;
    textInput.addEventListener('focus', () => {
        isChatting = true;
        scene.input.keyboard.resetKeys();
        scene.input.keyboard.enabled = false;
        clearTimeout(fadeTimer);
        messages.classList.add('active');
        messages.scrollTop = messages.scrollHeight;
    });

    textInput.addEventListener('blur', () => {
        isChatting = false;
        scene.input.keyboard.resetKeys();
        scene.input.keyboard.enabled = true;
        fadeTimer = setTimeout(()=> {
        messages.classList.remove('active');
        messages.scrollTop = messages.scrollHeight;
        },2000);
    });

    document.addEventListener('mousedown', (e) => {
        textInput.blur();
    })
    // Touch mirror of the above: the game canvas and on-screen buttons all
    // preventDefault their touchstart, which suppresses the browser's
    // synthesized mousedown — so without this, tapping the game area on a
    // phone would never blur the chat input and the keyboard would stay
    // disabled. Passive: no need to block scrolling here, just blur.
    document.addEventListener('touchstart', (e) => {
        textInput.blur();
    }, { passive: true })
    textInput.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    })
    textInput.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    })
    textInput.addEventListener('mouseup', (e) => {
        e.stopPropagation();
    })
    textInput.addEventListener('touchend', (e) => {
        e.stopPropagation();
    })

    window.addEventListener('keydown', (e) => {
        if (isChatting) {
            if (e.code === 'Escape') {
                e.preventDefault();
                textInput.blur();
            }
        }

        if (e.code === 'Enter') {
            e.preventDefault(); // prevents default behavior like newline
            if (!isChatting) {
                textInput.focus();
            } else {
                message = textInput.value; // use .value for input/textarea
                if (/^\s*$/.test(message)) {
                    textInput.value = ""; // clear after sending
                    textInput.blur();
                    return;
                };
                sendDiscordMessage(message);
                message = GameManager.name.text + ": " + textInput.value; // use .value for input/textarea
                addMessage(message);
                network?.socket?.emit('globalChatMessageRequest', { player: GameManager.name.text, message });
                textInput.value = ""; // clear after sending
                textInput.blur();
            }
        }
    });
}


function addMessage(tx) {
    const newMessage = document.createElement('div');
    newMessage.className = 'chatMessage';
    newMessage.textContent = tx;
    messages.appendChild(newMessage);
    messages.scrollTop = messages.scrollHeight;
}
