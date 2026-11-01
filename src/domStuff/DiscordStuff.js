import GameManager from "../things/GameManager";

// The Discord widget (iframe embed) was removed entirely — Yaya's call,
// it blocked the screen on phones. This module now only carries the
// chat -> Discord webhook. setupDiscordWindow is kept as a no-op export
// so any lingering call sites don't break.
export function setupDiscordWindow() {}


export async function sendDiscordMessage(message) {
    const webhookURL = "https://discord.com/api/webhooks/1406792582197149699/xlWk4jLxvCzyILXd1E0OxcneZVhYz6Rjp8Z48A0EGtvl3rKusWT2lxCdvphSPohRqACL";

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