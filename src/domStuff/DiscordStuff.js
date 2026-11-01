import GameManager from "../things/GameManager";

// The Discord widget (iframe embed) was removed entirely — Yaya's call,
// it blocked the screen on phones. This module now only carries the
// chat -> Discord webhook. setupDiscordWindow is kept as a no-op export
// so any lingering call sites don't break.
export function setupDiscordWindow() {}


export async function sendDiscordMessage(message) {
    // Webhook URL removed (was hardcoded in the repo — security risk).
    // Set conduitDiscordWebhookUrl in your environment/config to re-enable
    // chat -> Discord bridging.
    const webhookURL = "";
    if (!webhookURL) return;

    const messageToSend = message;
    const playerName = GameManager.name.text;
    const payload = {
        content: messageToSend, // plain text
        username: playerName,          // optional, overrides webhook name
        avatar_url: "https://conduit.bar/assets/CardPistol.png"
    };

    await fetch(webhookURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
}